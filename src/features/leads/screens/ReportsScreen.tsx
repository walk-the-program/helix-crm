/**
 * Reports (/reports).
 *
 * Five report cards over one period: pipeline value by stage, won and lost,
 * leads by source, conversion between stages, and average days in stage. One
 * `useReports` call loads all five at once (`loadReports` already runs the
 * five queries in parallel), and the period picker in the page header scopes
 * every card at the same time so the numbers always agree with each other.
 *
 * Chart choices (form, colour, mark specs) come from the dataviz skill and
 * from `components/charts.tsx`, which owns every colour and every axis style
 * on this screen. Two rules decide what a bar looks like here:
 *
 *   - if the category is a pipeline stage, the bar takes that stage's own
 *     muted colour, because the owner already reads those colours as stages
 *     everywhere else in the product;
 *   - otherwise the bar is ink, and a second series beside it is tertiary ink.
 *
 * No chart on this screen has a gridline or a value axis. Every bar carries
 * its own figure at the end of it, which is exact where a gridline is a guess.
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
import {
  CardGroupLabel,
  EmptyState,
  PageHeader,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/ui";
import { centsToDecimalString, formatMoney } from "@/lib/money";
import {
  defaultGranularity,
  formatBucket,
  periodFor,
} from "@/lib/periods";
import type { Granularity, Period } from "@/lib/periods";
import { toCsv, useReports } from "@/features/leads/lib/reportKeys";
import type {
  ConversionRow,
  DwellRow,
  PipelineStageRow,
  SourceRow,
  WonLostRow,
} from "@/db/repos/reports";
import { PeriodPicker } from "@/features/leads/components/PeriodPicker";
import { ReportCard } from "@/features/leads/components/ReportCard";
import { DataTable } from "@/features/leads/components/DataTable";
import type { DataTableColumn } from "@/features/leads/components/DataTable";
import {
  CHART_ANIMATION_ACTIVE,
  CHART_AXIS_LINE,
  CHART_BAR_GAP,
  CHART_BAR_INK,
  CHART_BAR_INK_SECONDARY,
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

export function ReportsScreen() {
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const [granularity, setGranularity] = useState<Granularity>(() => defaultGranularity(period));

  // The picker sets the RANGE; the bucket size only has a sensible default
  // for that range, so a new range re-defaults it. The owner can still pick
  // a different bucket afterwards - that is GranularityControl below.
  useEffect(() => {
    setGranularity(defaultGranularity(period));
  }, [period]);

  const query = useReports(period, granularity);

  return (
    <div className="flex flex-col">
      <PageHeader title="Reports" actions={<PeriodPicker value={period} onChange={setPeriod} />} />
      <div className="flex flex-col gap-[var(--space-6)]">
        {query.isPending ? (
          <div className="flex justify-center py-[var(--space-10)]">
            <Spinner label="Loading reports" />
          </div>
        ) : query.isError ? (
          <EmptyState
            title="Reports could not load"
            description={
              query.error instanceof Error
                ? query.error.message
                : "Something went wrong loading your reports."
            }
          />
        ) : query.data ? (
          <>
            <PipelineCard rows={query.data.pipeline} />
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
      </div>
    </div>
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

/** The headline figure of a report: --text-3xl, tabular, with its two labels. */
function StatTile(props: { label: string; value: string; count: string }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {props.label}
      </span>
      <span className="tabular text-[length:var(--text-3xl)] font-semibold leading-[var(--leading-tight)] tracking-[var(--tracking-title)] text-[var(--color-text)]">
        {props.value}
      </span>
      <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
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
                    fontSize: "var(--text-xs)",
                  }}
                />
                {/* Two peers, two steps of one grey ramp. The words are in the
                    legend and on the bars; the colour is not carrying meaning
                    on its own. */}
                <Bar
                  dataKey="won"
                  name="Won"
                  fill={CHART_BAR_INK}
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
                  fill={CHART_BAR_INK_SECONDARY}
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
              fill={CHART_BAR_INK}
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
              fill={CHART_BAR_INK}
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
          Nothing to show for this slice yet.
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
      emptyDescription="How long deals sit in each stage shows up here once some finish or some start waiting."
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

export default ReportsScreen;
