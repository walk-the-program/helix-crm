/**
 * The chrome every report page wears: one tab strip and one period control.
 *
 * Walker's bug, in his words: "When I click the reports button in the top
 * right next to this month, it just takes me to a screen that I can't get out
 * of." That button was on the Reports page and it went to /reports/revenue,
 * which rendered a title and nothing else - no way back to the report he came
 * from and no sign that Revenue was one report among several. The fix is not a
 * back button. It is that Reports is one place with five views, and every one
 * of them says so.
 *
 * So the strip is on every page, it always shows which view is open, and the
 * period control sits in the header beside it. The period is state, never a
 * route: changing it re-runs the queries under the same URL, which is the
 * other half of the same complaint - a control in a header that navigates is
 * a control that can strand you.
 *
 * The strip is `Tabs` from the kit with no `TabsContent` under it, the same
 * way the report cards' Chart/Table switch uses it: the routed page is the
 * panel. Choosing a tab navigates, so the browser history holds one entry per
 * report and Back does what it says.
 */
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { PageHeader, Tabs, TabsList, TabsTrigger } from "@/ui";
import { PeriodPicker } from "@/features/leads/components/PeriodPicker";
import type { Period } from "@/lib/periods";

export type ReportTabId = "overview" | "revenue" | "deals" | "people" | "receivables";

/**
 * The five views, in the order the owner reads them: the summary, then the
 * money, then the work, then the people, then who owes.
 *
 * Receivables is the invoices feature's screen at its own route. It is listed
 * here because it is one of the five reports as far as the owner is concerned,
 * and the sidebar keeps Reports lit on every path under /reports.
 */
export const REPORT_TABS: { id: ReportTabId; label: string; to: string }[] = [
  { id: "overview", label: "Overview", to: "/reports" },
  { id: "revenue", label: "Revenue", to: "/reports/revenue" },
  { id: "deals", label: "Deals", to: "/reports/deals" },
  { id: "people", label: "Contacts and companies", to: "/reports/people" },
  { id: "receivables", label: "Receivables", to: "/reports/receivables" },
];

export function ReportTabs(props: { active: ReportTabId }) {
  const [, navigate] = useLocation();
  const { active } = props;

  return (
    <Tabs
      value={active}
      onValueChange={(next) => {
        const tab = REPORT_TABS.find((candidate) => candidate.id === next);
        if (tab && tab.id !== active) navigate(tab.to);
      }}
    >
      <TabsList data-testid="reports-tabs" className="overflow-x-auto">
        {REPORT_TABS.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * A report page: the title, the strip, and the page's own content under it.
 *
 * `period` is optional because two of the five views have no range to pick.
 * Revenue's MRR and Receivables' aging are both "as of today" facts, and a
 * picker over a figure it does not change is a lie about the screen.
 */
export function ReportsFrame(props: {
  active: ReportTabId;
  title: string;
  subtitle?: ReactNode;
  /** Renders the period control in the header and keeps it out of the URL. */
  period?: { value: Period; onChange: (period: Period) => void };
  /** Extra header controls, left of the period picker. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { active, title, subtitle, period, actions, children } = props;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          actions || period ? (
            <>
              {actions}
              {period ? <PeriodPicker value={period.value} onChange={period.onChange} /> : null}
            </>
          ) : undefined
        }
      />
      <ReportTabs active={active} />
      <div className="flex flex-col gap-[var(--space-6)] pt-[var(--space-6)]">{children}</div>
    </div>
  );
}
