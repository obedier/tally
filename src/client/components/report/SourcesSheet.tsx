import type { Report, SourceClass } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { Sheet } from "../ui/Sheet";

const SOURCE_CLASS_LABELS: Record<SourceClass, string> = {
  manufacturer: "Manufacturer",
  retailer: "Retailer",
  editorial: "Editorial",
  "owner-review": "Owner reviews",
  other: "Web",
};

interface SourcesSheetProps {
  report: Report;
  open: boolean;
  onClose: () => void;
}

/** Every source as a real external link; clicks emit source_clicked. */
export function SourcesSheet({ report, open, onClose }: SourcesSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sources"
      description={`${report.sources.length} grounded sources across ${report.meta.sourceDiversity.classesRepresented.length} evidence classes back this report.`}
    >
      {report.sources.length === 0 ? (
        <p className="small-copy">No sources were recorded for this report.</p>
      ) : (
        <ul className="sources__list">
          {report.sources.map((source) => (
            <li key={source.id}>
              <a
                className="sources__link"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  track({
                    name: "source_clicked",
                    reportId: report.id,
                    sourceId: source.id,
                    sourceClass: source.sourceClass,
                  })
                }
              >
                <span className="sources__title">{source.title}</span>
                <span className="micro-copy sources__meta">
                  {source.title.trim().toLowerCase() === source.domain.trim().toLowerCase()
                    ? SOURCE_CLASS_LABELS[source.sourceClass]
                    : `${source.domain} · ${SOURCE_CLASS_LABELS[source.sourceClass]}`}
                  <span aria-hidden="true"> ↗</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
