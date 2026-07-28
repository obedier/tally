import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Report } from "../../../shared/report";
import { getDeviceId } from "../../lib/session";
import { track } from "../../lib/telemetry";
import { PollApiError, createPoll } from "../../lib/pollApi";
import "./poll.css";

/**
 * Self-contained panel the lead mounts on the comparison page. Turns a report's
 * shortlist (best fit + alternatives) into a shareable decision poll — no
 * account, no purchase pressure, no dark patterns. The top few finalists are
 * pre-checked; the user can title the poll and adjust the slate before creating.
 */

const DEFAULT_QUESTION = "Which should I get?";
const MAX_QUESTION = 200;
const MAX_OPTIONS = 10;
const MAX_NOTE = 280;
/** How many finalists start pre-selected (best fit + next two). */
const DEFAULT_SELECTED = 3;

interface Candidate {
  key: string;
  label: string;
  rank: number;
  note: string | null;
}

/** Trims an evidence note to the contract's 280-char ceiling without a hard cut mid-word. */
function clampNote(note: string): string {
  const trimmed = note.trim();
  if (trimmed.length <= MAX_NOTE) return trimmed;
  return `${trimmed.slice(0, MAX_NOTE - 1).trimEnd()}…`;
}

function buildCandidates(report: Report): Candidate[] {
  const bestFit: Candidate = {
    key: "best-fit",
    label: report.bestFit.name,
    rank: 1,
    note: report.bestFit.whyBest ? clampNote(report.bestFit.whyBest) : null,
  };
  const alternatives: Candidate[] = [...report.alternatives]
    .sort((a, b) => a.rank - b.rank)
    .map((alt) => ({
      key: `alt-${alt.rank}-${alt.name}`,
      label: alt.name,
      rank: alt.rank,
      note: alt.note ? clampNote(alt.note) : null,
    }));
  return [bestFit, ...alternatives].slice(0, MAX_OPTIONS);
}

export function PollCreatePanel({ report }: { report: Report }) {
  const navigate = useNavigate();
  const candidates = useMemo(() => buildCandidates(report), [report]);

  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.slice(0, DEFAULT_SELECTED).map((candidate) => candidate.key)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedCount = selected.size;
  const canCreate = selectedCount >= 2 && selectedCount <= MAX_OPTIONS && !busy;

  async function handleCreate() {
    if (!canCreate) return;
    const chosen = candidates.filter((candidate) => selected.has(candidate.key));
    if (chosen.length < 2) {
      setError("Pick at least two finalists so there's something to decide.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmedQuestion = question.trim() || DEFAULT_QUESTION;
      const poll = await createPoll({
        reportId: report.id,
        question: trimmedQuestion.slice(0, MAX_QUESTION),
        options: chosen.map((candidate) => ({
          label: candidate.label,
          rank: candidate.rank,
          note: candidate.note,
        })),
        deviceId: getDeviceId(),
      });
      track({
        name: "poll_created",
        pollId: poll.id,
        reportId: report.id,
        optionCount: poll.options.length,
      });
      navigate(`/poll/${poll.id}`);
    } catch (err) {
      setError(
        err instanceof PollApiError ? err.message : "The poll couldn't be created. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="poll-create" id="poll" aria-labelledby="poll-create-heading">
      <p className="kicker">Decide with friends</p>
      <h2 id="poll-create-heading" className="serif-note poll-create__framing">
        Can&rsquo;t decide? Let your people weigh in.
      </h2>
      <p className="small-copy poll-create__intro">
        Friends vote on your shortlist — no account needed.
      </p>

      <label className="micro-copy poll-create__label" htmlFor="poll-question">
        Poll question
      </label>
      <input
        id="poll-question"
        className="poll-create__question"
        type="text"
        value={question}
        maxLength={MAX_QUESTION}
        onChange={(event) => setQuestion(event.target.value)}
      />

      <fieldset className="poll-create__options">
        <legend className="micro-copy poll-create__label">Pick 2–{MAX_OPTIONS}</legend>
        {candidates.map((candidate) => {
          const checked = selected.has(candidate.key);
          return (
            <label
              className={`poll-create-option${checked ? " poll-create-option--on" : ""}`}
              key={candidate.key}
            >
              <input
                type="checkbox"
                className="poll-create-option__check"
                checked={checked}
                onChange={() => toggle(candidate.key)}
              />
              <span className="poll-create-option__body">
                <span className="poll-create-option__label">
                  {candidate.rank === 1 ? "Best fit · " : `#${candidate.rank} · `}
                  {candidate.label}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {error ? (
        <p className="small-copy poll__vote-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="button-primary poll-create__submit"
        onClick={handleCreate}
        disabled={!canCreate}
      >
        {busy ? "Creating poll…" : "Create decision poll"}
      </button>
    </section>
  );
}
