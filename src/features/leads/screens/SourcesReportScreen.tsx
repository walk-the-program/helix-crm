/**
 * Sources (/reports/sources), LR-PX-C PART 1.
 *
 * "See which lead source actually pays": one table, sorted by what a source
 * has actually won, so the busiest source and the best source are never
 * mistaken for each other. `sourcePerformance` in
 * src/db/repos/sourceReport.ts does the work; this screen is the period
 * picker, the table and the CSV export every other report page already has.
 *
 * No chart. A report screen earns recharts only when a trend or a
 * distribution is the point (Deals, People, Revenue); this one is a single
 * ranked list of a handful of sources; a bar chart of six or so bars would
 * say nothing the sorted table does not already say at a glance, and
 * DealsReportScreen's own "Leads by source" card already carries the leads
 * count as a bar. So this screen stays a STATIC import in
 * src/features/leads/index.tsx rather than a `lazyScreen` - it costs the boot
 * chunk nothing (no recharts, no jszip, no papaparse behind it) and, like
 * Overview, there is no bundle-size reason to make the owner wait on a
 * Suspense fallback to read it.
 *
 * The CSV button reuses the exact mechanism DealsReportScreen and
 * PeopleReportScreen use for "Copy as CSV": `toCsv` from
 * ../lib/reportKeys builds the text, `navigator.clipboard.writeText` puts it
 * on the clipboard, and a past-tense toast confirms it. There is no second
 * download path.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  toast,
} from "@/ui";
import { useFormats } from "@/app/formats";
import { centsToDecimalString } from "@/lib/money";
import { periodFor } from "@/lib/periods";
import type { Period } from "@/lib/periods";
import { sourcePerformance } from "@/db/repos/sourceReport";
import type { SourcePerformanceRow } from "@/db/repos/sourceReport";
import { toCsv } from "@/features/leads/lib/reportKeys";
import { ReportsFrame } from "@/features/leads/components/ReportsFrame";

/** Same convention as DealsReportScreen and OverviewScreen: no answer, not a rate. */
function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Same convention as DealsReportScreen's formatDays: no win, not a zero. */
function formatDays(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/**
 * The query key starts with "reports" so the lead poller's single
 * `invalidateQueries(["reports"])` (src/features/leads/poller.ts) refreshes
 * this page too, whatever period it was last asked for - the same convention
 * `reportPageKeys` in lib/reportKeys.ts follows for the other four pages.
 */
function sourcesReportKey(period: Period) {
  return ["reports", "sources", period.from, period.to] as const;
}

export function SourcesReportScreen() {
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const query = useQuery({
    queryKey: sourcesReportKey(period),
    queryFn: () => sourcePerformance(period),
  });
  const formats = useFormats();

  function csv(rows: SourcePerformanceRow[]): string {
    return toCsv(
      ["Source", "Leads", "Won", "Won value", "Win rate", "Median days to win"],
      rows.map((row) => [
        row.sourceName,
        row.leads,
        row.won,
        centsToDecimalString(row.wonValueCents),
        row.winRate,
        row.medianDaysToWin ?? "",
      ]),
    );
  }

  async function handleCopyCsv(rows: SourcePerformanceRow[]) {
    try {
      await navigator.clipboard.writeText(csv(rows));
      toast.success("Copied the report to the clipboard");
    } catch {
      toast.error("The clipboard refused it.");
    }
  }

  return (
    <ReportsFrame
      active="sources"
      title="Sources"
      subtitle="Which lead source turns into paying work."
      period={{ value: period, onChange: setPeriod }}
    >
      {query.isPending ? (
        <div className="flex justify-center py-[var(--space-10)]">
          <Spinner label="Loading the sources report" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="The sources report could not load"
          description={
            query.error instanceof Error
              ? query.error.message
              : "The database gave no reason. Try picking the period again."
          }
        />
      ) : query.data && query.data.length > 0 ? (
        <Card data-report="Sources">
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void handleCopyCsv(query.data)}>
              Copy as CSV
            </Button>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH align="right">Leads</TH>
                  <TH align="right">Won</TH>
                  <TH align="right">Won value</TH>
                  <TH align="right">Win rate</TH>
                  <TH align="right">Median days to win</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.map((row) => (
                  <TR key={row.sourceId || "unknown"}>
                    <TD primary title={row.sourceName}>
                      {row.sourceName}
                    </TD>
                    <TD align="right">{row.leads}</TD>
                    <TD align="right">{row.won}</TD>
                    <TD
                      align="right"
                      dashZero={row.wonValueCents === 0}
                    >
                      {formats.moneyOrDash(row.wonValueCents)}
                    </TD>
                    <TD align="right">{formatPercent(row.winRate)}</TD>
                    <TD align="right">{formatDays(row.medianDaysToWin)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No leads with a source yet"
          description="Once leads come in from your website or somewhere else, see which source turns into paying work."
          action={
            <Button variant="primary" onClick={() => navigate("/settings/site")}>
              Connect your website
            </Button>
          }
        />
      )}
    </ReportsFrame>
  );
}

export default SourcesReportScreen;
