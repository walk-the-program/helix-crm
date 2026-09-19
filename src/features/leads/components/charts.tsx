/**
 * Shared chart primitives for the Reports screen.
 *
 * Every report chart is a recharts `BarChart`, so the pieces that would
 * otherwise be copy-pasted five times live here instead: the mark specs, the
 * axis/grid styling (read from design tokens, never a hardcoded hex), the
 * accessible figure wrapper, and a tooltip content renderer that follows the
 * dataviz skill's rule that values lead and labels follow, keyed by a short
 * line of the series colour rather than a filled box.
 */
import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

/**
 * Charts never animate.
 *
 * docs/DESIGN.md section 8 is blunt about it: "Motion answers an action. It
 * never announces itself. No entrance animations." A bar chart that grows its
 * bars on load is an entrance animation, so it does not belong here - and
 * that rule is strictly stronger than `prefers-reduced-motion`, which it
 * therefore satisfies by construction with no media query to get wrong.
 *
 * It also fixes a real defect rather than only a matter of taste: recharts
 * 3.10 withholds a `LabelList` until the series animation finishes, so an
 * animating chart shows its bars before their values. A report whose numbers
 * arrive a second after its bars is worse than one that simply draws.
 */
export const CHART_ANIMATION_ACTIVE = false;

/** Bars are never thicker than this, per the mark spec. */
export const MAX_BAR_SIZE = 24;

/** Rounded on the data end only, square at the baseline. */
export const HORIZONTAL_BAR_RADIUS: [number, number, number, number] = [0, 4, 4, 0];
export const VERTICAL_BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** The 2px surface-coloured gap between adjacent bars in a group. */
export const CHART_BAR_GAP = 2;

/** Gridlines are hairline, solid and belong on the value axis only. */
export const CHART_GRID_STROKE = "var(--color-border)";

/** Axis line, tick line and tick text all read from the same muted tokens. */
export const CHART_AXIS_LINE = { stroke: "var(--color-border)" };
export const CHART_TICK_LINE = { stroke: "var(--color-border)" };
export const CHART_TICK_STYLE = {
  fill: "var(--color-text-muted)",
  fontSize: "var(--text-xs)",
} as const;

/** Selective direct labels use the same muted ink as axis ticks, never the mark colour. */
export const CHART_LABEL_STYLE = {
  fill: "var(--color-text-muted)",
  fontSize: "var(--text-xs)",
} as const;

/**
 * Wraps a chart in the accessible figure contract every chart needs: a
 * fixed-height `role="img"` region with an `aria-label` that states the
 * headline in words, so the chart's information survives without vision or
 * without recharts' SVG rendering at all.
 */
export function ChartFigure(props: { ariaLabel: string; height: number; children: ReactElement }) {
  const { ariaLabel, height, children } = props;
  return (
    <div role="img" aria-label={ariaLabel} style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Custom tooltip content, styled from tokens instead of recharts' default
 * inline styles. The value is the strong element and the series name is
 * secondary (the reverse of the legend), and each row is keyed by a short
 * stroke of the series colour rather than a filled swatch, per the dataviz
 * skill's "line keys, not boxes" rule at tooltip density.
 */
export function ChartTooltipContent(
  props: TooltipContentProps<ValueType, NameType> & {
    formatValue: (value: number, dataKey: string) => string;
  },
) {
  const { active, payload, label, formatValue } = props;
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className={[
        "rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]",
        "px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]",
      ].join(" ")}
    >
      {label !== undefined && label !== "" ? (
        <div className="mb-[var(--space-1)] font-medium text-[var(--color-text)]">{label}</div>
      ) : null}
      <div className="flex flex-col gap-[var(--space-1)]">
        {payload.map((entry, index) => {
          const key = String(entry.dataKey ?? entry.name ?? index);
          const numericValue = typeof entry.value === "number" ? entry.value : Number(entry.value);
          return (
            <div key={key} className="flex items-center gap-[var(--space-2)]">
              <span
                aria-hidden="true"
                className="inline-block h-[2px] w-[var(--space-3)] shrink-0"
                style={{ backgroundColor: entry.color ?? "var(--color-text-muted)" }}
              />
              <span className="text-[var(--color-text-muted)]">{entry.name}</span>
              <span className="tabular ml-auto font-medium text-[var(--color-text)]">
                {Number.isFinite(numericValue) ? formatValue(numericValue, key) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Money on a value axis, in one consistent shape.
 *
 * `formatMoneyCompact` only compacts above $1,000, so a single axis can come
 * out reading "$0.00, $400.00, $800.00, $1.2K, $1.6K" - three different
 * shapes in one row of ticks. To this audience a column of money that does
 * not line up reads as sloppy bookkeeping (docs/DESIGN.md section 4), so axis
 * ticks are always compact and never carry cents: "$0, $400, $800, $1.2K".
 * The exact figure with its two decimals is on the bar's own label, in the
 * tooltip and in the table view.
 */
export function formatAxisMoney(cents: number, currency = "USD", locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(0)}`;
  }
}

/** The cursor highlight for a hovered bar, filled from the hover token rather than a series colour. */
export const CHART_CURSOR_FILL = { fill: "var(--color-hover)" };
