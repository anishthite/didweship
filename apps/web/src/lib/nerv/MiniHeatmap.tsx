import type { Day } from "../streak";
import { intensity } from "../heatmap";

/**
 * Small horizontal strip heatmap for the summary page (D-029, 2026-06-01).
 *
 * Renders the trailing `windowDays` (default 90) as a single horizontal
 * row of small cells, oldest on the left, newest on the right. No axis
 * labels, no tooltips, no day-of-week alignment. The full Heatmap
 * component is still used on /[user] for the detail view.
 *
 * Fit: the strip is fluid — cells are 1fr grid columns at a 1:1 aspect
 * ratio, capped at the natural `cellPx` width via max-width. Narrower
 * container → cells shrink instead of scrolling; no scrollbars ever.
 */

// CSS variables — light/dark palettes live in globals.css.
const CELL_COLORS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "var(--cell-0)",
  1: "var(--cell-1)",
  2: "var(--cell-2)",
  3: "var(--cell-3)",
  4: "var(--cell-4)",
};

export type MiniHeatmapProps = {
  days: Day[];
  windowDays?: number;
  cellPx?: number;
  gapPx?: number;
};

export function MiniHeatmap({
  days,
  windowDays = 90,
  cellPx = 6,
  gapPx = 1,
}: MiniHeatmapProps) {
  // Take the trailing `windowDays` so the visualization is "recent activity"
  // regardless of how long the input series is.
  const trimmed = days.slice(-windowDays);

  const naturalWidth = trimmed.length * cellPx + (trimmed.length - 1) * gapPx;

  return (
    <div
      className="w-full"
      style={{ maxWidth: naturalWidth }}
      role="img"
      aria-label={`Last ${trimmed.length} days of activity`}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${trimmed.length}, minmax(0, 1fr))`,
          gap: `${gapPx}px`,
        }}
      >
        {trimmed.map((day) => {
          const level = intensity(day.count);
          return (
            <div
              key={day.date}
              style={{
                aspectRatio: "1",
                backgroundColor: CELL_COLORS[level],
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
