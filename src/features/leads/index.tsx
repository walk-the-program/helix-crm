/**
 * The leads feature: the website lead poller, the site connection screen, and
 * the reports.
 *
 *   onBoot  -> poller.start()      after the first paint, idempotent
 *   /reports          the five reports over the SQL views in 0002_report_views
 *   /settings/site    the site connection
 *
 * "/settings/site" belongs to the settings area's URL space, so
 * `SiteConnectionScreen` is exported for the settings feature to mount. It is
 * registered here as well, and the registry puts this feature ahead of
 * settings, so wouter's Switch matches this exact path before settings'
 * "/settings/:section" catch-all. When settings mounts it, this route can go.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { BarChart3 } from "lucide-react";
import { ReportsScreen } from "@/features/leads/screens/ReportsScreen";
import { SiteConnectionScreen } from "@/features/leads/screens/SiteConnectionScreen";
import { start as startPoller } from "@/features/leads/poller";

export { SiteConnectionScreen } from "@/features/leads/screens/SiteConnectionScreen";
export { ReportsScreen } from "@/features/leads/screens/ReportsScreen";
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
    { path: "/reports", element: <ReportsScreen /> },
    { path: "/settings/site", element: <SiteConnectionScreen /> },
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
