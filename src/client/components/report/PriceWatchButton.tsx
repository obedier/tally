import { useState } from "react";
import { getDeviceId } from "../../lib/session";
import { setPriceWatch } from "../../lib/priceWatchApi";
import { track } from "../../lib/telemetry";
import "./price-watch.css";

/**
 * Watch this price — a calm, honest affordance (M4 growth, docs/GROWTH.md).
 *
 * It records a saved re-check the user can return to. It is NOT a promised
 * alert: notification delivery is out of V1 scope, so the copy never implies a
 * push/email will be sent. NO countdown, NO "price dropping", NO urgency or
 * scarcity — a non-negotiable. Once set, it disables to a neutral "Watching"
 * state and emits `price_watch_set` exactly once.
 */

interface PriceWatchButtonProps {
  reportId: string;
  rank: number;
  pickName: string;
}

type Status = "idle" | "saving" | "watching" | "error";

/** Honest confirmation — sets expectations truthfully, no spam, no account. */
const CONFIRMATION_COPY =
  "Saved. Tally will re-check this when you come back — no spam, no account needed.";

export function PriceWatchButton({ reportId, rank, pickName }: PriceWatchButtonProps) {
  const [status, setStatus] = useState<Status>("idle");

  const watch = async (): Promise<void> => {
    if (status === "saving" || status === "watching") {
      return;
    }
    setStatus("saving");
    try {
      await setPriceWatch({ reportId, rank, pickName, deviceId: getDeviceId() });
      track({ name: "price_watch_set", reportId, rank });
      setStatus("watching");
    } catch {
      setStatus("error");
    }
  };

  const isWatching = status === "watching";
  const isSaving = status === "saving";

  return (
    <div className="price-watch">
      <button
        type="button"
        className={`price-watch__button${isWatching ? " price-watch__button--watching" : ""}`}
        onClick={() => void watch()}
        disabled={isSaving || isWatching}
        aria-pressed={isWatching}
      >
        <span aria-hidden="true">{isWatching ? "✓" : "◷"}</span>
        {isSaving ? "Saving…" : isWatching ? "Watching this price" : "Watch this price"}
      </button>

      {isWatching ? (
        <p className="price-watch__note small-copy" role="status">
          {CONFIRMATION_COPY}
        </p>
      ) : null}

      {status === "error" ? (
        <p className="price-watch__note price-watch__note--error small-copy" role="alert">
          That didn&rsquo;t save.{" "}
          <button type="button" className="price-watch__retry" onClick={() => void watch()}>
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
