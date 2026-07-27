import { nanoid } from "nanoid";
import {
  PollSchema,
  type CreatePollRequest,
  type Poll,
  type PollComment,
  type PollOption,
} from "../../shared/poll";
import { getDb } from "../db";

/**
 * Decision-poll persistence (M4 growth). Polls are created from a report's
 * shortlist and voted/commented on WITHOUT an account — one vote per anonymous
 * device (a re-vote MOVES the vote). Server-persisted only; never faked
 * client-side (CLAUDE.md engineering rule). Reuses the shared SQLite connection
 * from ../db so all domains share one file/WAL.
 */

let tablesReady = false;

/** Idempotent schema bootstrap; runs once per process on first poll operation. */
function ensureTables(): ReturnType<typeof getDb> {
  const db = getDb();
  if (tablesReady) {
    return db;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      label TEXT NOT NULL,
      rank INTEGER NOT NULL,
      note TEXT,
      sort INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (poll_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS poll_comments (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      text TEXT NOT NULL,
      device_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options (poll_id, sort);
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes (poll_id);
    CREATE INDEX IF NOT EXISTS idx_poll_comments_poll ON poll_comments (poll_id, created_at);
  `);
  // Migration for DBs created before device_id was recorded on comments.
  try {
    db.exec("ALTER TABLE poll_comments ADD COLUMN device_id TEXT");
  } catch {
    // Column already exists — nothing to do.
  }
  tablesReady = true;
  return db;
}

interface PollRow {
  id: string;
  report_id: string;
  question: string;
  created_at: string;
}

interface OptionRow {
  id: string;
  label: string;
  rank: number;
  note: string | null;
  sort: number;
}

interface CommentRow {
  id: string;
  text: string;
  created_at: string;
}

interface TallyRow {
  option_id: string;
  count: number;
}

/** Creates a poll and its options atomically; returns the assembled Poll. */
export function createPoll(req: CreatePollRequest): Poll {
  const db = ensureTables();
  const pollId = nanoid();
  const createdAt = new Date().toISOString();

  const insertPoll = db.prepare(
    "INSERT INTO polls (id, report_id, question, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertOption = db.prepare(
    "INSERT INTO poll_options (id, poll_id, label, rank, note, sort) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const write = db.transaction(() => {
    insertPoll.run(pollId, req.reportId, req.question, createdAt);
    req.options.forEach((option, index) => {
      insertOption.run(nanoid(), pollId, option.label, option.rank, option.note ?? null, index);
    });
  });
  write();

  const poll = getPoll(pollId);
  if (!poll) {
    // Should be unreachable — the row was just written in the same connection.
    throw new Error("Poll creation failed to persist.");
  }
  return poll;
}

/** Assembles a poll with its options, per-option tallies, total votes, and comments. */
export function getPoll(id: string): Poll | null {
  const db = ensureTables();
  const pollRow = db
    .prepare<[string], PollRow>("SELECT id, report_id, question, created_at FROM polls WHERE id = ?")
    .get(id);
  if (!pollRow) {
    return null;
  }

  const optionRows = db
    .prepare<[string], OptionRow>(
      "SELECT id, label, rank, note, sort FROM poll_options WHERE poll_id = ? ORDER BY sort ASC",
    )
    .all(id);

  const tallyRows = db
    .prepare<[string], TallyRow>(
      "SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_id",
    )
    .all(id);

  const commentRows = db
    .prepare<[string], CommentRow>(
      "SELECT id, text, created_at FROM poll_comments WHERE poll_id = ? ORDER BY created_at ASC",
    )
    .all(id);

  // Every option gets a tally key (0 when no votes) so the client never has to
  // guess a missing key — the horse race is always fully described.
  const tallies: Record<string, number> = Object.fromEntries(
    optionRows.map((option) => [option.id, 0]),
  );
  let totalVotes = 0;
  for (const row of tallyRows) {
    if (row.option_id in tallies) {
      tallies[row.option_id] = row.count;
      totalVotes += row.count;
    }
  }

  const options: PollOption[] = optionRows.map((row) => ({
    id: row.id,
    label: row.label,
    rank: row.rank,
    note: row.note,
  }));

  const comments: PollComment[] = commentRows.map((row) => ({
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
  }));

  return PollSchema.parse({
    id: pollRow.id,
    reportId: pollRow.report_id,
    question: pollRow.question,
    createdAt: pollRow.created_at,
    options,
    tallies,
    totalVotes,
    comments,
  });
}

/**
 * Casts (or moves) one anonymous device's vote. UNIQUE(poll_id, device_id) makes
 * a re-vote overwrite the prior choice rather than add a second — one voice per
 * device, no ballot stuffing, no dark patterns.
 */
export function castVote(
  pollId: string,
  optionId: string,
  deviceId: string,
): Poll | "not-found" | "bad-option" {
  const db = ensureTables();
  const poll = db.prepare<[string], { id: string }>("SELECT id FROM polls WHERE id = ?").get(pollId);
  if (!poll) {
    return "not-found";
  }
  const option = db
    .prepare<[string, string], { id: string }>(
      "SELECT id FROM poll_options WHERE id = ? AND poll_id = ?",
    )
    .get(optionId, pollId);
  if (!option) {
    return "bad-option";
  }

  db.prepare(
    `INSERT INTO poll_votes (id, poll_id, option_id, device_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (poll_id, device_id)
     DO UPDATE SET option_id = excluded.option_id, created_at = excluded.created_at`,
  ).run(nanoid(), pollId, optionId, deviceId, new Date().toISOString());

  return getPoll(pollId) as Poll;
}

/**
 * Appends an account-free comment to a poll; returns the updated poll. The
 * anonymous deviceId is recorded (not shown) so future dedupe/abuse analysis is
 * possible. Comment text is stored VERBATIM — any surface that renders it MUST
 * escape (the SPA poll page renders via React, which escapes; the server-rendered
 * share/OG surfaces never render comments).
 */
export function addComment(pollId: string, text: string, deviceId: string): Poll | "not-found" {
  const db = ensureTables();
  const poll = db.prepare<[string], { id: string }>("SELECT id FROM polls WHERE id = ?").get(pollId);
  if (!poll) {
    return "not-found";
  }
  db.prepare(
    "INSERT INTO poll_comments (id, poll_id, text, device_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(nanoid(), pollId, text, deviceId, new Date().toISOString());

  return getPoll(pollId) as Poll;
}
