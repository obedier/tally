/**
 * Small inline icons. Kept as components (not an icon font or sprite sheet) so
 * they inherit `currentColor` and cost nothing at runtime. The spyglass lives
 * in Lockup.tsx because it is part of the brand mark; these are UI affordances.
 */

/**
 * Map pin — the familiar teardrop-with-a-hole used by every mapping app, so it
 * reads as "location" without a label doing all the work. Filled rather than
 * stroked: at 14px a thin outline turns to mush.
 */
export function MapPin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2c-4.14 0-7.5 3.28-7.5 7.33 0 5.03 6.68 12.02 6.96 12.31a.75.75 0 0 0 1.08 0c.28-.29 6.96-7.28 6.96-12.31C19.5 5.28 16.14 2 12 2Zm0 10.08a2.83 2.83 0 1 1 0-5.66 2.83 2.83 0 0 1 0 5.66Z"
      />
    </svg>
  );
}

/**
 * Scan target — viewfinder corners around barcode bars. The corners are what
 * make it read as "point the camera at something" rather than "here is a
 * barcode", which is the difference between an action and a decoration.
 */
export function ScanTarget({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5V5a2 2 0 0 1 2-2h3.5" />
      <path d="M21 8.5V5a2 2 0 0 0-2-2h-3.5" />
      <path d="M3 15.5V19a2 2 0 0 0 2 2h3.5" />
      <path d="M21 15.5V19a2 2 0 0 1-2 2h-3.5" />
      <path d="M8 8.25v7.5M12 8.25v7.5M16 8.25v7.5" />
    </svg>
  );
}
