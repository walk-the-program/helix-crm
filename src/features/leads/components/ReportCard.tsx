/**
 * The one card shape every report on this screen uses: a title, an optional
 * right-aligned Chart/Table toggle, a "Copy as CSV" action, and a worded
 * empty state that replaces both views when there is nothing to show.
 *
 * The chart/table toggle is built from the same `Tabs` primitive as the
 * screen's own view controls, but its state lives per card - each report
 * remembers its own choice independently, which is why `Tabs.Root` wraps
 * this whole component rather than living at the screen level.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@/ui";

type ReportView = "chart" | "table";

export type ReportCardProps = {
  title: string;
  description?: string;
  chart: ReactNode;
  table: ReactNode;
  /** Returns the CSV text for the "Copy as CSV" button. Called on click, not eagerly. */
  csv: () => string;
  empty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  /** Extra header control, e.g. the Won and lost card's bucket-size Tabs. */
  headerExtra?: ReactNode;
};

export function ReportCard(props: ReportCardProps) {
  const { title, description, chart, table, csv, empty, emptyTitle, emptyDescription, headerExtra } =
    props;
  const [view, setView] = useState<ReportView>("chart");

  async function handleCopyCsv() {
    try {
      await navigator.clipboard.writeText(csv());
      toast.success("Copied to the clipboard");
    } catch {
      toast.error("Could not copy the report to the clipboard");
    }
  }

  return (
    <Card>
      <Tabs value={view} onValueChange={(next) => setView(next === "table" ? "table" : "chart")}>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
            <CardTitle>{title}</CardTitle>
            {description ? (
              <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          {empty ? (
            headerExtra ?? null
          ) : (
            <div className="flex shrink-0 items-center gap-[var(--space-3)]">
              {headerExtra}
              <TabsList>
                <TabsTrigger value="chart">Chart</TabsTrigger>
                <TabsTrigger value="table">Table</TabsTrigger>
              </TabsList>
              <Button variant="ghost" size="sm" onClick={handleCopyCsv}>
                Copy as CSV
              </Button>
            </div>
          )}
        </CardHeader>
        <CardBody>
          {empty ? (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          ) : (
            <>
              <TabsContent value="chart">{chart}</TabsContent>
              <TabsContent value="table">{table}</TabsContent>
            </>
          )}
        </CardBody>
      </Tabs>
    </Card>
  );
}
