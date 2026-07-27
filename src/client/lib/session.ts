import { nanoid } from "nanoid";

/**
 * Anonymous device + session identity, per docs/LEARNING.md privacy rules.
 * Opaque nanoid(21) values matching AnonIdSchema — never derived from identity.
 */

const DEVICE_KEY = "tally.deviceId";
const SESSION_KEY = "tally.sessionId";
const ID_PATTERN = /^[A-Za-z0-9_-]{10,32}$/;

/** In-memory fallback when storage is unavailable (private mode, etc.). */
const memoryIds = new Map<string, string>();

function readOrCreateId(storage: Storage | null, key: string): string {
  const remembered = memoryIds.get(key);
  if (remembered !== undefined) return remembered;

  try {
    if (storage) {
      const existing = storage.getItem(key);
      if (existing !== null && ID_PATTERN.test(existing)) {
        memoryIds.set(key, existing);
        return existing;
      }
      const created = nanoid(21);
      storage.setItem(key, created);
      memoryIds.set(key, created);
      return created;
    }
  } catch {
    // Storage blocked — fall through to memory-only id.
  }

  const created = nanoid(21);
  memoryIds.set(key, created);
  return created;
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Stable per-device anonymous id (localStorage). */
export function getDeviceId(): string {
  return readOrCreateId(safeStorage("local"), DEVICE_KEY);
}

/** Per-tab-session anonymous id (sessionStorage). */
export function getSessionId(): string {
  return readOrCreateId(safeStorage("session"), SESSION_KEY);
}
