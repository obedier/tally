import { nanoid } from "nanoid";
import type { PlanQuestion } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { AddForm } from "./AssumptionsPanel";
import type { SendControl, SuggestedQuestion } from "./useResearchSession";

interface PlanEditorProps {
  questions: PlanQuestion[];
  suggestions: SuggestedQuestion[];
  researchId: string | null;
  canSteer: boolean;
  sendControl: SendControl;
}

/**
 * The research plan, live and editable: upcoming questions get a quiet remove
 * control, "Add a question" accepts free text while the run continues.
 * Active/done questions are immutable — spent work is never pretended away.
 * Server `plan` events remain the source of truth; optimistic edits reconcile
 * on the next one.
 */
export function PlanEditor({
  questions,
  suggestions,
  researchId,
  canSteer,
  sendControl,
}: PlanEditorProps) {
  const visibleQuestions = questions.filter((question) => question.status !== "removed");

  // A suggestion disappears once its question is in the plan (added this run or
  // replayed after a reconnect) — matched by normalized text.
  const plannedTexts = new Set(questions.map((question) => question.text.trim().toLowerCase()));
  const openSuggestions = suggestions.filter(
    (suggestion) => !plannedTexts.has(suggestion.text.trim().toLowerCase()),
  );

  const removeQuestion = async (question: PlanQuestion): Promise<void> => {
    const ok = await sendControl(
      { type: "remove-question", controlId: nanoid(12), questionId: question.id },
      (current) => ({
        questions: current.questions.map((item) =>
          item.id === question.id ? { ...item, status: "removed" as const } : item,
        ),
      }),
    );
    if (ok && researchId !== null) {
      track({
        name: "question_edited",
        researchId,
        action: "removed",
        questionId: question.origin === "playbook" ? question.id : null,
      });
    }
  };

  const addQuestion = async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    const controlId = nanoid(12);
    const ok = await sendControl(
      { type: "add-question", controlId, text: trimmed },
      (current) => ({
        questions: [
          ...current.questions,
          {
            id: `user-${controlId}`,
            text: trimmed,
            status: "pending" as const,
            whyItMatters: null,
            origin: "user" as const,
            sourceCount: 0,
          },
        ],
      }),
    );
    if (ok && researchId !== null) {
      track({ name: "question_edited", researchId, action: "added", questionId: null });
    }
    return ok;
  };

  return (
    <section className="research__plan" aria-label="Research plan">
      <h2 className="display display--title">Here&rsquo;s what we&rsquo;re checking.</h2>
      {visibleQuestions.length === 0 ? (
        <div className="research__plan-loading">
          <div className="skeleton research__plan-skeleton" />
          <div className="skeleton research__plan-skeleton" />
          <div className="skeleton research__plan-skeleton" />
          <p className="micro-copy">Drafting the research plan for this query…</p>
        </div>
      ) : (
        <ol className="research__questions">
          {visibleQuestions.map((question, index) => (
            <li
              key={question.id}
              className={`research__question research__question--${question.status}`}
            >
              <span className="research__marker" aria-hidden="true">
                {question.status === "done" ? "✓" : index + 1}
              </span>
              <div>
                <p className="research__question-text">{question.text}</p>
                {question.status === "active" ? (
                  <p className="micro-copy research__question-live">
                    <span className="research__pulse research__pulse--accent" aria-hidden="true" />
                    Researching now
                    {question.sourceCount > 0 ? ` · ${question.sourceCount} sources` : ""}
                  </p>
                ) : null}
                {question.status === "active" && question.whyItMatters ? (
                  <p className="micro-copy research__why">
                    Why this matters: {question.whyItMatters}
                  </p>
                ) : null}
              </div>
              {canSteer && question.status === "pending" ? (
                <button
                  type="button"
                  className="research__mini-button research__remove"
                  aria-label={`Remove question: ${question.text}`}
                  onClick={() => void removeQuestion(question)}
                >
                  Remove
                </button>
              ) : (
                <span className="micro-copy research__status-label">
                  {question.status === "done"
                    ? "Complete"
                    : question.status === "active"
                      ? "In progress"
                      : "Upcoming"}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {canSteer && visibleQuestions.length > 0 && openSuggestions.length > 0 ? (
        <div className="research__suggestions" aria-label="Suggested questions">
          <p className="micro-copy research__suggestions-label">Also worth checking — tap to add:</p>
          <div className="research__suggestion-chips">
            {openSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="research__suggestion-chip"
                onClick={() => void addQuestion(suggestion.text)}
              >
                + {suggestion.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {canSteer && visibleQuestions.length > 0 ? (
        <div className="research__plan-add">
          <AddForm
            label="Add a question"
            placeholder="e.g. How loud is it on hard floors?"
            onSubmit={addQuestion}
          />
          <p className="micro-copy">New questions run with the remaining research.</p>
        </div>
      ) : null}
    </section>
  );
}
