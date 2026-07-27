import { Link } from "react-router-dom";

/** Thin-stroke spyglass, part of the Tally lockup. */
export function Spyglass({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.75" />
      <line x1="15.6" y1="15.6" x2="21" y2="21" />
    </svg>
  );
}

interface LockupProps {
  /** "full" renders wordmark · spyglass · divider · tagline; "mini" is the wordmark link. */
  variant?: "full" | "mini";
}

/** The Tally brand lockup. Exact tagline string per docs/PRODUCT.md. */
export function Lockup({ variant = "full" }: LockupProps) {
  if (variant === "mini") {
    return (
      <Link to="/" className="lockup lockup--mini" aria-label="Tally home">
        <span className="lockup__wordmark">Tally</span>
      </Link>
    );
  }
  return (
    <header className="lockup" aria-label="Tally — Deep product research.">
      <span className="lockup__wordmark">Tally</span>
      <Spyglass className="lockup__glass" />
      <i className="lockup__divider" aria-hidden="true" />
      <span className="lockup__tagline">Deep product research.</span>
    </header>
  );
}
