import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { CreatePollRequest } from "../../shared/poll";

// Point the shared connection at a throwaway DB BEFORE any db function runs.
// The connection opens lazily, so this module-level assignment wins despite
// hoisted imports (same pattern as db.test.ts).
process.env.TALLY_DB_PATH = join(mkdtempSync(join(tmpdir(), "tally-polls-test-")), "test.db");

import { addComment, castVote, createPoll, getPoll } from "./polls";

function makeRequest(): CreatePollRequest {
  return {
    reportId: "rep_demo",
    question: "Which should I get?",
    options: [
      { label: "Soundcore Space One", rank: 1, note: "Best battery for the budget." },
      { label: "JBL Tune 770NC", rank: 2, note: "Lighter fit." },
      { label: "Sony WH-CH720N", rank: 3, note: null },
    ],
    deviceId: "dev_creator_00001",
  };
}

describe("createPoll / getPoll", () => {
  test("creates a poll and assembles options, zeroed tallies, and empty comments", () => {
    const poll = createPoll(makeRequest());

    expect(poll.id).toMatch(/.+/);
    expect(poll.reportId).toBe("rep_demo");
    expect(poll.question).toBe("Which should I get?");
    expect(poll.options.map((option) => option.label)).toEqual([
      "Soundcore Space One",
      "JBL Tune 770NC",
      "Sony WH-CH720N",
    ]);
    expect(poll.options.map((option) => option.rank)).toEqual([1, 2, 3]);
    expect(poll.options[2]?.note).toBeNull();

    // Every option is keyed in tallies at 0 — no missing keys for the client.
    expect(poll.totalVotes).toBe(0);
    for (const option of poll.options) {
      expect(poll.tallies[option.id]).toBe(0);
    }
    expect(poll.comments).toEqual([]);

    // getPoll returns the same assembled shape.
    expect(getPoll(poll.id)).toEqual(poll);
  });

  test("returns null for an unknown poll id", () => {
    expect(getPoll("poll_missing")).toBeNull();
  });
});

describe("castVote", () => {
  test("tallies a vote keyed by optionId and increments the total", () => {
    const poll = createPoll(makeRequest());
    const optionA = poll.options[0]!.id;

    const after = castVote(poll.id, optionA, "dev_voter_a_0001");
    expect(after).not.toBe("not-found");
    expect(after).not.toBe("bad-option");
    if (typeof after === "string") throw new Error("expected a poll");

    expect(after.tallies[optionA]).toBe(1);
    expect(after.totalVotes).toBe(1);
  });

  test("one vote per device — a re-vote MOVES the vote instead of adding one", () => {
    const poll = createPoll(makeRequest());
    const optionA = poll.options[0]!.id;
    const optionB = poll.options[1]!.id;
    const device = "dev_flipflop_0001";

    const first = castVote(poll.id, optionA, device);
    if (typeof first === "string") throw new Error("expected a poll");
    expect(first.tallies[optionA]).toBe(1);
    expect(first.totalVotes).toBe(1);

    // Same device votes again for a different option.
    const moved = castVote(poll.id, optionB, device);
    if (typeof moved === "string") throw new Error("expected a poll");
    expect(moved.tallies[optionA]).toBe(0);
    expect(moved.tallies[optionB]).toBe(1);
    // Total stays 1 — the vote moved, it did not multiply.
    expect(moved.totalVotes).toBe(1);
  });

  test("distinct devices each add a vote", () => {
    const poll = createPoll(makeRequest());
    const optionB = poll.options[1]!.id;

    castVote(poll.id, optionB, "dev_two_a_00001");
    const after = castVote(poll.id, optionB, "dev_two_b_00001");
    if (typeof after === "string") throw new Error("expected a poll");

    expect(after.tallies[optionB]).toBe(2);
    expect(after.totalVotes).toBe(2);
  });

  test("rejects an option id that isn't part of the poll", () => {
    const poll = createPoll(makeRequest());
    expect(castVote(poll.id, "opt_not_real", "dev_bad_00001")).toBe("bad-option");
    // Tallies are untouched by the rejected vote.
    const reloaded = getPoll(poll.id);
    expect(reloaded?.totalVotes).toBe(0);
  });

  test("returns not-found for a missing poll", () => {
    expect(castVote("poll_missing", "opt_x", "dev_x_00001")).toBe("not-found");
  });
});

describe("addComment", () => {
  test("appends a comment and returns the updated poll", () => {
    const poll = createPoll(makeRequest());
    expect(poll.comments).toHaveLength(0);

    const after = addComment(poll.id, "I'd get the Sony — comfier for long calls.", "device-cmt-0001");
    if (typeof after === "string") throw new Error("expected a poll");

    expect(after.comments).toHaveLength(1);
    expect(after.comments[0]?.text).toBe("I'd get the Sony — comfier for long calls.");
    expect(after.comments[0]?.id).toMatch(/.+/);
    expect(after.comments[0]?.createdAt).toMatch(/.+/);

    // Persisted, not just returned.
    expect(getPoll(poll.id)?.comments).toHaveLength(1);
  });

  test("returns not-found for a missing poll", () => {
    expect(addComment("poll_missing", "hello", "device-cmt-0002")).toBe("not-found");
  });
});
