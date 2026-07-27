import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Poll } from "../../../shared/poll";
import { getDeviceId } from "../../lib/session";
import { track } from "../../lib/telemetry";
import {
  PollApiError,
  PollNotFoundError,
  commentPoll,
  fetchPoll,
  votePoll,
} from "../../lib/pollApi";
import { ErrorState, PageTop, ReportMissing } from "../ui/States";
import "./poll.css";

/**
 * Public /poll/:id surface. Account-free voting (one vote per device — a re-vote
 * moves it), the research evidence visible beside each option, an account-free
 * comment thread, and a CTA to run your own Tally research. All state is
 * server-persisted; the only local storage is this device's own pick, a
 * per-device preference.
 */

const MAX_COMMENT = 500;

/** Remembers which option this device chose so the UI reflects their vote on return. */
function votedKey(pollId: string): string {
  return `tally.poll.${pollId}.vote`;
}

function readLocalVote(pollId: string): string | null {
  try {
    return window.localStorage.getItem(votedKey(pollId));
  } catch {
    return null;
  }
}

function writeLocalVote(pollId: string, optionId: string): void {
  try {
    window.localStorage.setItem(votedKey(pollId), optionId);
  } catch {
    // Storage blocked (private mode) — the server still recorded the vote.
  }
}

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; poll: Poll };

export function PollPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [votedOptionId, setVotedOptionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setState({ status: "missing" });
      return;
    }
    setState({ status: "loading" });
    try {
      const poll = await fetchPoll(id);
      setVotedOptionId(readLocalVote(id));
      setState({ status: "ready", poll });
    } catch (err) {
      if (err instanceof PollNotFoundError) {
        setState({ status: "missing" });
        return;
      }
      const message =
        err instanceof PollApiError ? err.message : "This poll couldn't be loaded.";
      setState({ status: "error", message });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <main className="page" aria-label="Loading poll">
        <PageTop back={{ to: "/", label: "Home" }} />
        <div className="poll__skeletons">
          <div className="skeleton poll__skeleton--headline" />
          <div className="skeleton poll__skeleton--option" />
          <div className="skeleton poll__skeleton--option" />
          <div className="skeleton poll__skeleton--option" />
        </div>
      </main>
    );
  }
  if (state.status === "missing") {
    return (
      <main className="page">
        <PageTop back={{ to: "/", label: "Home" }} />
        <ReportMissing />
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className="page">
        <PageTop back={{ to: "/", label: "Home" }} />
        <ErrorState title="This poll couldn't be loaded." detail={state.message} onRetry={load} />
      </main>
    );
  }

  return (
    <PollView
      poll={state.poll}
      votedOptionId={votedOptionId}
      onPoll={(poll) => setState({ status: "ready", poll })}
      onVoted={(optionId, poll) => {
        setVotedOptionId(optionId);
        setState({ status: "ready", poll });
      }}
    />
  );
}

interface PollViewProps {
  poll: Poll;
  votedOptionId: string | null;
  onPoll: (poll: Poll) => void;
  onVoted: (optionId: string, poll: Poll) => void;
}

