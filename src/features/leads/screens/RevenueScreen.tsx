/**
 * Revenue (/reports/revenue).
 *
 * The recurring-revenue view of D20: a deal can carry a one-time price and a
 * monthly price side by side, and this screen is what the monthly side adds
 * up to. `useRevenue` reads one bundle - `revenue(revenueParams())` in
 * `src/db/repos/reports.ts` - so every figure on the page is computed from
 * the same set of active deals, as of the same clock read.
 *
 * MRR is the biggest thing on the page on purpose: it is the number that
 * answers "what do I actually have coming in every month," which upfront
 * money and one-time deal values do not. ARR sits one step down beside it,
 * because it is the same fact restated over a year, not a second fact.
 *
 * Beside that sits the period's own money: Quoted, Won, Invoiced, Collected
 * and what is still owed on what it billed, from src/db/repos/money.ts, with
 * the same four columns deal by deal. Those five move with the period picker;
 * MRR does not, and the card says so.
 *
 * The page wears `ReportsFrame`, which is the fix for the dead end Walker hit:
 * this screen used to render a title and nothing else, so the only way off it
 * was the sidebar. Now it carries the same tab strip as every other report and
 * the period control changes state rather than the URL.
 *
 * There is no primary button here. A report is something the owner reads,
 * matching the rest of Reports (docs/DESIGN.md's "one primary block per
 * view" - this screen spends none).
 */
import { useState, type Key } from "react";
import { Line, LabelList, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner, toast } from "@/ui";
import { AgingBlock } from "@/features/invoices";
import { centsToDecimalString } from "@/lib/money";
import { formatBucket, periodFor } from "@/lib/periods";
import type { Period } from "@/lib/periods";
import { useFormats } from "@/app/formats";
import { toCsv, useRevenue, useRevenueMoney } from "@/features/leads/lib/reportKeys";
import type { RevenueBundle, RevenueMoney } from "@/db/repos/reports";
import { NO_DEAL_ROW_ID } from "@/db/repos/money";
import type { PerDealMoneyRow } from "@/db/repos/money";

/**
 * What the catch-all row is, in the one place it is explained. Kept short
 * enough to sit in a table cell: the long version is that the document either
 * predates the rule that every document belongs to a deal, or its deal is in
 * the trash.
 */
const NO_DEAL_HINT = "Invoices not attached to a job";
import { ReportsFrame } from "@/features/leads/components/ReportsFrame";
import { DataTable } from "@/features/leads/components/DataTable";
import type { DataTableColumn } from "@/features/leads/components/DataTable";
import {
  CHART_ANIMATION_ACTIVE,
  CHART_AXIS_LINE,
  CHART_BAR_PRIMARY,
  CHART_CURSOR_FILL,
  CHART_LABEL_STYLE,
  CHART_TICK_LINE,
  CHART_TICK_STYLE,
  ChartFigure,
  ChartTooltipContent,
} from "@/features/leads/components/charts";

type RecurringDealRow = RevenueBundle["active"][number];

