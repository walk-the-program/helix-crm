/**
 * The data feature: CSV import, export, backups, duplicates and merge, and
 * the attachments component the records screens adopt.
 *
 *   /import      the wizard            nav "Import", order 70
 *   /export      every entity out
 *   /duplicates  candidate pairs + the merges history
 *
 * Backups have no route of their own here any more. docs/CONTRACTS.md puts
 * them under Settings, so `BackupsScreen` is exported for the settings feature
 * to mount at "/settings/backups"; the screen, the scheduler and the retention
 * policy still live in this folder, which is the feature that owns them.
 *
 * onBoot starts the two background timers this feature owns - the backup
 * schedule and the 24-hour duplicate scan - after the first paint. Both
 * respect `pauseTimers()`, so an import or a restore never competes with them.
 */
import { navigate } from "wouter/use-browser-location";
import { Upload } from "@/ui/icons";
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { ImportScreen } from "@/features/data/import/ImportScreen";
import { ExportScreen } from "@/features/data/export/ExportScreen";
import { DuplicatesScreen } from "@/features/data/duplicates/DuplicatesScreen";
import { startBackupScheduler } from "@/features/data/backups/scheduler";
import { startDuplicateScanner } from "@/features/data/duplicates/scanner";

export const feature: FeatureModule = {
  id: "data",
  routes: [
    { path: "/import", element: <ImportScreen /> },
    { path: "/export", element: <ExportScreen /> },
    { path: "/duplicates", element: <DuplicatesScreen /> },
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
export { BackupsScreen } from "@/features/data/backups/BackupsScreen";
