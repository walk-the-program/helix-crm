/**
 * The workspace switcher, as a native sheet: a title, a sentence, and one
 * grouped inset list of workspaces. The row is the action - there is no Switch
 * button per row, because picking the row is what picking the row means - and
 * the open one wears the --color-selected tint with a check on the right, the
 * way a macOS list marks the item you are already in.
 *
 * The sidebar footer already shows the open workspace's name, and that is where
 * this belongs - but the shell is another agent's file, so the switcher is
 * reached from the command palette ("Switch workspace") and from Settings >
 * Workspaces instead. See docs/STATUS.md: the one-line change to make the
 * footer open this is noted there.
 *
 * Both lines of a row truncate with an ellipsis and carry a `title` (DESIGN.md
 * §4), so a long workspace name or backup stamp never widens the row. The row
 * is a native `<button>` so the whole thing is one click target - the only
 * place in the app that wraps a two-line row in a real button rather than a
 * div - and a bare `<button>` comes out of the Tauri webview with
 * `white-space: pre`, which nothing else resets for plain text. Left alone,
 * the untruncated backup line inherits that and refuses to wrap, stretching
 * the row past the dialog and pushing the check mark and "Open" off the
 * edge. `whitespace-normal` on the button undoes it.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Check, ICON_SIZE } from "@/ui/icons";
import { useLocation } from "wouter";
import {
  Button,
  Card,
  CardRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@/ui";
import { cn } from "@/ui/cn";
import { useFormats } from "@/app/formats";
import { SettingsNotice } from "@/features/settings/components/SettingsLayout";
import { refetchRegistry, useRegistry } from "@/features/settings/lib/queries";
import {
  openWorkspaceById,
  switchBlockedReason,
} from "@/features/settings/lib/workspaces";
import { messageFrom } from "@/lib/errors";

export function WorkspacePicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange } = props;
  const client = useQueryClient();
  const { data: registry } = useRegistry();
  const [, navigate] = useLocation();
  const formats = useFormats();

  const blocked = switchBlockedReason();
  const workspaces = (registry?.workspaces ?? []).filter((w) => !w.archived);
  const openId = registry?.lastOpened ?? null;

  async function choose(id: string, name: string) {
    try {
      await openWorkspaceById(id);
      // The switch cleared the cache; refetch rather than invalidate.
      await refetchRegistry(client);
      onOpenChange(false);
      toast.success(`Switched to ${name}`);
    } catch (err) {
      toast.error(
        messageFrom(
          err,
          `Helix could not open ${name}. The workspace you were in is still open, so nothing is lost. Try again, and if it keeps failing, check Diagnostics for where that file is.`,
        ),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="workspace-picker">
        <DialogHeader>
          <DialogTitle>Switch workspace</DialogTitle>
          <DialogDescription>
            Each one is its own file. Helix closes this one and opens the other.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          {blocked ? <SettingsNotice>{blocked}</SettingsNotice> : null}

          {/* No section label: a sheet holding one list does not need to name
              it, and the title two lines up already has. */}
          <div className="flex flex-col">
            <Card className="overflow-hidden">
              {workspaces.map((workspace) => {
                const isOpen = workspace.id === openId;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    disabled={isOpen || blocked !== null}
                    onClick={() => void choose(workspace.id, workspace.name)}
                    data-testid="workspace-picker-item"
                    data-workspace-name={workspace.name}
                    className={cn(
                      "block w-full min-w-0 text-left",
                      // A native <button> defaults to `white-space: pre` in the
                      // Tauri webview, which is never reset for plain text the
                      // way the design system's own components reset it. Left
                      // alone, the second line below inherits that and refuses
                      // to wrap, stretching the row past the panel and pushing
                      // the check mark and "Open" off the edge - which is the
                      // exact clip Walker found. This is the only row in the
                      // app built from a raw <button>, so it is the only place
                      // that needs the override.
                      "whitespace-normal",
                      // The hairline is the button's, not the row's: the button
                      // is the panel's child, so only it knows it is last.
                      "border-b border-[var(--color-border)] last:border-b-0",
                      "enabled:hover:bg-[var(--color-hover)] disabled:cursor-default",
                      "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]",
                      "focus-visible:-outline-offset-2",
                      isOpen && "bg-[var(--color-selected)]",
                    )}
                  >
                    <CardRow className="min-w-0 items-center gap-[var(--space-3)] border-b-0 py-[var(--space-2)]">
                      <span className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
                        <span className="truncate font-medium" title={workspace.name}>
                          {workspace.name}
                        </span>
                        <span className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)] tabular">
                          {workspace.lastBackupAt
                            ? `Backed up ${formats.dateTime(workspace.lastBackupAt)}`
                            : "No backup yet"}
                        </span>
                      </span>
                      {isOpen ? (
                        <span className="inline-flex flex-none items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text)]">
                          <Check size={ICON_SIZE} aria-hidden />
                          Open
                        </span>
                      ) : null}
                    </CardRow>
                  </button>
                );
              })}
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
              navigate("/settings/workspaces");
            }}
          >
            Manage workspaces
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
