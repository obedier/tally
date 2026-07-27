import { useEffect, useRef, type ReactNode } from "react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Bottom sheet on small screens, centered panel at desktop widths.
 * Escape and scrim close it; focus moves in on open and the page behind
 * stops scrolling while it is up. Transform/opacity animation only.
 */
export function Sheet({ open, onClose, title, description, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet" role="presentation">
      <button
        type="button"
        className="sheet__scrim"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="sheet__head">
          <div>
            <h2 className="display display--title">{title}</h2>
            {description ? <p className="small-copy sheet__description">{description}</p> : null}
          </div>
          <button type="button" className="sheet__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