function PollView({ poll, votedOptionId, onPoll, onVoted }: PollViewProps) {
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const options = [...poll.options].sort((a, b) => a.rank - b.rank);

  async function handleVote(optionId: string) {
    if (busyOptionId) return;
    if (votedOptionId === optionId) return; // Already this device's pick.
    setBusyOptionId(optionId);
    setVoteError(null);
    try {
      const updated = await votePoll(poll.id, optionId, getDeviceId());
      writeLocalVote(poll.id, optionId);
      track({ name: "poll_voted", pollId: poll.id });
      onVoted(optionId, updated);
    } catch (err) {
      setVoteError(err instanceof PollApiError ? err.message : "Your vote didn't go through.");
    } finally {
      setBusyOptionId(null);
    }
  }

  const hasVoted = votedOptionId !== null;

  return (
    <main className="page poll">
      <PageTop back={{ to: "/", label: "Home" }} />
      <p className="kicker">Decision poll</p>
      <h1 className="display display--headline">{poll.question}</h1>
      <p className="small-copy poll__intro">
        Can&rsquo;t decide? Let your people weigh in. Vote below — no account
        needed. Everyone sees the research, not just the horse race.
      </p>
      <a className="poll__evidence-link" href={`/s/${poll.reportId}`}>
        See the full research behind these picks <span aria-hidden="true">→</span>
      </a>

      <ul className="poll__options" role="list">
        {options.map((option) => {
          const count = poll.tallies[option.id] ?? 0;
          const share = poll.totalVotes > 0 ? count / poll.totalVotes : 0;
          const isMine = votedOptionId === option.id;
          return (
            <li className="poll-option" key={option.id}>
              <button
                type="button"
                className={`poll-option__button${isMine ? " poll-option__button--mine" : ""}`}
                onClick={() => handleVote(option.id)}
                disabled={busyOptionId !== null}
                aria-pressed={isMine}
              >
                <span className="poll-option__bar" style={{ width: `${Math.round(share * 100)}%` }} aria-hidden="true" />
                <span className="poll-option__body">
                  <span className="poll-option__label">{option.label}</span>
                  {option.note ? (
                    <span className="micro-copy poll-option__note">{option.note}</span>
                  ) : null}
                </span>
                <span className="poll-option__count" aria-hidden={poll.totalVotes === 0}>
                  {hasVoted || poll.totalVotes > 0
                    ? `${count} ${count === 1 ? "vote" : "votes"}${poll.totalVotes > 0 ? ` · ${Math.round(share * 100)}%` : ""}`
                    : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="micro-copy poll__total" aria-live="polite">
        {poll.totalVotes === 0
          ? "No votes yet — be the first."
          : `${poll.totalVotes} ${poll.totalVotes === 1 ? "vote" : "votes"} so far.`}
        {hasVoted ? " Your vote is counted — tap another option to change it." : ""}
      </p>
      {voteError ? (
        <p className="small-copy poll__vote-error" role="alert">
          {voteError}
        </p>
      ) : null}

      <CommentSection poll={poll} onPoll={onPoll} />

      <section className="poll__cta">
        <p className="serif-note">Deciding something of your own?</p>
        <Link className="button-primary" to="/?entry=poll">
          Run your own Tally
        </Link>
      </section>
    </main>
  );
}

function CommentSection({ poll, onPoll }: { poll: Poll; onPoll: (poll: Poll) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await commentPoll(poll.id, trimmed, getDeviceId());
      track({ name: "poll_commented", pollId: poll.id });
      setText("");
      onPoll(updated);
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof PollApiError ? err.message : "Your take didn't post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="poll__comments" aria-labelledby="poll-comments-heading">
      <h2 id="poll-comments-heading" className="kicker">
        Takes ({poll.comments.length})
      </h2>

      <form className="poll-comment-form" onSubmit={handleSubmit}>
        <label className="micro-copy poll-comment-form__label" htmlFor="poll-comment">
          Leave a one-line take — no account needed.
        </label>
        <textarea
          id="poll-comment"
          ref={inputRef}
          className="poll-comment-form__input"
          value={text}
          maxLength={MAX_COMMENT}
          rows={2}
          placeholder="What would you pick, and why?"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="poll-comment-form__actions">
          <span className="micro-copy poll-comment-form__count">
            {text.trim().length}/{MAX_COMMENT}
          </span>
          <button
            type="submit"
            className="button-primary"
            disabled={busy || text.trim().length === 0}
          >
            {busy ? "Posting…" : "Post take"}
          </button>
        </div>
        {error ? (
          <p className="small-copy poll__vote-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {poll.comments.length === 0 ? (
        <p className="small-copy poll__comments-empty">
          No takes yet. Say what you&rsquo;d pick to get the conversation going.
        </p>
      ) : (
        <ul className="poll-comment-list" role="list">
          {[...poll.comments]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((comment) => (
              <li className="poll-comment" key={comment.id}>
                <p className="small-copy poll-comment__text">{comment.text}</p>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
