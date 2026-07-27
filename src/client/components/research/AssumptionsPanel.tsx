import { nanoid } from "nanoid";
import { useState, type FormEvent } from "react";
import type { Assumption } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { Sheet } from "../ui/Sheet";
import type { SendControl } from "./useResearchSession";

const MIN_TEXT = 3;
const MAX_TEXT = 300;

interface AssumptionsPanelProps {
  assumptions: Assumption[];
  researchId: string | null;
  /** Controls render but disable once the run is no longer steerable. */
  canSteer: boolean;
  sendControl: SendControl;
}

/**
 * "What we assumed", live and editable: chips toggle affirm/dismiss in place,
 * the sheet rewords or adds assumptions. Every action is a mid-run control —
 * optimistic locally, acknowledged by the server, rolled back on failure.
 */
export function AssumptionsPanel({
  assumptions,
  researchId,
  canSteer,
  sendControl,
}: AssumptionsPanelProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const emit = (action: "affirmed" | "dismissed" | "reworded" | "added"): void => {
    if (researchId !== null) track({ name: "assumption_edited", researchId, action });
  };

  const toggleAssumption = async (assumption: Assumption): Promise<void> => {
    const affirmed = !assumption.affirmed;
    const ok = await sendControl(
      { type: "set-assumption", controlId: nanoid(12), assumptionId: assumption.id, affirmed },
      (current) => ({
        assumptions: current.assumptions.map((item) =>
          item.id === assumption.id ? { ...item, affirmed } : item,
        ),
      }),
    );
    if (ok) emit(affirmed ? "affirmed" : "dismissed");
  };

  const rewordAssumption = async (assumption: Assumption, text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_TEXT || trimmed === assumption.text) return false;
    const ok = await sendControl(
      {
        type: "set-assumption",
        controlId: nanoid(12),
        assumptionId: assumption.id,
        affirmed: true, // Rewording an assumption is affirming your version of it.
        text: trimmed,
      },
      (current) => ({
        assumptions: current.assumptions.map((item) =>
          item.id === assumption.id ? { ...item, text: trimmed, affirmed: true } : item,
        ),
      }),
    );
    if (ok) emit("reworded");
    return ok;
  };

  const addAssumption = async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_TEXT) return false;
    const controlId = nanoid(12);
    const ok = await sendControl(
      { type: "add-assumption", controlId, text: trimmed },
      (current) => ({
        assumptions: [
          ...current.assumptions,
          { id: `user-${controlId}`, text: trimmed, origin: "user" as const, affirmed: true },
        ],
      }),
    );
    if (ok) emit("added");
    return ok;
  };

  if (assumptions.length === 0 && !canSteer) return null;

  return (
    <section className="research__assumptions" aria-label="What we assumed">
      <div className="research__assumptions-head">
        <h2 className="kicker">What we assumed</h2>
        <button type="button" className="research__review" onClick={() => setSheetOpen(true)}>
          {canSteer ? "Edit & add" : "Review"}
        </button>
      </div>
      {assumptions.length === 0 ? (
        <p className="micro-copy research__assumptions-empty">
          Inferring assumptions from your prompt…
        </p>
      ) : (
        <ul className="research__chips">
          {assumptions.map((assumption) => (
            <li key={assumption.id}>
              <button
                type="button"
                className={chipClass(assumption)}
                aria-pressed={assumption.affirmed}
                disabled={!canSteer}
                onClick={() => void toggleAssumption(assumption)}
              >
                {assumption.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canSteer ? (
        <p className="micro-copy research__steer-hint">
          Tap to affirm or dismiss — edits redirect the research live.
        </p>
      ) : null}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="What we assumed"
        description={
          canSteer
            ? "These assumptions are steering the research. Toggle, reword, or add — changes redirect the remaining work."
            : "These assumptions steered the research, shown exactly as the engine used them."
        }
      >
        <ul className="research__sheet-list">
          {assumptions.map((assumption) => (
            <AssumptionRow
              key={assumption.id}
              assumption={assumption}
              canSteer={canSteer}
              onToggle={() => void toggleAssumption(assumption)}
              onReword={(text) => rewordAssumption(assumption, text)}
            />
          ))}
        </ul>
        {canSteer ? <AddForm label="Add an assumption" placeholder="e.g. Budget under $300" onSubmit={addAssumption} /> : null}
      </Sheet>
    </section>
  );
}

function chipClass(assumption: Assumption): string {
  if (assumption.affirmed) return "research__chip research__chip--affirmed";
  return "research__chip research__chip--dismissed";
}

interface AssumptionRowProps {
  assumption: Assumption;
  canSteer: boolean;
  onToggle: () => void;
  onReword: (text: string) => Promise<boolean>;
}

function AssumptionRow({ assumption, canSteer, onToggle, onReword }: AssumptionRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(assumption.text);
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    const ok = await onReword(draft);
    setSaving(false);
    if (ok || draft.trim() === assumption.text) setEditing(false);
  };

  if (editing) {
    return (
      <li className="research__sheet-row research__sheet-row--editing">
        <form className="research__edit-form" onSubmit={(event) => void save(event)}>
          <label className="visually-hidden" htmlFor={`edit-${assumption.id}`}>
            Edit assumption
          </label>
          <input
            id={`edit-${assumption.id}`}
            className="research__text-input"
            value={draft}
            maxLength={MAX_TEXT}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="research__edit-actions">
            <button
              type="submit"
              className="research__mini-button research__mini-button--primary"
              disabled={saving || draft.trim().length < MIN_TEXT}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="research__mini-button"
              onClick={() => {
                setDraft(assumption.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="research__sheet-row">
      <button
        type="button"
        className={`research__sheet-mark${assumption.affirmed ? " research__sheet-mark--on" : ""}`}
        aria-pressed={assumption.affirmed}
        aria-label={`${assumption.affirmed ? "Dismiss" : "Affirm"}: ${assumption.text}`}
        disabled={!canSteer}
        onClick={onToggle}
      >
        <span aria-hidden="true">{assumption.affirmed ? "✓" : "·"}</span>
      </button>
      <span className={assumption.affirmed ? undefined : "research__sheet-text--dismissed"}>
        {assumption.text}
      </span>
      {canSteer ? (
        <button type="button" className="research__mini-button" onClick={() => setEditing(true)}>
          Reword
        </button>
      ) : (
        <span className="micro-copy">{assumption.origin === "inferred" ? "Inferred" : "Yours"}</span>
      )}
    </li>
  );
}

interface AddFormProps {
  label: string;
  placeholder: string;
  onSubmit: (text: string) => Promise<boolean>;
}

/** Shared "add a …" free-text form used by assumptions and plan questions. */
export function AddForm({ label, placeholder, onSubmit }: AddFormProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || text.trim().length < MIN_TEXT) return;
    setBusy(true);
    const ok = await onSubmit(text);
    setBusy(false);
    if (ok) setText("");
  };

  return (
    <form className="research__add-form" onSubmit={(event) => void submit(event)}>
      <label className="visually-hidden" htmlFor={`add-${label.replace(/\s+/g, "-")}`}>
        {label}
      </label>
      <input
        id={`add-${label.replace(/\s+/g, "-")}`}
        className="research__text-input"
        placeholder={placeholder}
        value={text}
        maxLength={MAX_TEXT}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="submit"
        className="research__mini-button research__mini-button--primary"
        disabled={busy || text.trim().length < MIN_TEXT}
      >
        {busy ? "Adding…" : label}
      </button>
    </form>
  );
}
