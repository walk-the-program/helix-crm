/**
 * The data feature: CSV import, export, backups, duplicates and merge, and
 * the attachments component the records screens adopt.
 *
 *   /import      the wizard            nav "Import", order 70
 *   /export      every entity out
 *   /duplicates  candidate pairs + the merges history
 *   /backups     the backup list and restore
 *
 * /backups is temporary: docs/CONTRACTS.md puts backups under Settings, which
 * another agent owns. It lives at a top-level route until the orchestrator
 * moves it to /settings/backups (see docs/STATUS.md).
 *
 * onBoot starts the two background timers this feature owns - the backup
 * schedule and the 24-hour duplicate scan - after the first paint. Both
 * respect `pauseTimers()`, so an import or a restore never competes with them.
 */
import { navigate } from "wouter/use-browser-location";
import { Upload } from "lucide-react";
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { ImportScreen } from "@/features/data/import/ImportScreen";
import { ExportScreen } from "@/features/data/export/ExportScreen";
import { DuplicatesScreen } from "@/features/data/duplicates/DuplicatesScreen";
import { BackupsScreen } from "@/features/data/backups/BackupsScreen";
import { startBackupScheduler } from "@/features/data/backups/scheduler";
import { startDuplicateScanner } from "@/features/data/duplicates/scanner";

export const feature: FeatureModule = {
  id: "data",
  routes: [
    { path: "/import", element: <ImportScreen /> },
    { path: "/export", element: <ExportScreen /> },
    { path: "/duplicates", element: <DuplicatesScreen /> },
    { path: "/backups", element: <BackupsScreen /> },
  ],
  nav: [{ label: "Import", to: "/import", icon: Upload, order: NAV_ORDER.import }],
  commands: [
    {
      id: "import-csv",
      label: "Import a CSV",
      group: "Data",
      keywords: ["csv", "spreadsheet", "hubspot", "excel", "contacts"],
      run: () => navigate("/import"),
    },
    {
      id: "export-all",
      label: "Export everything",
      group: "Data",
      keywords: ["csv", "zip", "backup", "download", "leave"],
      run: () => navigate("/export"),
    },
  ],
  async onBoot() {
    await Promise.allSettled([startBackupScheduler(), startDuplicateScanner()]);
  },
};

export default feature;

export { AttachmentList } from "@/features/data/attachments/AttachmentList";
