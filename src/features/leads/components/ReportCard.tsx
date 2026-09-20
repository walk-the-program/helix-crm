/**
 * The one card shape every report on this screen uses: a title, an optional
 * right-aligned Chart/Table toggle, a "Copy as CSV" action, and a worded
 * empty state that replaces both views when there is nothing to show.
 *
 * The chart/table toggle is built from the same `Tabs` primitive as the
 * screen's own view controls, but its state lives per card - each report
 * remembers its own choice independently, which is why `Tabs.Root` wraps
 * this whole component rather than living at the screen level.
 *
 * `data-report` names the card in the DOM. The leads e2e needs to scope its
 * locators to one card, and it used to do that by matching the shadow class
 * every card carried; cards cast no shadow, so the card says what it is
 * instead of being recognised by how it was painted.
 *
 * No button on this card is the primary one. The chart's bars already carry
 * the screen's block of primary, and "Copy as CSV" is a convenience, not the
 * thing the owner came to Reports to do.
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
      toast.success("Copied the report to the clipboard");
    } catch {
      toast.error("The clipboard refused it.");
    }
  }

  return (
    <Card data-report={title}>
      <Tabs value={view} onValueChange={(next) => setView(next === "table" ? "table" : "chart")}>
        <CardHeader className="px-[var(--space-5)] py-[var(--space-4)]">
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
            <div className="flex shrink-0 items-center gap-[var(--space-4)]">
              {headerExtra}
              <TabsList className="border-b-0">
                <TabsTrigger value="chart">Chart</TabsTrigger>
                <TabsTrigger value="table">Table</TabsTrigger>
              </TabsList>
              <Button variant="ghost" size="sm" onClick={handleCopyCsv}>
                Copy as CSV
              </Button>
            </div>
          )}
        </CardHeader>
        {empty ? (
          // Section-level empty (docs/DESIGN.md rule 6): this card is one of
          // several stacked on the tab, never the whole of it, so it gets the
          // quiet inline form rather than the full centred one.
          <EmptyState variant="quiet" title={emptyTitle} description={emptyDescription} />
        ) : (
          <>
            {/* The chart keeps its own padding; the table runs to the card's
                edges the way a native list view does. */}
            <TabsContent value="chart" className="pt-0">
              <CardBody className="p-[var(--space-5)]">{chart}</CardBody>
            </TabsContent>
            <TabsContent value="table" className="pt-0">
              {table}
            </TabsContent>
          </>
        )}
      </Tabs>
    </Card>
  );
}
