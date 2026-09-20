/**
 * The optional AI module (PLAN.md extra E1).
 *
 * Off by default, the owner's own Anthropic key in the OS keychain, three
 * actions that only ever run when he presses a button, and nothing in the
 * background. No sidebar item: AI is reached from Settings and from a record.
 *
 * What this feature exports for the other features to mount, documented in
 * src/features/ai/README.md:
 *
 *   PasteToRecordDialog({ open, onOpenChange, initialText? })
 *   DraftFollowUpButton({ dealId, email? })
 *   SummarizeButton({ entityType, entityId })
 *
 * Until the records feature mounts them, paste-to-record is reachable on its
 * own through the "ai-paste" command (mod+shift+v), which opens the dialog from
 * the always-mounted host below.
 */
import { useSyncExternalStore } from "react";
import type { FeatureModule } from "@/app/feature";
import { createOpener } from "@/features/settings/lib/opener";
import { AiSettingsScreen } from "@/features/ai/components/AiSettingsScreen";
import { PasteToRecordDialog } from "@/features/ai/components/PasteToRecordDialog";

export { PasteToRecordDialog } from "@/features/ai/components/PasteToRecordDialog";
export { DraftFollowUpButton } from "@/features/ai/components/DraftFollowUpButton";
export { SummarizeButton } from "@/features/ai/components/SummarizeButton";
export { AiActionButton, AiReason } from "@/features/ai/components/AiGate";
export { useAi } from "@/features/ai/lib/useAi";
export type { AiEntityType } from "@/features/ai/lib/context";

/** Opened by the "ai-paste" command and by mod+shift+v. */
export const pasteDialog = createOpener();

function AiHost() {
  const open = useSyncExternalStore(
    pasteDialog.subscribe,
    pasteDialog.isOpen,
    pasteDialog.isOpen,
  );

  // mod+shift+v is bound by the shell from the "ai-paste" command below, so
  // there is nothing to listen for here.
  return <PasteToRecordDialog open={open} onOpenChange={pasteDialog.setOpen} />;
}

export const feature: FeatureModule = {
  id: "ai",
  routes: [{ path: "/settings/ai", element: <AiSettingsScreen /> }],
  commands: [
    {
      id: "ai-paste",
      label: "Paste an email or text into a record",
      shortcut: "mod+shift+v",
      group: "AI",
      keywords: ["ai", "paste", "extract", "voicemail", "lead"],
      run: () => pasteDialog.open(),
    },
  ],
  /** The paste sheet, on every screen, through the shell's own providers. */
  overlays: () => <AiHost />,
};

export default feature;
