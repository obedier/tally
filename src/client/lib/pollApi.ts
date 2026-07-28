import { z } from "zod";
import {
  PollSchema,
  type CreatePollRequest,
  type Poll,
} from "../../shared/poll";
import { apiUrl } from "./origin";

/**
 * Typed client access to the decision-poll API. Every response is zod-parsed
 * against the shared contract before it reaches a component — the client trusts
 * nothing from the wire. Kept separate from lib/api.ts by ownership boundary.
 */

export class PollApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "PollApiError";
    this.status = status;
    this.code = code;
  }
}

export class PollNotFoundError extends PollApiError {
  constructor(message = "This poll isn't here.") {
    super(message, 404, "not-found");
    this.name = "PollNotFoundError";
  }
}

/** Server wraps every success as `{ poll }`; a bare poll also parses defensively. */
const PollResponseSchema = z.object({ poll: PollSchema });
const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});

async function readJsonQuietly(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function parsePoll(json: unknown, status: number): Poll {
  const wrapped = PollResponseSchema.safeParse(json);
  if (wrapped.success) return wrapped.data.poll;
  const bare = PollSchema.safeParse(json);
  if (bare.success) return bare.data;
  throw new PollApiError("The poll arrived in an unexpected shape.", status, "bad-shape");
}

/** Turns a non-OK response into a typed error, preferring the server envelope. */
async function throwForResponse(response: Response): Promise<never> {
  const json = await readJsonQuietly(response);
  const envelope = ErrorEnvelopeSchema.safeParse(json);
  const code = envelope.success ? envelope.data.code : "http-error";
  const message = envelope.success
    ? envelope.data.message
    : "Something went wrong. Please try again.";
  if (response.status === 404) throw new PollNotFoundError(message);
  throw new PollApiError(message, response.status, code);
}

async function postJson(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PollApiError("Tally couldn't reach the server. Check your connection.", 0, "network");
  }
}

/** POST /api/polls — create a poll from a report shortlist; returns the new poll. */
export async function createPoll(request: CreatePollRequest): Promise<Poll> {
  const response = await postJson(apiUrl("/api/polls"), request);
  if (!response.ok) await throwForResponse(response);
  return parsePoll(await readJsonQuietly(response), response.status);
}

/** GET /api/polls/:id — a full poll with live tallies and comments. */
export async function fetchPoll(id: string): Promise<Poll> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/polls/${encodeURIComponent(id)}`));
  } catch {
    throw new PollApiError("Tally couldn't reach the server. Check your connection.", 0, "network");
  }
  if (!response.ok) await throwForResponse(response);
  return parsePoll(await readJsonQuietly(response), response.status);
}

/** POST /api/polls/:id/vote — cast (or move) this device's vote; returns updated poll. */
export async function votePoll(id: string, optionId: string, deviceId: string): Promise<Poll> {
  const response = await postJson(apiUrl(`/api/polls/${encodeURIComponent(id)}/vote`), {
    optionId,
    deviceId,
  });
  if (!response.ok) await throwForResponse(response);
  return parsePoll(await readJsonQuietly(response), response.status);
}

/** POST /api/polls/:id/comment — leave an account-free comment; returns updated poll. */
export async function commentPoll(id: string, text: string, deviceId: string): Promise<Poll> {
  const response = await postJson(apiUrl(`/api/polls/${encodeURIComponent(id)}/comment`), {
    text,
    deviceId,
  });
  if (!response.ok) await throwForResponse(response);
  return parsePoll(await readJsonQuietly(response), response.status);
}
