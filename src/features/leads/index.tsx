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
import { NAV_ORDER } from "@/app/feature";
import { BarChart3 } from "@/ui/icons";
import { DealsReportScreen } from "@/features/leads/screens/DealsReportScreen";
import { RevenueScreen } from "@/features/leads/screens/RevenueScreen";
import { start as startPoller } from "@/features/leads/poller";

export { SiteConnectionScreen } from "@/features/leads/screens/SiteConnectionScreen";
export { DealsReportScreen } from "@/features/leads/screens/DealsReportScreen";
export { ReportsFrame, ReportTabs, REPORT_TABS } from "@/features/leads/components/ReportsFrame";
export type { ReportTabId } from "@/features/leads/components/ReportsFrame";
export { RevenueScreen } from "@/features/leads/screens/RevenueScreen";
export { usePollStatus } from "@/features/leads/hooks";
export { PollBanner } from "@/features/leads/components/PollBanner";
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
    // TEMPORARY: /reports becomes the Overview page when it lands.
    { path: "/reports", element: <DealsReportScreen /> },
    { path: "/reports/revenue", element: <RevenueScreen /> },
    { path: "/reports/deals", element: <DealsReportScreen /> },
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
