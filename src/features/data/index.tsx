/**
 * STUB. The data feature agent replaces this file.
 * Owns: CSV import, export, backup/restore, duplicates/merge, attachments.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { EmptyState, PageHeader } from "@/ui";
import { Upload } from "lucide-react";

function ImportScreen() {
  return (
    <div>
      <PageHeader title="Import" subtitle="Bring a spreadsheet or another CRM in." />
      <EmptyState
        title="Import is not built yet"
        description="CSV import, export, backups and merge land here."
      />
    </div>
  );
}

export const feature: FeatureModule = {
  id: "data",
  routes: [{ path: "/import", element: <ImportScreen /> }],
  nav: [{ label: "Import", to: "/import", icon: Upload, order: NAV_ORDER.import }],
};

export default feature;
