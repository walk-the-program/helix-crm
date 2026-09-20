/**
 * The Deals report (/reports/deals).
 *
 * Everything about the work itself: what came in, what closed, how often a
 * deal is won, what a win is worth and how long one takes - and under that the
 * five cards that used to be the whole of /reports, because all five are about
 * deals and splitting them across the new tabs would only hide them.
 *
 * Two clocks run on this page and they are deliberately different. The
 * headline figures and the five cards answer "in the period you picked". The
 * "New deals" trend answers "over the last twelve weeks, or the last twelve
 * months", because a trend over "this month" is one bar, which is a number
 * rather than a line (the dataviz rule the Won and lost card already follows).
 *
 * `useDealsReport` loads the lot in one round trip, so every figure on the
 * page was read at the same instant and they always agree with each other.
 *
 * Colour comes from `components/charts.tsx`, which owns every fill and every
 * axis style on this screen. Two rules decide what a bar looks like:
 *
 *   - if the category is a pipeline stage, the bar takes that stage's own
 *     colour, because the owner already reads those colours as stages
 *     everywhere else in the product;
 *   - otherwise the leading series is the brand primary and a second series
 *     beside it is the brand secondary.
 *
 * The bars are this screen's one block of primary, which is why the header
 * carries a period picker and no primary button: a report is something the
 * owner reads, not something he does.
 *
 * No chart here has a gridline or a value axis. Every bar carries its own
 * figure at the end of it, which is exact where a gridline is a guess.
 */
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  LabelList,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CardGroupLabel, EmptyState, Spinner, Tabs, TabsList, TabsTrigger } from "@/ui";
import { centsToDecimalString, formatMoney } from "@/lib/money";
import {
  defaultGranularity,
  formatBucket,
  periodFor,
} from "@/lib/periods";
import type { Granularity, Period } from "@/lib/periods";
import { toCsv, useDealsReport } from "@/features/leads/lib/reportKeys";
import type {
  ConversionRow,
  DealBucketRow,
  DealsSummary,
  DwellRow,
  PipelineStageRow,
  SourceRow,
  TrendGrain,
  WonLostRow,
} from "@/db/repos/reports";
import { ReportsFrame } from "@/features/leads/components/ReportsFrame";
import { ReportCard } from "@/features/leads/components/ReportCard";
import { DataTable } from "@/features/leads/components/DataTable";
import type { DataTableColumn } from "@/features/leads/components/DataTable";
import {
  CHART_ANIMATION_ACTIVE,
  CHART_AXIS_LINE,
  CHART_BAR_GAP,
  CHART_BAR_PRIMARY,
  CHART_BAR_SECONDARY,
  CHART_CURSOR_FILL,
  CHART_LABEL_STYLE,
  CHART_TICK_LINE,
  CHART_TICK_STYLE,
  ChartFigure,
  ChartTooltipContent,
  HORIZONTAL_BAR_RADIUS,
  MAX_BAR_SIZE,
  VERTICAL_BAR_RADIUS,
  formatAxisMoney,
} from "@/features/leads/components/charts";

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function formatDays(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/**
 * One row per bar, at --row-h, so a report breathes like a list view. The floor
 * is two rows' worth: a chart with a single category should be one bar and the
 * air around it, not a bar marooned in a 140px box.
 */
function barChartHeight(rows: number, floor = 76): number {
  return Math.max(floor, rows * 40 + 16);
}

/**
 * Days, to one decimal, or an em dash when there is nothing to average.
 */
function formatDaysValue(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}`;
}

function formatMoneyOrDash(cents: number | null): string {
  return cents === null ? "—" : formatMoney(cents);
}

/** "Mon 3 Mar" for a week bucket, "Mar 2026" for a month one. */
function formatTrendBucket(bucket: string, grain: TrendGrain): string {
  if (grain === "month") return formatBucket(bucket);
  const date = new Date(`${bucket}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function DealsReportScreen() {
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const [granularity, setGranularity] = useState<Granularity>(() => defaultGranularity(period));
  const [grain, setGrain] = useState<TrendGrain>("week");

  // The picker sets the RANGE; the bucket size only has a sensible default
  // for that range, so a new range re-defaults it. The owner can still pick
  // a different bucket afterwards - that is GranularityControl below.
  useEffect(() => {
    setGranularity(defaultGranularity(period));
  }, [period]);

  const query = useDealsReport(period, grain, granularity);

  return (
    <ReportsFrame
      active="deals"
      title="Deals"
      subtitle="What came in, what closed, and how long a win takes."
      period={{ value: period, onChange: setPeriod }}
    >
      {query.isPending ? (
        <div className="flex justify-center py-[var(--space-10)]">
          <Spinner label="Loading the deals report" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="The deals report could not load"
          description={
            query.error instanceof Error
              ? query.error.message
              : "The database gave no reason. Try picking the period again."
          }
        />
      ) : query.data ? (
        <>
          <SummaryTiles summary={query.data.summary} />
          <TrendCard rows={query.data.trend} grain={grain} onGrainChange={setGrain} />
          <PipelineCard rows={query.data.openByStage} />
          <WonLostCard
            rows={query.data.wonLost}
            granularity={granularity}
            onGranularityChange={setGranularity}
          />
          <SourcesCard rows={query.data.sources} />
          <ConversionCard rows={query.data.conversion} />
          <DwellCard rows={query.data.dwell} />
        </>
      ) : null}
    </ReportsFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* The headline: what came in, how often it lands, and how long it takes       */
/* -------------------------------------------------------------------------- */

/**
 * Four figures, and every one of them can honestly be "nothing yet".
 *
 * A won rate needs something to have closed; an average win needs a win; a
 * median time to win needs the same. None of those is zero when it is missing,
 * so none of them prints a zero - an em dash says "no answer" and a "0.0%"
 * says "you lose everything", which is a different and untrue sentence.
 */
function SummaryTiles(props: { summary: DealsSummary }) {
  const { summary } = props;
  return (
    <div className="flex flex-wrap gap-[var(--space-10)]">
      <StatTile
        label="New deals"
        value={String(summary.newCount)}
        count={formatMoney(summary.newValueCents)}
      />
      <StatTile
        label="Won rate"
        value={formatPercent(summary.wonRate)}
        count={`${summary.wonCount} of ${summary.closedCount} closed`}
      />
      <StatTile
        label="Average won"
        value={formatMoneyOrDash(summary.averageWonCents)}
        count={`${summary.wonCount} won${
          summary.wonValueCents > 0 ? `, ${formatMoney(summary.wonValueCents)} in total` : ""
        }`}
      />
      <StatTile
        label="Days to win"
        value={formatDaysValue(summary.medianDaysToWin)}
        count="Median, creation to won"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* New deals over a trailing window                                            */
/* -------------------------------------------------------------------------- */

function GrainControl(props: { value: TrendGrain; onChange: (value: TrendGrain) => void }) {
  const { value, onChange } = props;
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (next === "week" || next === "month") onChange(next);
      }}
    >
      <TabsList className="border-b-0">
        <TabsTrigger value="week">12 weeks</TabsTrigger>
        <TabsTrigger value="month">12 months</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function TrendCard(props: {
  rows: DealBucketRow[];
  grain: TrendGrain;
  onGrainChange: (grain: TrendGrain) => void;
}) {
  const { rows, grain, onGrainChange } = props;
  const empty = rows.every((row) => row.count === 0);

  const data = rows.map((row) => ({
    bucket: formatTrendBucket(row.bucket, grain),
    count: row.count,
  }));

  const ariaLabel = `New deals per ${grain}: ${rows
    .map(
      (row) =>
        `${formatTrendBucket(row.bucket, grain)} ${row.count} deal${row.count === 1 ? "" : "s"}`,
    )
    .join(", ")}`;

  const columns: DataTableColumn<DealBucketRow>[] = [
    {
      key: "bucket",
      header: grain === "week" ? "Week of" : "Month",
      render: (row) => formatTrendBucket(row.bucket, grain),
    },
    { key: "count", header: "New deals", numeric: true, render: (row) => row.count },
    {
      key: "value",
      header: "Value",
      numeric: true,
      render: (row) => formatMoney(row.valueCents),
    },
  ];

  function csv() {
    return toCsv(
      [grain === "week" ? "Week of" : "Month", "New deals", "Value"],
      rows.map((row) => [row.bucket, row.count, centsToDecimalString(row.valueCents)]),
    );
  }

  return (
    <ReportCard
      title="New deals"
      description={
        grain === "week"
          ? "Deals created in each of the last twelve weeks."
          : "Deals created in each of the last twelve months."
      }
      empty={empty}
      emptyTitle="No deals yet"
      emptyDescription="Deals show up here the week they come in."
      headerExtra={<GrainControl value={grain} onChange={onGrainChange} />}
      csv={csv}
      chart={
        <ChartFigure ariaLabel={ariaLabel} height={220}>
          <BarChart data={data} margin={{ top: 24, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="bucket"
              tick={CHART_TICK_STYLE}
              axisLine={CHART_AXIS_LINE}
              tickLine={CHART_TICK_LINE}
              interval="preserveStartEnd"
            />
            <YAxis type="number" allowDecimals={false} hide />
            <Tooltip
              cursor={CHART_CURSOR_FILL}
              content={(tooltipProps) => (
                <ChartTooltipContent
                  {...tooltipProps}
                  formatValue={(value) => `${value} deal${value === 1 ? "" : "s"}`}
                />
              )}
            />
            <Bar
              dataKey="count"
              name="New deals"
              fill={CHART_BAR_PRIMARY}
              maxBarSize={MAX_BAR_SIZE}
              radius={VERTICAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              <LabelList dataKey="count" position="top" style={CHART_LABEL_STYLE} />
            </Bar>
          </BarChart>
        </ChartFigure>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.bucket} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Pipeline value by stage                                                  */
/* -------------------------------------------------------------------------- */

function PipelineCard(props: { rows: PipelineStageRow[] }) {
  const { rows } = props;
  const empty = rows.length === 0 || rows.every((row) => row.openDeals === 0);

  const data = rows.map((row) => ({
    name: row.stageName,
    value: row.openValueCents,
    color: row.stageColor,
  }));

  const ariaLabel = `Pipeline value by stage: ${rows
    .map((row) => `${row.stageName} ${formatMoney(row.openValueCents)}`)
    .join(", ")}`;

  const columns: DataTableColumn<PipelineStageRow>[] = [
    { key: "stage", header: "Stage", render: (row) => row.stageName },
    { key: "open", header: "Open deals", numeric: true, render: (row) => row.openDeals },
    {
      key: "value",
      header: "Value",
      numeric: true,
      render: (row) => formatMoney(row.openValueCents),
    },
  ];

  function csv() {
    return toCsv(
      ["Stage", "Open deals", "Value"],
      rows.map((row) => [row.stageName, row.openDeals, centsToDecimalString(row.openValueCents)]),
    );
  }

  return (
    <ReportCard
      title="Pipeline value by stage"
      description="Open deals right now, by stage."
      empty={empty}
      emptyTitle="Nothing in the pipeline yet"
      emptyDescription="Open deals show up here with what they are worth."
      csv={csv}
      chart={
        // The category is the stage, so each bar carries its own stage colour.
        <ChartFigure ariaLabel={ariaLabel} height={barChartHeight(rows.length)}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 104, bottom: 0, left: 0 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={124}
              tick={CHART_TICK_STYLE}
              axisLine={CHART_AXIS_LINE}
              tickLine={CHART_TICK_LINE}
            />
            <Tooltip
              cursor={CHART_CURSOR_FILL}
              content={(tooltipProps) => (
                <ChartTooltipContent {...tooltipProps} formatValue={(value) => formatMoney(value)} />
              )}
            />
            <Bar
              dataKey="value"
              name="Open value"
              maxBarSize={MAX_BAR_SIZE}
              radius={HORIZONTAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                formatter={(value) => formatMoney(Number(value))}
                style={CHART_LABEL_STYLE}
              />
            </Bar>
          </BarChart>
        </ChartFigure>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.stageId} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Won and lost                                                             */
/* -------------------------------------------------------------------------- */

function GranularityControl(props: { value: Granularity; onChange: (value: Granularity) => void }) {
  const { value, onChange } = props;
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (next === "month" || next === "quarter" || next === "year") onChange(next);
      }}
    >
      <TabsList className="border-b-0">
        <TabsTrigger value="month">Month</TabsTrigger>
        <TabsTrigger value="quarter">Quarter</TabsTrigger>
        <TabsTrigger value="year">Year</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/**
 * The headline figure of a report: the heading face at the heading size, with
 * a caption above it and a caption under it. The figure is the only thing on
 * the card set in the heading font, which is what makes it read as the number
 * the card is about rather than as one more row of data.
 */
function StatTile(props: { label: string; value: string; count: string }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span className="text-[length:var(--text-caption)] text-[var(--color-text-muted)]">
        {props.label}
      </span>
      <span className="tabular font-[family-name:var(--font-heading)] text-[length:var(--text-heading)] leading-[var(--leading-heading)] text-[var(--color-heading)]">
        {props.value}
      </span>
      <span className="tabular text-[length:var(--text-caption)] text-[var(--color-text-muted)]">
        {props.count}
      </span>
    </div>
  );
}

function WonLostCard(props: {
  rows: WonLostRow[];
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
}) {
  const { rows, granularity, onGranularityChange } = props;
  const empty = rows.length === 0;

  const wonTotalCents = rows.reduce((sum, row) => sum + row.wonValueCents, 0);
  const lostTotalCents = rows.reduce((sum, row) => sum + row.lostValueCents, 0);
  const wonCountTotal = rows.reduce((sum, row) => sum + row.wonCount, 0);
  const lostCountTotal = rows.reduce((sum, row) => sum + row.lostCount, 0);

  const data = rows.map((row) => ({
    bucket: formatBucket(row.bucket),
    won: row.wonValueCents,
    lost: row.lostValueCents,
  }));

  const ariaLabel = `Won and lost by ${granularity}: ${rows
    .map(
      (row) =>
        `${formatBucket(row.bucket)} won ${formatMoney(row.wonValueCents)} across ${row.wonCount} deal${
          row.wonCount === 1 ? "" : "s"
        }, lost ${formatMoney(row.lostValueCents)} across ${row.lostCount} deal${
          row.lostCount === 1 ? "" : "s"
        }`,
    )
    .join("; ")}`;

  const columns: DataTableColumn<WonLostRow>[] = [
    { key: "bucket", header: "Period", render: (row) => formatBucket(row.bucket) },
    { key: "wonCount", header: "Won", numeric: true, render: (row) => row.wonCount },
    {
      key: "wonValue",
      header: "Won value",
      numeric: true,
      render: (row) => formatMoney(row.wonValueCents),
    },
    { key: "lostCount", header: "Lost", numeric: true, render: (row) => row.lostCount },
    {
      key: "lostValue",
      header: "Lost value",
      numeric: true,
      render: (row) => formatMoney(row.lostValueCents),
    },
  ];

  function csv() {
    return toCsv(
      ["Period", "Won", "Won value", "Lost", "Lost value"],
      rows.map((row) => [
        formatBucket(row.bucket),
        row.wonCount,
        centsToDecimalString(row.wonValueCents),
        row.lostCount,
        centsToDecimalString(row.lostValueCents),
      ]),
    );
  }

  return (
    <ReportCard
      title="Won and lost"
      description="Deals that closed in this period, by outcome."
      empty={empty}
      emptyTitle="No wins or losses yet"
      emptyDescription="Deals that close in this period show up here, won or lost."
      headerExtra={<GranularityControl value={granularity} onChange={onGranularityChange} />}
      csv={csv}
      chart={
        <div className="flex flex-col gap-[var(--space-6)]">
          <div className="flex flex-wrap gap-[var(--space-10)]">
            <StatTile
              label="Won"
              value={formatMoney(wonTotalCents)}
              count={`${wonCountTotal} deal${wonCountTotal === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Lost"
              value={formatMoney(lostTotalCents)}
              count={`${lostCountTotal} deal${lostCountTotal === 1 ? "" : "s"}`}
            />
          </div>
          {/* One bucket is a number, not a trend - the dataviz skill's "is it even
              a chart" rule. Two or more buckets earn the comparison a chart gives. */}
          {data.length > 1 ? (
            <ChartFigure ariaLabel={ariaLabel} height={260}>
              <BarChart
                data={data}
                barGap={CHART_BAR_GAP}
                margin={{ top: 24, right: 0, bottom: 0, left: 0 }}
              >
                <XAxis
                  dataKey="bucket"
                  tick={CHART_TICK_STYLE}
                  axisLine={CHART_AXIS_LINE}
                  tickLine={CHART_TICK_LINE}
                />
                <YAxis type="number" hide />
                <Tooltip
                  cursor={CHART_CURSOR_FILL}
                  content={(tooltipProps) => (
                    <ChartTooltipContent
                      {...tooltipProps}
                      formatValue={(value) => formatMoney(value)}
                    />
                  )}
                />
                <Legend
                  iconType="rect"
                  iconSize={8}
                  wrapperStyle={{
                    color: "var(--color-text-muted)",
                    fontFamily: "var(--font-body)",
                    fontSize: "var(--text-caption)",
                  }}
                />
                {/* Two peers: the brand primary and the brand secondary. The
                    words are in the legend and on the bars, so the colour is
                    not carrying the meaning on its own. */}
                <Bar
                  dataKey="won"
                  name="Won"
                  fill={CHART_BAR_PRIMARY}
                  maxBarSize={MAX_BAR_SIZE}
                  radius={VERTICAL_BAR_RADIUS}
                  isAnimationActive={CHART_ANIMATION_ACTIVE}
                >
                  <LabelList
                    dataKey="won"
                    position="top"
                    formatter={(value) => formatAxisMoney(Number(value))}
                    style={CHART_LABEL_STYLE}
                  />
                </Bar>
                <Bar
                  dataKey="lost"
                  name="Lost"
                  fill={CHART_BAR_SECONDARY}
                  maxBarSize={MAX_BAR_SIZE}
                  radius={VERTICAL_BAR_RADIUS}
                  isAnimationActive={CHART_ANIMATION_ACTIVE}
                >
                  <LabelList
                    dataKey="lost"
                    position="top"
                    formatter={(value) => formatAxisMoney(Number(value))}
                    style={CHART_LABEL_STYLE}
                  />
                </Bar>
              </BarChart>
            </ChartFigure>
          ) : null}
        </div>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.bucket} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Leads by source                                                          */
/* -------------------------------------------------------------------------- */

function SourcesCard(props: { rows: SourceRow[] }) {
  const { rows } = props;
  const empty = rows.length === 0;

  const data = rows.map((row) => ({
    name: row.sourceName,
    deals: row.dealCount,
  }));

  const ariaLabel = `Leads by source: ${rows
    .map((row) => `${row.sourceName} ${row.dealCount} lead${row.dealCount === 1 ? "" : "s"}`)
    .join(", ")}`;

  const columns: DataTableColumn<SourceRow>[] = [
    { key: "source", header: "Source", render: (row) => row.sourceName },
    { key: "deals", header: "Deals", numeric: true, render: (row) => row.dealCount },
    {
      key: "value",
      header: "Value",
      numeric: true,
      render: (row) => formatMoney(row.valueCents),
    },
    { key: "won", header: "Won", numeric: true, render: (row) => row.wonCount },
    { key: "open", header: "Open", numeric: true, render: (row) => row.openCount },
  ];

  function csv() {
    return toCsv(
      ["Source", "Deals", "Value", "Won", "Open"],
      rows.map((row) => [
        row.sourceName,
        row.dealCount,
        centsToDecimalString(row.valueCents),
        row.wonCount,
        row.openCount,
      ]),
    );
  }

  return (
    <ReportCard
      title="Leads by source"
      description="Where the deals created in this period came from."
      empty={empty}
      emptyTitle="No leads yet"
      emptyDescription="Where deals come from shows up here once leads start arriving."
      csv={csv}
      chart={
        <ChartFigure ariaLabel={ariaLabel} height={barChartHeight(rows.length)}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
            <XAxis type="number" allowDecimals={false} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={136}
              tick={CHART_TICK_STYLE}
              axisLine={CHART_AXIS_LINE}
              tickLine={CHART_TICK_LINE}
            />
            <Tooltip
              cursor={CHART_CURSOR_FILL}
              content={(tooltipProps) => (
                <ChartTooltipContent
                  {...tooltipProps}
                  formatValue={(value) => `${value} lead${value === 1 ? "" : "s"}`}
                />
              )}
            />
            <Bar
              dataKey="deals"
              name="Leads"
              fill={CHART_BAR_PRIMARY}
              maxBarSize={MAX_BAR_SIZE}
              radius={HORIZONTAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              <LabelList dataKey="deals" position="right" style={CHART_LABEL_STYLE} />
            </Bar>
          </BarChart>
        </ChartFigure>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.sourceId} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Conversion between consecutive stages                                    */
/* -------------------------------------------------------------------------- */

function ConversionCard(props: { rows: ConversionRow[] }) {
  const { rows } = props;
  const empty = rows.length === 0;

  // A pair nobody entered has no rate to draw - it stays in the table as
  // "-" but does not get a 0% bar, which would misstate "no data" as "no one
  // advanced."
  const chartRows = rows.filter((row) => row.rate !== null);
  const data = chartRows.map((row) => ({
    name: `${row.fromStageName} → ${row.toStageName}`,
    rate: (row.rate ?? 0) * 100,
  }));

  const ariaLabel = `Conversion between stages: ${rows
    .map((row) => `${row.fromStageName} to ${row.toStageName} ${formatPercent(row.rate)}`)
    .join(", ")}`;

  const columns: DataTableColumn<ConversionRow>[] = [
    { key: "from", header: "From", render: (row) => row.fromStageName },
    { key: "to", header: "To", render: (row) => row.toStageName },
    { key: "entered", header: "Entered", numeric: true, render: (row) => row.entered },
    { key: "advanced", header: "Advanced", numeric: true, render: (row) => row.advanced },
    { key: "rate", header: "Rate", numeric: true, render: (row) => formatPercent(row.rate) },
  ];

  function csv() {
    return toCsv(
      ["From", "To", "Entered", "Advanced", "Rate"],
      rows.map((row) => [
        row.fromStageName,
        row.toStageName,
        row.entered,
        row.advanced,
        formatPercent(row.rate),
      ]),
    );
  }

  return (
    <ReportCard
      title="Conversion between stages"
      description="Of the deals that entered a stage in this period, how many moved to the next one."
      empty={empty}
      emptyTitle="No stage moves yet"
      emptyDescription="Conversion between stages shows up here once deals start moving."
      csv={csv}
      chart={
        <ChartFigure ariaLabel={ariaLabel} height={barChartHeight(chartRows.length)}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={188}
              tick={CHART_TICK_STYLE}
              axisLine={CHART_AXIS_LINE}
              tickLine={CHART_TICK_LINE}
            />
            <Tooltip
              cursor={CHART_CURSOR_FILL}
              content={(tooltipProps) => (
                <ChartTooltipContent
                  {...tooltipProps}
                  formatValue={(value) => `${value.toFixed(1)}%`}
                />
              )}
            />
            <Bar
              dataKey="rate"
              name="Conversion rate"
              fill={CHART_BAR_PRIMARY}
              maxBarSize={MAX_BAR_SIZE}
              radius={HORIZONTAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              <LabelList
                dataKey="rate"
                position="right"
                formatter={(value) => `${Number(value).toFixed(1)}%`}
                style={CHART_LABEL_STYLE}
              />
            </Bar>
          </BarChart>
        </ChartFigure>
      }
      table={
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => `${row.fromStageId}-${row.toStageId}`}
        />
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Average days in stage                                                    */
/* -------------------------------------------------------------------------- */

function DwellMiniChart(props: {
  title: string;
  rows: DwellRow[];
  valueKey: "averageDays" | "currentAverageDays";
}) {
  const { title, rows, valueKey } = props;
  const filtered = rows.filter((row) => row[valueKey] !== null);

  if (filtered.length === 0) {
    return (
      <div>
        <CardGroupLabel>{title}</CardGroupLabel>
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Nothing here yet.
        </p>
      </div>
    );
  }

  const data = filtered.map((row) => ({
    name: row.stageName,
    days: row[valueKey] ?? 0,
    color: row.stageColor,
  }));

  const ariaLabel = `${title}: ${filtered
    .map((row) => `${row.stageName} ${formatDays(row[valueKey])} days`)
    .join(", ")}`;

  return (
    <div>
      <CardGroupLabel>{title}</CardGroupLabel>
      <ChartFigure ariaLabel={ariaLabel} height={barChartHeight(filtered.length)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={104}
            tick={CHART_TICK_STYLE}
            axisLine={CHART_AXIS_LINE}
            tickLine={CHART_TICK_LINE}
          />
          <Tooltip
            cursor={CHART_CURSOR_FILL}
            content={(tooltipProps) => (
              <ChartTooltipContent
                {...tooltipProps}
                formatValue={(value) => `${value.toFixed(1)} days`}
              />
            )}
          />
          <Bar
            dataKey="days"
            name="Days"
            maxBarSize={MAX_BAR_SIZE}
            radius={HORIZONTAL_BAR_RADIUS}
            isAnimationActive={CHART_ANIMATION_ACTIVE}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
            <LabelList
              dataKey="days"
              position="right"
              formatter={(value) => `${Number(value).toFixed(1)}`}
              style={CHART_LABEL_STYLE}
            />
          </Bar>
        </BarChart>
      </ChartFigure>
    </div>
  );
}

function DwellCard(props: { rows: DwellRow[] }) {
  const { rows } = props;
  const hasAnyData = rows.some((row) => row.averageDays !== null || row.currentAverageDays !== null);
  const empty = rows.length === 0 || !hasAnyData;

  const columns: DataTableColumn<DwellRow>[] = [
    { key: "stage", header: "Stage", render: (row) => row.stageName },
    {
      key: "completed",
      header: "Finished visits",
      numeric: true,
      render: (row) => row.completedCount,
    },
    {
      key: "average",
      header: "Average days",
      numeric: true,
      render: (row) => formatDays(row.averageDays),
    },
    { key: "open", header: "Open now", numeric: true, render: (row) => row.openCount },
    {
      key: "waiting",
      header: "Days waiting",
      numeric: true,
      render: (row) => formatDays(row.currentAverageDays),
    },
  ];

  function csv() {
    return toCsv(
      ["Stage", "Finished visits", "Average days", "Open now", "Days waiting"],
      rows.map((row) => [
        row.stageName,
        row.completedCount,
        formatDays(row.averageDays),
        row.openCount,
        formatDays(row.currentAverageDays),
      ]),
    );
  }

  return (
    <ReportCard
      title="Average days in stage"
      description="How long a stage visit takes, and how long today's open deals have been waiting."
      empty={empty}
      emptyTitle="No stage history yet"
      emptyDescription="How long deals sit in each stage shows up here once some have finished, or some are waiting."
      csv={csv}
      chart={
        <div className="grid grid-cols-1 gap-[var(--space-6)] lg:grid-cols-2">
          <DwellMiniChart title="Time in stage (finished)" rows={rows} valueKey="averageDays" />
          <DwellMiniChart
            title="Open deals waiting now"
            rows={rows}
            valueKey="currentAverageDays"
          />
        </div>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.stageId} />}
    />
  );
}

export default DealsReportScreen;
