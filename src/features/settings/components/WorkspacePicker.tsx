/**
 * The workspace switcher, as a dialog.
 *
 * The sidebar footer already shows the open workspace's name, and that is where
 * this belongs - but the shell is another agent's file, so the switcher is
 * reached from the command palette ("Switch workspace") and from Settings >
 * Workspaces instead. See docs/STATUS.md: the one-line change to make the
 * footer open this is noted there.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useLocation } from "wouter";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@/ui";
import { formatDateTimeDisplay } from "@/lib/dates";
import { refetchRegistry, useRegistry } from "@/features/settings/lib/queries";
import {
  openWorkspaceById,
  switchBlockedReason,
} from "@/features/settings/lib/workspaces";

export function WorkspacePicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange } = props;
  const client = useQueryClient();
  const { data: registry } = useRegistry();
  const [, navigate] = useLocation();

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
      toast.error(err instanceof Error ? err.message : String(err));
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

        {blocked ? (
          <p
            className="rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-warning-ink)]"
            role="status"
          >
            {blocked}
          </p>
        ) : null}

        <div className="flex flex-col">
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
                className={[
                  "flex min-h-[44px] items-center justify-between gap-[var(--space-3)]",
                  "rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2)] text-left",
                  "text-[length:var(--text-base)] text-[var(--color-text)]",
                  "hover:bg-[var(--color-hover)] disabled:opacity-60 disabled:hover:bg-transparent",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                ].join(" ")}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{workspace.name}</span>
                  <span className="block text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
                    {workspace.lastBackupAt
                      ? `Backed up ${formatDateTimeDisplay(workspace.lastBackupAt)}`
                      : "No backup yet"}
                  </span>
                </span>
                {isOpen ? (
                  <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
                    <Check size={14} aria-hidden />
                    Open
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <DialogFooter>
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
