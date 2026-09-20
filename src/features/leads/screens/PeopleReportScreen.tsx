/**
 * Contacts and companies (/reports/people).
 *
 * How the customer base is growing: new contacts and companies per month, the
 * totals, where they came from, how many have ever had a deal, and the
 * companies that have won the most. One `usePeopleReport` call loads the
 * whole page for the chosen period; the period picker in `ReportsFrame`'s
 * header scopes every card and the totals row together.
 *
 * Colour and chart mechanics come from `components/charts.tsx`, the same as
 * every other report on this screen: no gridline, no value axis, a number at
 * the end of every bar, and the brand primary/secondary carry the two series
 * that need telling apart. This page spends no primary button - a report is
 * something the owner reads, not something he does.
 */
import { useState } from "react";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  LabelList,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, Spinner } from "@/ui";
import { centsToDecimalString } from "@/lib/money";
import { useFormats } from "@/app/formats";
import { formatBucket, periodFor } from "@/lib/periods";
import type { Period } from "@/lib/periods";
import { toCsv, usePeopleReport } from "@/features/leads/lib/reportKeys";
import type {
  PeopleBucketRow,
  PeopleSourceRow,
  PeopleTotals,
  TopCompanyRow,
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
} from "@/features/leads/components/charts";

/** Copied from ReportsScreen.tsx: a rate in 0..1, or "—" when there is none to show. */
function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

/**
 * Copied from ReportsScreen.tsx: one row per bar, at --row-h, so a report
 * breathes like a list view rather than a bar marooned in a fixed box.
 */
function barChartHeight(rows: number, floor = 76): number {
  return Math.max(floor, rows * 40 + 16);
}

/**
 * Copied from ReportsScreen.tsx: the headline figure of a card, in the
 * heading face, with a caption above and below it.
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

export function PeopleReportScreen() {
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const query = usePeopleReport(period);

  return (
    <ReportsFrame
      active="people"
      title="Contacts and companies"
      subtitle="Who you know, where they came from, and how many turn into work."
      period={{ value: period, onChange: setPeriod }}
    >
      {query.isPending ? (
        <div className="flex justify-center py-[var(--space-10)]">
          <Spinner label="Loading contacts and companies" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="This report could not load"
          description={
            query.error instanceof Error
              ? query.error.message
              : "The database gave no reason. Try picking the period again."
          }
        />
      ) : query.data ? (
        <>
          <TotalsRow totals={query.data.totals} />
          <NewPeopleCard rows={query.data.byMonth} />
          <SourcesCard rows={query.data.bySource} />
          <TopCompaniesCard rows={query.data.topCompanies} />
        </>
      ) : null}
    </ReportsFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

function TotalsRow(props: { totals: PeopleTotals }) {
  const { totals } = props;
  const contactRate = totals.contacts > 0 ? totals.contactsWithDeal / totals.contacts : null;
  const companyRate = totals.companies > 0 ? totals.companiesWithDeal / totals.companies : null;

  return (
    <div className="flex flex-wrap gap-[var(--space-10)]">
      <StatTile
        label="Contacts"
        value={String(totals.contacts)}
        count={`${formatPercent(contactRate)} have had a deal`}
      />
      <StatTile
        label="Companies"
        value={String(totals.companies)}
        count={`${formatPercent(companyRate)} have had a deal`}
      />
      <StatTile
        label="New this period"
        value={`${totals.newContacts} contact${totals.newContacts === 1 ? "" : "s"}`}
        count={`${totals.newCompanies} compan${totals.newCompanies === 1 ? "y" : "ies"}`}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* New contacts and companies                                                 */
/* -------------------------------------------------------------------------- */

