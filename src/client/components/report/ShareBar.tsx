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
}: {
  reportId: string;
  surface: ShareSurface;
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
    <button type="button" className="report__share" onClick={share}>
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
