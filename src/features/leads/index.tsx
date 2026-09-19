/**
 * STUB. The leads feature agent replaces this file.
 * Owns: website lead poller, site settings, reports.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { EmptyState, PageHeader } from "@/ui";
import { BarChart3 } from "lucide-react";

function ReportsScreen() {
  return (
    <div>
      <PageHeader title="Reports" />
      <EmptyState
        title="Reports are not built yet"
        description="Pipeline value, won and lost, leads by source and conversion land here."
      />
    </div>
  );
}

export const feature: FeatureModule = {
  id: "leads",
  routes: [{ path: "/reports", element: <ReportsScreen /> }],
  nav: [{ label: "Reports", to: "/reports", icon: BarChart3, order: NAV_ORDER.reports }],
};

export default feature;