function NewPeopleCard(props: { rows: PeopleBucketRow[] }) {
  const { rows } = props;
  const empty = rows.length === 0 || rows.every((row) => row.contacts === 0 && row.companies === 0);

  const data = rows.map((row) => ({
    bucket: formatBucket(row.bucket),
    contacts: row.contacts,
    companies: row.companies,
  }));

  const ariaLabel = `New contacts and companies by month: ${rows
    .map((row) => `${formatBucket(row.bucket)} ${row.contacts} contacts, ${row.companies} companies`)
    .join("; ")}`;

  const columns: DataTableColumn<PeopleBucketRow>[] = [
    { key: "bucket", header: "Month", render: (row) => formatBucket(row.bucket) },
    { key: "contacts", header: "New contacts", numeric: true, render: (row) => row.contacts },
    { key: "companies", header: "New companies", numeric: true, render: (row) => row.companies },
  ];

  function csv() {
    return toCsv(
      ["Month", "New contacts", "New companies"],
      rows.map((row) => [formatBucket(row.bucket), row.contacts, row.companies]),
    );
  }

  return (
    <ReportCard
      title="New contacts and companies"
      description="Who you added, month by month."
      empty={empty}
      emptyTitle="No new contacts or companies yet"
      emptyDescription="New contacts and companies show up here as you add them."
      csv={csv}
      chart={
        <ChartFigure ariaLabel={ariaLabel} height={260}>
          <BarChart data={data} barGap={CHART_BAR_GAP} margin={{ top: 24, right: 0, bottom: 0, left: 0 }}>
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
                  formatValue={(value) => `${value}`}
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
            <Bar
              dataKey="contacts"
              name="Contacts"
              fill={CHART_BAR_PRIMARY}
              maxBarSize={MAX_BAR_SIZE}
              radius={VERTICAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              <LabelList dataKey="contacts" position="top" style={CHART_LABEL_STYLE} />
            </Bar>
            <Bar
              dataKey="companies"
              name="Companies"
              fill={CHART_BAR_SECONDARY}
              maxBarSize={MAX_BAR_SIZE}
              radius={VERTICAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              <LabelList dataKey="companies" position="top" style={CHART_LABEL_STYLE} />
            </Bar>
          </BarChart>
        </ChartFigure>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.bucket} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Where they came from                                                        */
/* -------------------------------------------------------------------------- */

function SourcesCard(props: { rows: PeopleSourceRow[] }) {
  const { rows } = props;
  const empty = rows.length === 0;

  const data = rows.map((row) => ({
    name: row.sourceName,
    total: row.contacts + row.companies,
  }));

  const ariaLabel = `Where they came from: ${rows
    .map((row) => `${row.sourceName} ${row.contacts} contacts, ${row.companies} companies`)
    .join(", ")}`;

  const columns: DataTableColumn<PeopleSourceRow>[] = [
    { key: "source", header: "Source", render: (row) => row.sourceName },
    { key: "contacts", header: "Contacts", numeric: true, render: (row) => row.contacts },
    { key: "companies", header: "Companies", numeric: true, render: (row) => row.companies },
  ];

  function csv() {
    return toCsv(
      ["Source", "Contacts", "Companies"],
      rows.map((row) => [row.sourceName, row.contacts, row.companies]),
    );
  }

  return (
    <ReportCard
      title="Where they came from"
      description="The sources behind the contacts and companies added in this period."
      empty={empty}
      emptyTitle="No sources yet"
      emptyDescription="Where your contacts and companies come from shows up here once some are added."
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
                  formatValue={(value) => `${value} added`}
                />
              )}
            />
            <Bar
              dataKey="total"
              name="Contacts and companies"
              fill={CHART_BAR_PRIMARY}
              maxBarSize={MAX_BAR_SIZE}
              radius={HORIZONTAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              <LabelList dataKey="total" position="right" style={CHART_LABEL_STYLE} />
            </Bar>
          </BarChart>
        </ChartFigure>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.sourceId} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Top companies                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Styled the way RevenueScreen.tsx's `DealCell` links a deal, so links stay
 * consistent across the reports: the link colour token, an underline only on
 * hover, and the focus ring token rather than a browser default outline.
 */
function CompanyCell(props: { row: TopCompanyRow }) {
  const { row } = props;
  return (
    <Link
      href={`/companies/${row.companyId}`}
      title={row.name}
      className="block truncate text-[var(--color-link)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
    >
      {row.name}
    </Link>
  );
}

function TopCompaniesCard(props: { rows: TopCompanyRow[] }) {
  const { rows } = props;
  const formats = useFormats();
  const empty = rows.length === 0;

  const data = rows.map((row) => ({
    name: row.name,
    value: row.wonValueCents,
  }));

  const ariaLabel = `Top companies by won value: ${rows
    .map((row) => `${row.name} ${formats.money(row.wonValueCents)}`)
    .join(", ")}`;

  const columns: DataTableColumn<TopCompanyRow>[] = [
    { key: "company", header: "Company", render: (row) => <CompanyCell row={row} /> },
    { key: "wonCount", header: "Won", numeric: true, render: (row) => row.wonCount },
    {
      key: "wonValue",
      header: "Won value",
      numeric: true,
      render: (row) => formats.money(row.wonValueCents),
    },
    { key: "openCount", header: "Open", numeric: true, render: (row) => row.openCount },
    {
      key: "openValue",
      header: "Open value",
      numeric: true,
      render: (row) => formats.money(row.openValueCents),
    },
  ];

  function csv() {
    return toCsv(
      ["Company", "Won", "Won value", "Open", "Open value"],
      rows.map((row) => [
        row.name,
        row.wonCount,
        centsToDecimalString(row.wonValueCents),
        row.openCount,
        centsToDecimalString(row.openValueCents),
      ]),
    );
  }

  return (
    <ReportCard
      title="Top companies"
      description="The companies that have won you the most in this period."
      empty={empty}
      emptyTitle="No company wins yet"
      emptyDescription="The companies that win you the most work show up here once a deal closes."
      csv={csv}
      chart={
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
                <ChartTooltipContent {...tooltipProps} formatValue={(value) => formats.money(value)} />
              )}
            />
            <Bar
              dataKey="value"
              name="Won value"
              fill={CHART_BAR_PRIMARY}
              maxBarSize={MAX_BAR_SIZE}
              radius={HORIZONTAL_BAR_RADIUS}
              isAnimationActive={CHART_ANIMATION_ACTIVE}
            >
              <LabelList
                dataKey="value"
                position="right"
                formatter={(value) => formats.money(Number(value))}
                style={CHART_LABEL_STYLE}
              />
            </Bar>
          </BarChart>
        </ChartFigure>
      }
      table={<DataTable columns={columns} rows={rows} getRowKey={(row) => row.companyId} />}
    />
  );
}

export default PeopleReportScreen;
