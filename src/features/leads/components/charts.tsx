/**
 * Shared chart primitives for the Reports screen.
 *
 * Every report chart is a recharts `BarChart`, so the pieces that would
 * otherwise be copy-pasted five times live here instead: the mark specs, the
 * axis styling, the accessible figure wrapper, and a tooltip content renderer
 * that keeps values first and labels second, keyed by a short line of the
 * series colour rather than a filled box.
 *
 * Colour. A chart is not allowed its own palette, so it draws from the brand:
 *
 *   - a series whose category IS a pipeline stage takes that stage's own
 *     colour, which the stage row already carries as `var(--stage-N)`;
 *   - the leading series everywhere else is the brand primary. That is the
 *     screen's one confident block of colour, which is why no report card
 *     also carries a primary button;
 *   - a second series beside it is the brand secondary, and anything
 *     subordinate to both is a neutral.
 *
 * The accent stays out of the bars on purpose. It is a pale yellow meant to
 * be a detail on a dark or saturated surface, and a bar of it on the
 * near-white report canvas is a shape the owner cannot read.
 *
 * Every value here is a `var(--token)` string rather than a literal, so the
 * marks follow the theme: a presentation attribute is parsed as CSS, so
 * `fill="var(--brand-primary)"` resolves against whatever `data-theme` is on
 * the document, and the dark theme's charts need no second code path.
 *
 * There are no gridlines and no value axis anywhere in these reports. Every
 * bar carries its own number at the end of it, so a grid would be a second,
 * fainter copy of information the label already states exactly.
 */
import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

/**
 * Charts never animate.
 *
 * Motion answers something the owner did; it never announces itself. A bar
 * chart that grows its bars on load is an entrance animation, so it does not
 * belong here - and that rule is strictly stronger than
 * `prefers-reduced-motion`, which it therefore satisfies by construction with
 * no media query to get wrong.
 *
 * It also fixes a real defect rather than only a matter of taste: recharts
 * 3.10 withholds a `LabelList` until the series animation finishes, so an
 * animating chart shows its bars before their values. A report whose numbers
 * arrive a second after its bars is worse than one that simply draws.
 */
export const CHART_ANIMATION_ACTIVE = false;

/** Bars are never thicker than this, per the mark spec. */
export const MAX_BAR_SIZE = 20;

/**
 * Square, both ends. The brand's corner language is radius 0 on every control,
 * card and panel, and a bar with a rounded cap is the one shape on the screen
 * disagreeing with it. The two names stay so the call sites read as before.
 */
export const HORIZONTAL_BAR_RADIUS: [number, number, number, number] = [0, 0, 0, 0];
export const VERTICAL_BAR_RADIUS: [number, number, number, number] = [0, 0, 0, 0];

/** The surface-coloured gap between adjacent bars in a group. */
export const CHART_BAR_GAP = 2;

/** The leading series: the brand primary, and the screen's one block of it. */
export const CHART_BAR_PRIMARY = "var(--brand-primary)";

/** The second series beside it: the brand secondary. */
export const CHART_BAR_SECONDARY = "var(--brand-secondary)";

/**
 * No axis line and no tick line.
 *
 * A horizontal bar chart already has a baseline: the left edge every bar starts
 * from. Drawing a rule down it adds a second one, and on a chart with one or
 * two categories that rule runs the full height of the plot with nothing
 * beside it, which reads as a stray mark rather than an axis.
 */
export const CHART_AXIS_LINE = false as const;
export const CHART_TICK_LINE = false as const;

/** Axis text is a caption: the caption size, secondary ink, tabular figures. */
export const CHART_TICK_STYLE = {
  fill: "var(--color-text-muted)",
  fontSize: "var(--text-caption)",
  fontFamily: "var(--font-body)",
  fontVariantNumeric: "tabular-nums lining-nums",
} as const;

/**
 * The number at the end of a bar. It is data, so it carries full-strength ink
 * and tabular figures - the axis grey belongs to the labels around it, not to
 * the figure itself.
 */
export const CHART_LABEL_STYLE = {
  fill: "var(--color-text)",
  fontSize: "var(--text-caption)",
  fontFamily: "var(--font-body)",
  fontVariantNumeric: "tabular-nums lining-nums",
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
 * secondary (the reverse of the legend), and each row is keyed by a hairline
 * of the series colour rather than a filled swatch, per the dataviz skill's
 * "line keys, not boxes" rule at tooltip density.
 *
 * A tooltip is a floating layer, so it is the one thing on this screen allowed
 * to cast the product's single shadow.
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
        "border border-[var(--color-border)]",
        "bg-[var(--color-surface-raised)] shadow-[var(--shadow-md)]",
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
                className="inline-block h-[var(--hairline)] w-[var(--space-3)] shrink-0"
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
 * shapes in one row of ticks. A column of money that does not line up reads
 * as sloppy bookkeeping, so axis ticks are always compact and never carry
 * cents: "$0, $400, $800, $1.2K".
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
