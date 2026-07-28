import { useState } from "react";
import { track } from "../../lib/telemetry";

type ShareSurface = "report" | "compare" | "prices";

/**
 * Shares the public read-only research page (/s/:id). Uses the native share
 * sheet on mobile, falls back to copying the link. Emits share_created as a
 * share-intent signal. No incentive, no pressure — a plain "send it to a friend".
 */
export function ShareButton({
  reportId,
  surface,
  variant = "primary",
}: {
  reportId: string;
  surface: ShareSurface;
  /** "quiet" is for a second share affordance on the same page — one primary only. */
  variant?: "primary" | "quiet";
}) {
  const [copied, setCopied] = useState(false);

  const share = async (): Promise<void> => {
    const url = `${window.location.origin}/s/${reportId}`;
    track({ name: "share_created", reportId, surface });
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Tally research", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // User dismissed the share sheet, or clipboard was blocked — no-op.
    }
  };

  return (
    <button
      type="button"
      className={`report__share${variant === "quiet" ? " report__share--quiet" : ""}`}
      onClick={share}
    >
      <span aria-hidden="true">↗</span> {copied ? "Link copied" : "Share this research"}
    </button>
  );
}

/** Screenshot-legible attribution so any cropped surface still reads as Tally's. */
export function Attribution() {
  return (
    <p className="report__attribution">
      Researched by <strong>Tally</strong>
    </p>
  );
}

/**
 * Compact corner wordmark for individual blocks (verdict, pros/cons) so a
 * single-block screenshot crop is still self-attributed — the share loop the
 * spec calls out. Decorative; the page-level Attribution remains the primary.
 */
export function BlockMark() {
  return (
    <span className="report__block-mark" aria-hidden="true">
      Tally
    </span>
  );
}
