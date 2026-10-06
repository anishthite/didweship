import type { ChannelSnapshot } from "../snapshot";
import { Heatmap } from "./Heatmap";

/**
 * One channel panel. Borderless, on the same horizontal baseline as
 * everything else on the page. Stats sit on one row (streak | today |
 * longest) on every viewport — no mobile column stack — to honor the
 * "keep everything on the same horizontal line" directive.
 */
export function MagiPanel({
  label,
  unit,
  data,
  href,
}: {
  label: string;
  unit: string;
  data: ChannelSnapshot;
  href?: string;
}) {
  const today = data.today_count;
  const live = today > 0;
  const icon =
    label === "GITHUB" ? (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-5 w-5 fill-current sm:h-6 sm:w-6">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.8c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    ) : label === "X" ? (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-current sm:h-7 sm:w-7">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231L18.244 2.25Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
      </svg>
    ) : null;

  return (
    <section className="min-w-0 py-2 sm:py-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 sm:gap-x-4">
        <header className="flex items-center gap-2 text-nerv-orange">
          {href ? (
            <a
              href={href}
              className="flex items-center gap-2 hover:text-nerv-amber focus:text-nerv-amber"
            >
              {icon}
              {label === "X" ? (
                <span className="sr-only">X</span>
              ) : (
                <span className="font-mono text-lg sm:text-xl uppercase tracking-[0.12em]">
                  {label}
                </span>
              )}
            </a>
          ) : (
            <>
              {icon}
              {label === "X" ? (
                <span className="sr-only">X</span>
              ) : (
                <span className="font-mono text-lg sm:text-xl uppercase tracking-[0.12em]">
                  {label}
                </span>
              )}
            </>
          )}
        </header>

        <dl className="grid grid-cols-3 divide-x divide-nerv-text/15 border-y border-nerv-text/15">
          <div className="min-w-0 px-2 py-2 sm:px-3 sm:py-3">
            <dt className="mb-0.5 text-[8px] sm:text-[10px] uppercase tracking-widest text-nerv-text/60">
              streak
            </dt>
            <dd className="flex items-baseline gap-1 whitespace-nowrap">
              <span className="text-xl sm:text-3xl leading-none tabular-nums text-nerv-orange">
                {data.streak_current}
              </span>
              <span className="text-[11px] sm:text-sm normal-case text-nerv-text/75">days</span>
            </dd>
          </div>

          <div className="min-w-0 px-2 py-2 sm:px-3 sm:py-3">
            <dt className="mb-0.5 text-[8px] sm:text-[10px] uppercase tracking-widest text-nerv-text/60">
              today
            </dt>
            <dd className="flex items-baseline gap-1 whitespace-nowrap">
              <span
                className={
                  "text-xl sm:text-3xl leading-none tabular-nums " +
                  (live ? "text-nerv-amber" : "text-nerv-text/80")
                }
              >
                {today}
              </span>
              <span className="text-[11px] sm:text-sm normal-case text-nerv-text/75">{unit}</span>
            </dd>
          </div>

          <div className="min-w-0 px-2 py-2 sm:px-3 sm:py-3">
            <dt className="mb-0.5 text-[8px] sm:text-[10px] uppercase tracking-widest text-nerv-text/60">
              longest
            </dt>
            <dd className="flex items-baseline gap-1 whitespace-nowrap">
              <span className="text-xl sm:text-3xl leading-none tabular-nums text-nerv-text">
                {data.streak_longest}
              </span>
              <span className="text-[11px] sm:text-sm normal-case text-nerv-text/75">days</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Center the contribution heatmap horizontally within the panel
          column. No scroll port: the heatmap is vertical (~142px wide) and
          fits every panel; body has overflow-x:hidden as the backstop. */}
      <div className="mt-4 flex justify-center w-full sm:mt-5">
        <Heatmap days={data.days} unit={unit} />
      </div>

      {/* Intensity legend — without it the color scale has no meaning. */}
      <div className="mt-3 flex items-center justify-center gap-1 text-[9px] uppercase tracking-widest text-nerv-text/60">
        <span>less</span>
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <span
            key={l}
            className="inline-block w-[10px] h-[10px]"
            style={{ backgroundColor: `var(--cell-${l})` }}
          />
        ))}
        <span>more</span>
      </div>
    </section>
  );
}
