/**
 * Workspaces (E7): one SQLite file per business.
 *
 * A grouped inset list of workspaces, and a second one for the archived ones.
 * The open workspace wears the --color-selected tint and full ink, which is how
 * a native list marks the row you are in - position and weight, never a
 * coloured rail. Its own row is the only one that cannot be switched to or
 * archived.
 *
 * "New workspace" is the screen's one block of brand primary. It is in the
 * header when there are workspaces and in the empty state when there are none,
 * never in both at once.
 *
 * The list is helix.json, not the database, because a closed workspace cannot be
 * queried - which is also why the last poll and last backup times are mirrored
 * there on every poll and backup.
 *
 * Switching closes the open file and opens another, so it is refused while a
 * write holds the lock, and the message says why. Archiving deletes that
 * workspace's keychain entries and nothing else: the files stay where they are,
 * and the confirmation says so before it runs.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, ICON_SIZE_SM, ICON_WEIGHT_STRONG, Pencil } from "@/ui/icons";
import {
  Badge,
  Button,
  CardRow,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  toast,
} from "@/ui";
import { cn } from "@/ui/cn";
import { useFormats } from "@/app/formats";
import { useWriteState } from "@/app/hooks";
import type { WorkspaceEntry } from "@/app/appSettings";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsNotice,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";
import { refetchRegistry, useRegistry } from "@/features/settings/lib/queries";
import {
  archiveWorkspace,
  createWorkspace,
  openWorkspaceById,
  renameWorkspace,
  switchBlockedReason,
  unarchiveWorkspace,
} from "@/features/settings/lib/workspaces";
import { messageFrom } from "@/lib/errors";
import { HelpLink } from "@/features/help";

function stamp(value: string | null, never: string, dateTime: (v: string) => string): string {
  return value ? dateTime(value) : never;
}

function WorkspaceRow(props: {
  workspace: WorkspaceEntry;
  open: boolean;
  busy: boolean;
  last: boolean;
  onSwitch: () => void;
  onRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const { workspace, open, busy, last } = props;
  const formats = useFormats();

  return (
    <CardRow
      className={cn(
        "items-center gap-[var(--space-4)] py-[var(--space-3)]",
        open && "bg-[var(--color-selected)]",
        last && "border-b-0",
      )}
      data-testid="workspace-row"
      data-workspace-name={workspace.name}
      data-workspace-open={open ? "true" : "false"}
    >
      <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <span
            className="truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)]"
            title={workspace.name}
          >
            {workspace.name}
          </span>
          {open ? <Badge tone="neutral">Open</Badge> : null}
          {workspace.archived ? <Badge tone="neutral">Archived</Badge> : null}
        </div>
        <div className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          <span className="tabular">
            Last backup {stamp(workspace.lastBackupAt, "never", formats.dateTime)}
          </span>
          {" · "}
          <span className="tabular">
            Last lead check {stamp(workspace.lastPolledAt, "never", formats.dateTime)}
          </span>
        </div>
      </div>

      <div className="flex flex-none items-center gap-[var(--space-1)]">
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Pencil size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
          onClick={props.onRename}
          data-testid="workspace-rename"
        >
          Rename
        </Button>
        {workspace.archived ? (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={
              <ArchiveRestore size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
            }
            onClick={props.onUnarchive}
            data-testid="workspace-unarchive"
          >
            Restore to the list
          </Button>
        ) : (
          <>
            {open ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={props.onSwitch}
                disabled={busy}
                data-testid="workspace-switch"
              >
                Switch to it
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onArchive}
              disabled={open}
              data-testid="workspace-archive"
            >
              Archive
            </Button>
          </>
        )}
      </div>
    </CardRow>
  );
}

export function WorkspacesScreen() {
  const client = useQueryClient();
  const { data: registry, isLoading } = useRegistry();
  const write = useWriteState();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<WorkspaceEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [archiving, setArchiving] = useState<WorkspaceEntry | null>(null);
  const [pending, setPending] = useState(false);
  // Bumped after every registry write. `useRegistry`'s observer is holding a
  // query object that `queryClient.clear()` removed on the way through
  // db_open, and it only rebuilds against the refreshed cache when the
  // component renders again - which nothing else here makes it do.
  const [, setRegistryTick] = useState(0);

  // Always a refetch, never an invalidate: a switch clears the whole query
  // cache on its way through db_open, so there is nothing left to invalidate.
  async function refresh() {
    await refetchRegistry(client);
    setRegistryTick((tick) => tick + 1);
  }

  async function onCreate() {
    const name = newName.trim();
    if (name.length === 0) return;
    setPending(true);
    try {
      const entry = await createWorkspace(name);
      await refresh();
      setCreating(false);
      setNewName("");
      await openWorkspaceById(entry.id);
      await refresh();
      toast.success(`Created ${entry.name} and switched to it`);
    } catch (err) {
      toast.error(
        messageFrom(
          err,
          "Helix could not create that workspace. Nothing changed, and the workspace you were in is still open.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function onSwitch(entry: WorkspaceEntry) {
    try {
      await openWorkspaceById(entry.id);
      await refresh();
      toast.success(`Switched to ${entry.name}`);
    } catch (err) {
      toast.error(
        messageFrom(
          err,
          `Helix could not open ${entry.name}. The workspace you were in is still open, so nothing is lost. Try again, and if it keeps failing, check Diagnostics for where that file is.`,
        ),
      );
    }
  }

  async function onRename() {
    if (!renaming) return;
    const name = renameValue.trim();
    if (name.length === 0) return;
    setPending(true);
    try {
      await renameWorkspace(renaming.id, name);
      await refresh();
      setRenaming(null);
      toast.success(`Renamed it to ${name}`);
    } catch (err) {
      // A rename that fails used to say nothing at all: the dialog simply
      // stayed open with the old name still in the list, which reads as the
      // click having missed.
      toast.error(
        messageFrom(
          err,
          "Helix could not rename that workspace. Its records are untouched; try again.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function onArchive() {
    if (!archiving) return;
    try {
      await archiveWorkspace(archiving.id);
      await refresh();
      toast.success(`Archived ${archiving.name}. The files are still on disk.`);
    } catch (err) {
      toast.error(
        messageFrom(
          err,
          `Helix could not archive ${archiving.name}. Nothing was removed and nothing was deleted; try again.`,
        ),
      );
    } finally {
      setArchiving(null);
    }
  }

  const blocked = switchBlockedReason();
  const workspaces = registry?.workspaces ?? [];
  const live = workspaces.filter((w) => !w.archived);
  const archived = workspaces.filter((w) => w.archived);

  function rowProps(workspace: WorkspaceEntry) {
    return {
      workspace,
      busy: write.busy,
      onSwitch: () => void onSwitch(workspace),
      onRename: () => {
        setRenaming(workspace);
        setRenameValue(workspace.name);
      },
      onArchive: () => setArchiving(workspace),
      onUnarchive: () => void unarchiveWorkspace(workspace.id).then(refresh),
    };
  }

  return (
    <SettingsScreenFrame
      title="Workspaces"
      subtitle="One file per business. Only the one you have open polls for leads and backs up."
      testId="settings-workspaces"
      actions={
        live.length > 0 ? (
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="workspace-new">
            New workspace
          </Button>
        ) : undefined
      }
    >
      {blocked ? (
        <SettingsNotice data-testid="workspace-blocked">{blocked}</SettingsNotice>
      ) : null}

      {isLoading ? (
        <SettingsLoading>Reading the workspace list…</SettingsLoading>
      ) : live.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="A workspace is one business: its own file, its own contacts, its own backups."
          action={
            <Button
              variant="primary"
              onClick={() => setCreating(true)}
              data-testid="workspace-new"
            >
              New workspace
            </Button>
          }
        />
      ) : (
        <SettingsGroup label="Your workspaces">
          {live.map((workspace, index) => (
            <WorkspaceRow
              key={workspace.id}
              {...rowProps(workspace)}
              open={registry?.lastOpened === workspace.id}
              last={index === live.length - 1}
            />
          ))}
        </SettingsGroup>
      )}

      {archived.length > 0 ? (
        <SettingsGroup
          label="Archived"
          footnote="Hidden from the switcher. The files are untouched and can come back at any time."
        >
          {archived.map((workspace, index) => (
            <WorkspaceRow
              key={workspace.id}
              {...rowProps(workspace)}
              open={false}
              last={index === archived.length - 1}
            />
          ))}
        </SettingsGroup>
      ) : null}

      {live.length > 0 ? (
        <p
          data-testid="workspace-removal-note"
          className="px-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
        >
          Archiving keeps every file exactly where it is; there is no button in Helix
          that erases a workspace. If a workspace's data needs to be gone for good -
          a client's relationship with you has ended, for instance - see{" "}
          <HelpLink to="workspace-removal">
            Removing a workspace for good
          </HelpLink>{" "}
          for the exact steps.
        </p>
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="sm" data-testid="workspace-new-dialog">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
          <Field
            label="Business name"
            hint="A new database file is created for it, and Helix switches to it."
          >
            <Input
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreate();
              }}
              placeholder="Second business"
              data-testid="workspace-new-name"
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onCreate()}
              loading={pending}
              loadingLabel="Creating…"
              data-testid="workspace-new-create"
            >
              Create and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
          </DialogHeader>
          <Field label="Name">
            <Input
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onRename();
              }}
              data-testid="workspace-rename-input"
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onRename()}
              loading={pending}
              loadingLabel="Saving…"
              data-testid="workspace-rename-save"
            >
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={archiving ? `Archive ${archiving.name}?` : "Archive workspace"}
        description="It leaves the switcher and stops being backed up. Its saved keys are removed from the keychain. No files are deleted, and you can bring it back from this screen."
        confirmLabel="Archive workspace"
        onConfirm={() => void onArchive()}
      />
    </SettingsScreenFrame>
  );
}
