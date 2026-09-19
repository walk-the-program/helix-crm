/**
 * Workspaces (E7): one SQLite file per business.
 *
 * The list is helix.json, not the database, because a closed workspace cannot
 * be queried - which is also why the last poll and last backup times are
 * mirrored there on every poll and backup.
 *
 * Switching closes the open file and opens another, so it is refused while a
 * write holds the lock, and the message says why. Archiving deletes that
 * workspace's keychain entries and nothing else: the files stay where they are,
 * and the confirmation says so before it runs.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, Box, Check, Pencil } from "lucide-react";
import {
  Badge,
  Button,
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
import { formatDateTimeDisplay } from "@/lib/dates";
import { useWriteState } from "@/app/hooks";
import type { WorkspaceEntry } from "@/app/appSettings";
import {
  SettingsScreenFrame,
  SettingsBlock,
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

function Timestamp(props: { value: string | null; never: string }) {
  if (!props.value) {
    return <span className="text-[var(--color-text-faint)]">{props.never}</span>;
  }
  return <span className="tabular">{formatDateTimeDisplay(props.value)}</span>;
}

function WorkspaceRow(props: {
  workspace: WorkspaceEntry;
  open: boolean;
  busy: boolean;
  onSwitch: () => void;
  onRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const { workspace, open, busy } = props;

  return (
    <div
      className="flex items-center gap-[var(--space-4)] border-b border-[var(--color-border)] py-[var(--space-3)] last:border-b-0"
      data-testid="workspace-row"
      data-workspace-name={workspace.name}
      data-workspace-open={open ? "true" : "false"}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[var(--space-2)]">
          <span
            className="truncate text-[length:var(--text-lg)] font-medium text-[var(--color-text)]"
            title={workspace.name}
          >
            {workspace.name}
          </span>
          {open ? <Badge tone="success">Open</Badge> : null}
          {workspace.archived ? <Badge tone="neutral">Archived</Badge> : null}
        </div>
        <div className="mt-[var(--space-1)] flex flex-wrap gap-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
          <span>
            Last opened:{" "}
            {open ? "now" : <Timestamp value={null} never="not this session" />}
          </span>
          <span>
            Last lead check:{" "}
            <Timestamp value={workspace.lastPolledAt} never="never" />
          </span>
          <span>
            Last backup: <Timestamp value={workspace.lastBackupAt} never="never" />
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-[var(--space-2)]">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Pencil size={14} aria-hidden />}
          onClick={props.onRename}
          data-testid="workspace-rename"
        >
          Rename
        </Button>
        {workspace.archived ? (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<ArchiveRestore size={14} aria-hidden />}
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
              variant="secondary"
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
    </div>
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
      toast.error(err instanceof Error ? err.message : String(err));
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
      toast.error(err instanceof Error ? err.message : String(err));
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
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiving(null);
    }
  }

  const blocked = switchBlockedReason();
  const workspaces = registry?.workspaces ?? [];
  const live = workspaces.filter((w) => !w.archived);
  const archived = workspaces.filter((w) => w.archived);

  return (
    <SettingsScreenFrame
      title="Workspaces"
      subtitle="One file per business. Only the one you have open polls for leads and backs up."
      testId="settings-workspaces"
      actions={
        <Button
          variant="primary"
          onClick={() => setCreating(true)}
          data-testid="workspace-new"
        >
          New workspace
        </Button>
      }
    >
      {blocked ? (
        <p
          className="mb-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-warning-ink)]"
          role="status"
          data-testid="workspace-blocked"
        >
          {blocked}
        </p>
      ) : null}

      {isLoading ? (
        <p
          className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          role="status"
        >
          Reading the workspace list…
        </p>
      ) : live.length === 0 ? (
        <EmptyState
          icon={<Box size={24} aria-hidden />}
          title="No workspaces yet"
          description="A workspace is one business: its own file, its own contacts, its own backups."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              New workspace
            </Button>
          }
        />
      ) : (
        <SettingsBlock title="Your workspaces">
          {live.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              open={registry?.lastOpened === workspace.id}
              busy={write.busy}
              onSwitch={() => void onSwitch(workspace)}
              onRename={() => {
                setRenaming(workspace);
                setRenameValue(workspace.name);
              }}
              onArchive={() => setArchiving(workspace)}
              onUnarchive={() => void unarchiveWorkspace(workspace.id).then(refresh)}
            />
          ))}
        </SettingsBlock>
      )}

      {archived.length > 0 ? (
        <SettingsBlock
          title="Archived"
          description="Hidden from the switcher. The files are untouched and can come back at any time."
        >
          {archived.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              open={false}
              busy={write.busy}
              onSwitch={() => void onSwitch(workspace)}
              onRename={() => {
                setRenaming(workspace);
                setRenameValue(workspace.name);
              }}
              onArchive={() => setArchiving(workspace)}
              onUnarchive={() => void unarchiveWorkspace(workspace.id).then(refresh)}
            />
          ))}
        </SettingsBlock>
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
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onCreate()}
              loading={pending}
              iconLeft={<Check size={16} aria-hidden />}
              data-testid="workspace-new-create"
            >
              Create and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
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
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onRename()}
              loading={pending}
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
