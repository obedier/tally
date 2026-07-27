import { useState } from "react";
import { sendFeedback, type FeedbackRating } from "../../lib/feedbackApi";
import "./feedback.css";

/**
 * "Was this helpful?" — a calm, honest quality signal (M5 query mining).
 *
 * Non-negotiables honoured: neutral copy, no urgency, no purchase pressure,
 * no dark patterns. It fires `report_feedback` exactly once per report view;
 * once a rating is chosen the control is disabled and simply acknowledges the
 * response. A thumbs-down never nags for a reason or reroutes the user.
 */
export function FeedbackButtons({ reportId }: { reportId: string }) {
  const [chosen, setChosen] = useState<FeedbackRating | null>(null);

  const choose = (rating: FeedbackRating): void => {
    if (chosen !== null) return;
    setChosen(rating);
    sendFeedback(reportId, rating);
  };

  return (
    <section className="feedback" aria-label="Was this report helpful?">
      <p className="micro-copy feedback__prompt">
        {chosen === null ? "Was this helpful?" : "Thanks — noted."}
      </p>
      <div className="feedback__buttons" role="group" aria-label="Rate this report">
        <button
          type="button"
          className={`feedback__button${chosen === "up" ? " feedback__button--chosen" : ""}`}
          onClick={() => choose("up")}
          disabled={chosen !== null}
          aria-pressed={chosen === "up"}
          aria-label="Yes, this was helpful"
        >
          <span aria-hidden="true">👍</span> Yes
        </button>
        <button
          type="button"
          className={`feedback__button${chosen === "down" ? " feedback__button--chosen" : ""}`}
          onClick={() => choose("down")}
          disabled={chosen !== null}
          aria-pressed={chosen === "down"}
          aria-label="No, this missed the mark"
        >
          <span aria-hidden="true">👎</span> No
        </button>
      </div>
    </section>
  );
}