export function RevenueScreen() {
  // MRR is read as of today whatever range is chosen, so the picker moves only
  // the four money numbers and the table under them. The page says so in words
  // rather than making the owner work it out from which figures move.
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const query = useRevenue();
  const moneyQuery = useRevenueMoney(period);

  return (
    <ReportsFrame
      active="revenue"
      title="Revenue"
      subtitle="What repeats every month, and what the period quoted, won, invoiced and collected."
      period={{ value: period, onChange: setPeriod }}
    >
      {query.isPending ? (
        <div className="flex justify-center py-[var(--space-10)]">
          <Spinner label="Loading revenue" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="Revenue could not load"
          description={
            query.error instanceof Error
              ? query.error.message
              : "The database gave no reason. Try reloading the page."
          }
        />
      ) : query.data ? (
        <RevenueContent data={query.data} money={moneyQuery.data ?? null} period={period} />
      ) : null}
    </ReportsFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* The four money numbers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Quoted, Won, Invoiced, Collected - and what is still owed on what this
 * period billed.
 *
 * Every one is on its own clock by design (src/db/repos/money.ts says which),
 * so Collected can be larger than Invoiced in a month where last month's
 * invoices were paid, and a deal can be Quoted in one month and Won in the
 * next. The caption names all four out loud rather than leaving the owner to
 * think the page is broken.
 *
 * Quoted is the DEAL'S value now, not the sum of its quote documents, and it
 * falls on the day the deal was created - the day the owner quoted it. That is
 * a fourth clock the old caption did not have, which is why it is rewritten.
 */
function MoneyBlock(props: { money: RevenueMoney; period: Period }) {
  const { money, period } = props;
  const formats = useFormats();
  const { totals } = money;

  const columns: DataTableColumn<PerDealMoneyRow>[] = [
    {
      key: "deal",
      header: "Deal",
      // The catch-all row is not a deal and has nowhere to link to: it is the
      // money in the headline that belongs to a document whose job was never
      // recorded or has since been deleted. It carries its own explanation so
      // the column still adds up to the figure above it (F-LB-3).
      render: (row) =>
        row.dealId === NO_DEAL_ROW_ID ? (
          <span className="block truncate text-[var(--color-text-muted)]" title={NO_DEAL_HINT}>
            {row.title}
          </span>
        ) : (
          <Link
            href={`/deals/${row.dealId}`}
            title={row.title}
            className="block truncate text-[var(--color-link)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            {row.title}
          </Link>
        ),
    },
    {
      key: "customer",
      header: "Customer",
      // A customer name is a name (docs/DESIGN.md §4): it truncates with an
      // ellipsis and carries a title, it never wraps inside the row.
      render: (row) =>
        row.dealId === NO_DEAL_ROW_ID ? (
          <span className="block truncate text-[var(--color-text-muted)]" title={NO_DEAL_HINT}>
            {NO_DEAL_HINT}
          </span>
        ) : (
          <span className="block truncate" title={row.customerName ?? undefined}>
            {row.customerName ?? "—"}
          </span>
        ),
    },
    {
      key: "quoted",
      header: "Quoted",
      numeric: true,
      dashZero: (row) => row.quotedCents === 0,
      render: (row) => formats.moneyOrDash(row.quotedCents),
    },
    {
      key: "won",
      header: "Won",
      numeric: true,
      dashZero: (row) => row.wonCents === 0,
      render: (row) => formats.moneyOrDash(row.wonCents),
    },
    {
      key: "invoiced",
      header: "Invoiced",
      numeric: true,
      dashZero: (row) => row.invoicedCents === 0,
      render: (row) => formats.moneyOrDash(row.invoicedCents),
    },
    {
      key: "collected",
      header: "Collected",
      numeric: true,
      dashZero: (row) => row.collectedCents === 0,
      render: (row) => formats.moneyOrDash(row.collectedCents),
    },
  ];

  async function handleCopyCsv() {
    const csv = toCsv(
      ["Deal", "Customer", "Quoted", "Won", "Invoiced", "Collected"],
      money.perDeal.map((row) => [
        row.title,
        row.dealId === NO_DEAL_ROW_ID ? NO_DEAL_HINT : (row.customerName ?? ""),
        centsToDecimalString(row.quotedCents),
        centsToDecimalString(row.wonCents),
        centsToDecimalString(row.invoicedCents),
        centsToDecimalString(row.collectedCents),
      ]),
    );
    try {
      await navigator.clipboard.writeText(csv);
      toast.success("Copied the report to the clipboard");
    } catch {
      toast.error("The clipboard refused it.");
    }
  }

  return (
    <Card>
      <CardHeader className="px-[var(--space-5)] py-[var(--space-4)]">
        <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
          <CardTitle>{period.label}</CardTitle>
          <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Quoted, won, invoiced and collected each fall on their own day, so a month can
            collect more than it billed, or win what it quoted last month.
          </p>
        </div>
        {money.perDeal.length > 0 ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={handleCopyCsv}>
            Copy as CSV
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="p-[var(--space-5)]">
        <div className="flex flex-wrap gap-[var(--space-10)]">
          <HeadlineFigure
            label="Quoted"
            value={formats.money(totals.quotedCents)}
            sizeClass="text-[length:var(--text-xl)]"
          />
          <HeadlineFigure
            label="Won"
            value={formats.money(totals.wonCents)}
            sizeClass="text-[length:var(--text-xl)]"
          />
          <HeadlineFigure
            label="Invoiced"
            value={formats.money(totals.invoicedCents)}
            sizeClass="text-[length:var(--text-xl)]"
          />
          <HeadlineFigure
            label="Collected"
            value={formats.money(totals.collectedCents)}
            sizeClass="text-[length:var(--text-xl)]"
          />
          <HeadlineFigure
            label="Still owed on it"
            value={formats.money(totals.outstandingCents)}
            sizeClass="text-[length:var(--text-xl)]"
          />
        </div>
      </CardBody>
      {money.perDeal.length === 0 ? (
        <EmptyState
          variant="quiet"
          title="No deal moved money in this period"
          description="Pick a wider range and the ones that did show up here."
        />
      ) : (
        <DataTable columns={columns} rows={money.perDeal} getRowKey={(row) => row.dealId} />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Headline figures                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One figure in the headline row: the value in the heading face, a caption
 * label under it. `sizeClass` is a literal Tailwind arbitrary-value class at
 * each call site (never composed at runtime) so the token it names is one
 * Tailwind's build can actually see.
 *
 * Every headline figure on this page shares this one component, one size per
 * row (the MRR row's own figure is the page's single biggest number; every
 * other figure on the page, in the MRR row and in the period's money row
 * alike, is `--text-xl`) and full ink - a real number is never muted just
 * because it happens to read as a negative or an amount still outstanding
 * (CDQO phase two design review, decision C; docs/DESIGN.md rule 5).
 */
function HeadlineFigure(props: { label: string; value: string; sizeClass: string }) {
  const { label, value, sizeClass } = props;
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span
        className={[
          "tabular",
          "font-[family-name:var(--font-heading)] font-bold leading-[var(--leading-heading)]",
          sizeClass,
          "text-[var(--color-heading)]",
        ].join(" ")}
      >
        {value}
      </span>
      <span className="text-[length:var(--text-caption)] text-[var(--color-text-muted)]">
        {label}
      </span>
    </div>
  );
}

/**
 * Churned MRR reads as a negative, in full ink like every other headline
 * figure on the page: docs/DESIGN.md reserves the danger colour for something
 * wrong, and a deal ending its recurring line on schedule is not that, so
 * there is no reason to mute it either. Zero churn is still zero, not
 * "-$0.00".
 */
function formatChurned(cents: number, money: (cents: number) => string): string {
  return cents === 0 ? money(0) : `-${money(cents)}`;
}

/* -------------------------------------------------------------------------- */
/* MRR by month                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Direct labels on the line: only the first and last point carry a figure,
 * which is what lets the chart drop the value axis entirely. The middle
 * points return null - `RenderableText` allows it - rather than crowding
 * twelve months of numbers along one line.
 */
function edgeLabel(count: number, money: (cents: number) => string) {
  // recharts hands a label renderer numbers or strings depending on the axis,
  // so the two coordinates are read as `unknown` and coerced once here rather
  // than trusted.
  return (props: { x?: unknown; y?: unknown; value?: unknown; index?: number }) => {
    const { value, index } = props;
    const x = Number(props.x);
    const y = Number(props.y);
    if (index === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (index !== 0 && index !== count - 1) return null;
    const isFirst = index === 0;
    return (
      <text x={x} y={y - 10} textAnchor={isFirst ? "start" : "end"} style={CHART_LABEL_STYLE}>
        {money(Number(value))}
      </text>
    );
  };
}

/**
 * Only the last point on the line gets a dot; the rest are bare.
 *
 * The parameter is typed structurally rather than with recharts' own
 * `DotProps`: the library hands a dot renderer a wider shape than that type
 * describes (its `points` is an array, not the SVG string attribute), so
 * naming the three fields this renderer actually reads is both honest and the
 * only version that type-checks.
 */
function edgeDot(count: number) {
  return (props: { index?: number; cx?: number; cy?: number; key?: Key | null }) => {
    const { index, cx, cy } = props;
    const key = props.key ?? undefined;
    if (index !== count - 1 || cx === undefined || cy === undefined) {
      return <circle key={key} cx={cx} cy={cy} r={0} fill="none" />;
    }
    return <circle key={key} cx={cx} cy={cy} r={3} fill={CHART_BAR_PRIMARY} stroke="none" />;
  };
}

function MrrChart(props: { byMonth: RevenueBundle["byMonth"]; mrrCents: number }) {
  const { byMonth, mrrCents } = props;
  const formats = useFormats();
  const data = byMonth.map((point) => ({ bucket: point.bucket, mrrCents: point.mrrCents }));
  const ariaLabel = `Monthly recurring revenue over the last twelve months, now ${formats.money(mrrCents)} a month`;

  return (
    <ChartFigure ariaLabel={ariaLabel} height={260}>
      <LineChart data={data} margin={{ top: 28, right: 16, bottom: 0, left: 16 }}>
        <XAxis
          dataKey="bucket"
          tick={CHART_TICK_STYLE}
          axisLine={CHART_AXIS_LINE}
          tickLine={CHART_TICK_LINE}
          tickFormatter={(value) => formatBucket(String(value))}
        />
        <YAxis type="number" hide domain={["dataMin", "dataMax"]} />
        <Tooltip
          cursor={CHART_CURSOR_FILL}
          content={(tooltipProps) => (
            <ChartTooltipContent {...tooltipProps} formatValue={(value) => formats.money(value)} />
          )}
        />
        <Line
          type="monotone"
          dataKey="mrrCents"
          name="MRR"
          stroke={CHART_BAR_PRIMARY}
          strokeWidth={2}
          dot={edgeDot(data.length)}
          isAnimationActive={CHART_ANIMATION_ACTIVE}
        >
          <LabelList dataKey="mrrCents" content={edgeLabel(data.length, formats.money)} />
        </Line>
      </LineChart>
    </ChartFigure>
  );
}

/* -------------------------------------------------------------------------- */
/* Active recurring deals                                                      */
/* -------------------------------------------------------------------------- */

function DealCell(props: { row: RecurringDealRow }) {
  const { row } = props;
  return (
    <Link
      href={`/deals/${row.dealId}`}
      title={row.title}
      className="block truncate text-[var(--color-link)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
    >
      {row.title}
    </Link>
  );
}

function customerName(row: RecurringDealRow): string {
  return row.companyName ?? row.contactName ?? "—";
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

function RevenueContent(props: {
  data: RevenueBundle;
  money: RevenueMoney | null;
  period: Period;
}) {
  const { data, money, period } = props;
  const formats = useFormats();
  // The whole page stands down only when there is no money of either kind to
  // show. Upfront revenue with nothing recurring is a real state - a trade
  // that has not sold a plan yet - and hiding this quarter's won work behind
  // "no recurring revenue yet" would be a lie about the business.
  const noRecurring = data.mrrCents === 0 && data.active.length === 0;
  const noUpfront =
    data.upfrontMonthCents === 0 &&
    data.upfrontQuarterCents === 0 &&
    data.upfrontYearCents === 0;

  const noMoney =
    money === null ||
    (money.totals.quotedCents === 0 &&
      money.totals.wonCents === 0 &&
      money.totals.invoicedCents === 0 &&
      money.totals.collectedCents === 0);

  if (noRecurring && noUpfront && noMoney) {
    return (
      <EmptyState
        title="No revenue yet"
        description="Win a deal and what it is worth shows up here, up front and every month."
      />
    );
  }

  const columns: DataTableColumn<RecurringDealRow>[] = [
    { key: "deal", header: "Deal", render: (row) => <DealCell row={row} /> },
    {
      key: "customer",
      header: "Customer",
      // A customer name is a name (docs/DESIGN.md §4): it truncates with an
      // ellipsis and carries a title, it never wraps inside the row.
      render: (row) => (
        <span className="block truncate" title={customerName(row)}>
          {customerName(row)}
        </span>
      ),
    },
    { key: "started", header: "Started", render: (row) => formats.date(row.startedOn) },
    {
      key: "monthly",
      header: "Monthly",
      numeric: true,
      render: (row) => formats.money(row.monthlyCents),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-wrap items-end gap-[var(--space-10)]">
        <HeadlineFigure
          label="Monthly recurring revenue"
          value={formats.money(data.mrrCents)}
          sizeClass="text-[length:var(--text-3xl)]"
        />
        <HeadlineFigure
          label="A year of that"
          value={formats.money(data.arrCents)}
          sizeClass="text-[length:var(--text-xl)]"
        />
        <HeadlineFigure
          label="New this month"
          value={formats.money(data.newMrrCents)}
          sizeClass="text-[length:var(--text-xl)]"
        />
        <HeadlineFigure
          label="Churned this month"
          value={formatChurned(data.churnedMrrCents, formats.money)}
          sizeClass="text-[length:var(--text-xl)]"
        />
      </div>

      {money ? <MoneyBlock money={money} period={period} /> : null}

      {noRecurring ? null : (
        <Card>
          <CardHeader className="px-[var(--space-5)] py-[var(--space-4)]">
            <CardTitle>MRR by month</CardTitle>
          </CardHeader>
          <CardBody className="p-[var(--space-5)]">
            <MrrChart byMonth={data.byMonth} mrrCents={data.mrrCents} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="px-[var(--space-5)] py-[var(--space-4)]">
          <CardTitle>Upfront revenue won</CardTitle>
        </CardHeader>
        <CardBody className="p-[var(--space-5)]">
          <div className="flex flex-wrap gap-[var(--space-10)]">
            <HeadlineFigure
              label="This month"
              value={formats.money(data.upfrontMonthCents)}
              sizeClass="text-[length:var(--text-2xl)]"
            />
            <HeadlineFigure
              label="This quarter"
              value={formats.money(data.upfrontQuarterCents)}
              sizeClass="text-[length:var(--text-2xl)]"
            />
            <HeadlineFigure
              label="This year"
              value={formats.money(data.upfrontYearCents)}
              sizeClass="text-[length:var(--text-2xl)]"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="px-[var(--space-5)] py-[var(--space-4)]">
          <CardTitle>Active recurring deals</CardTitle>
        </CardHeader>
        {noRecurring ? (
          <EmptyState
            variant="quiet"
            title="Nothing repeats yet"
            description="Win a deal with a monthly service on it and it lands here."
          />
        ) : (
          <DataTable columns={columns} rows={data.active} getRowKey={(row) => row.dealId} />
        )}
      </Card>

      {/* What is booked is only half the question; the other half is what has
          actually been collected. The invoices feature owns this block and the
          detail behind it at /reports/receivables. */}
      <AgingBlock />
    </div>
  );
}

export default RevenueScreen;
