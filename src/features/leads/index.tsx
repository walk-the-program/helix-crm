/**
 * The leads feature: the website lead poller, the site connection screen, and
 * the reports.
 *
 *   onBoot  -> poller.start()      after the first paint, idempotent
 *   /reports          the five reports over the SQL views in 0002_report_views
 *
 * The site connection screen has no route of its own here. "/settings/site"
 * belongs to the settings area's URL space, so `SiteConnectionScreen` is
 * exported for the settings feature to mount there; the screen and everything
 * behind it still live in this folder, which is the feature that owns them.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER, lazyScreen } from "@/app/feature";
import { BarChart3 } from "@/ui/icons";
import { OverviewScreen } from "@/features/leads/screens/OverviewScreen";
import { start as startPoller } from "@/features/leads/poller";

/**
 * The three chart-bearing reports load when the owner asks for them.
 *
 * recharts is the single heaviest thing in the bundle and `components/charts.tsx`
 * is reachable from these three screens and nowhere else - checked, not assumed:
 * nothing under Today, the board or the records screens imports either. Overview
 * stays static because it is the /reports landing route and draws its stage bars
 * with plain elements, so it costs nothing to keep and a blank frame to defer.
 *
 * The Suspense boundary is the shell's, one for the whole route switch, so
 * nothing here declares a fallback.
 */
const RevenueScreenLazy = lazyScreen(
  () => import("@/features/leads/screens/RevenueScreen"),
  (m) => m.RevenueScreen,
);
const DealsReportScreenLazy = lazyScreen(
  () => import("@/features/leads/screens/DealsReportScreen"),
  (m) => m.DealsReportScreen,
);
const PeopleReportScreenLazy = lazyScreen(
  () => import("@/features/leads/screens/PeopleReportScreen"),
  (m) => m.PeopleReportScreen,
);

export { SiteConnectionScreen } from "@/features/leads/screens/SiteConnectionScreen";
export { OverviewScreen } from "@/features/leads/screens/OverviewScreen";
/*
 * RevenueScreen, DealsReportScreen and PeopleReportScreen are deliberately NOT
 * re-exported here. A static re-export from this file would pull all three -
 * and recharts behind them - straight back into the main chunk, undoing the
 * split above, and it would do it silently: the build still succeeds, the app
 * still works, and the only symptom is a megabyte back on launch. Nothing
 * imports them today (checked). If something ever needs one, import the screen
 * module directly and think about what that does to the boot download.
 */
export { ReportsFrame, ReportTabs, REPORT_TABS } from "@/features/leads/components/ReportsFrame";
export type { ReportTabId } from "@/features/leads/components/ReportsFrame";
export { usePollStatus } from "@/features/leads/hooks";
export { PollBanner } from "@/features/leads/components/PollBanner";
/**
 * The one-line version for Today, mounted by the records feature at the top of
 * TodayPanels. Renders null unless the poll banner is due, so the mount point
 * needs no condition of its own.
 */
export { PollNotice } from "@/features/leads/components/PollNotice";
export {
  getStatus as getPollStatus,
  subscribe as subscribePollStatus,
  refresh as refreshPoller,
  tick as pollNow,
} from "@/features/leads/poller";
export type { PollStatus } from "@/features/leads/lib/types";

export const feature: FeatureModule = {
  id: "leads",
  routes: [
    { path: "/reports", element: <OverviewScreen /> },
    { path: "/reports/revenue", element: <RevenueScreenLazy /> },
    { path: "/reports/deals", element: <DealsReportScreenLazy /> },
    { path: "/reports/people", element: <PeopleReportScreenLazy /> },
    // "/reports/receivables" is the invoices feature's own route; the tab
    // strip links to it and the sidebar keeps Reports lit on every path
    // under /reports.
  ],
  nav: [
    { label: "Reports", to: "/reports", icon: BarChart3, order: NAV_ORDER.reports },
  ],
  async onBoot() {
    // A failure here must never take the app down; boot.ts already catches,
    // and the poller itself logs and keeps its own state.
    await startPoller();
  },
};

export default feature;
