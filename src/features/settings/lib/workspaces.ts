/**
 * Workspaces (PLAN.md extra E7): one SQLite file per business at
 * <appData>/workspaces/<uuid>/helix.db, with attachments and backups beside it.
 *
 *   create  -> new uuid, registry entry, then switch to it (boot opens, migrates, seeds)
 *   switch  -> boot.switchWorkspace: db_close, db_open, migrate, seed, clear the cache
 *   archive -> registry flag + secret_delete for this workspace's keys. Never deletes files.
 *
 * Only the open workspace polls for leads and backs up, so the switcher reads
 * each one's last poll and last backup from helix.json rather than the database.
 * Switching is refused while a write holds the lock (an import or a restore),
 * because db_close in the middle of one would strand it.
 */
import { newId } from "@/lib/ids";
import {
  appPaths,
  readRegistry,
  updateRegistry,
  workspaceDbPath,
  type HelixRegistry,
  type WorkspaceEntry,
} from "@/app/appSettings";
import { switchWorkspace as bootSwitchWorkspace } from "@/app/boot";
import { writeState } from "@/db/writeLock";
import { deleteSecret } from "@/features/ai/lib/secrets";

export type WorkspaceBusyError = { busy: true; label: string | null };

/** Why a switch is refused right now, or null when it is safe. */
export function switchBlockedReason(): string | null {
  if (!writeState.busy) return null;
  const what = writeState.label ? writeState.label.toLowerCase() : "a write";
  return `Helix is busy with ${what}. Switching now would interrupt it; try again in a moment.`;
}

export async function listWorkspaces(): Promise<WorkspaceEntry[]> {
  const registry = await readRegistry();
  return registry.workspaces;
}

/**
 * A new workspace: a uuid, a folder under the workspaces directory, a registry
 * entry, and then the same open-migrate-seed sequence boot runs. The file
 * itself is created by db_open, exactly as `ensureFirstWorkspace` does on a
 * first launch - JS never creates the database.
 */
export async function createWorkspace(name: string): Promise<WorkspaceEntry> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("A workspace needs a name.");
  }
  const paths = await appPaths();
  const id = newId();
  const entry: WorkspaceEntry = {
    id,
    name: trimmed,
    path: workspaceDbPath(paths.workspacesDir, id),
    lastPolledAt: null,
    lastBackupAt: null,
    archived: false,
  };
  await updateRegistry((current) => ({
    ...current,
    workspaces: [...current.workspaces, entry],
  }));
  return entry;
}

export async function renameWorkspace(
  id: string,
  name: string,
): Promise<HelixRegistry> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("A workspace needs a name.");
  }
  return updateRegistry((current) => ({
    ...current,
    workspaces: current.workspaces.map((w) =>
      w.id === id ? { ...w, name: trimmed } : w,
    ),
  }));
}

/** Close the open file and bring the chosen one up. Throws when blocked. */
export async function openWorkspaceById(id: string): Promise<WorkspaceEntry> {
  const blocked = switchBlockedReason();
  if (blocked) throw new Error(blocked);

  const registry = await readRegistry();
  const target = registry.workspaces.find((w) => w.id === id);
  if (!target) throw new Error("That workspace is no longer in the list.");
  if (target.archived) throw new Error("That workspace is archived. Restore it first.");

  await bootSwitchWorkspace(target);
  return target;
}

/**
 * Archiving hides a workspace and deletes its secrets from the keychain (E7).
 * The files are left exactly where they are: this is a list change, not a
 * delete, and the confirmation says so.
 */
export async function archiveWorkspace(id: string): Promise<void> {
  const registry = await readRegistry();
  if (registry.lastOpened === id) {
    throw new Error("This is the workspace you have open. Switch to another one first.");
  }
  const live = registry.workspaces.filter((w) => !w.archived);
  if (live.length <= 1) {
    throw new Error("This is your only workspace, so it cannot be archived.");
  }

  // Best effort: a machine with no keychain must not block the archive.
  await Promise.all([
    deleteSecret(id, "anthropic").catch(() => undefined),
    deleteSecret(id, "site").catch(() => undefined),
  ]);

  await updateRegistry((current) => ({
    ...current,
    workspaces: current.workspaces.map((w) =>
      w.id === id ? { ...w, archived: true } : w,
    ),
  }));
}

export async function unarchiveWorkspace(id: string): Promise<void> {
  await updateRegistry((current) => ({
    ...current,
    workspaces: current.workspaces.map((w) =>
      w.id === id ? { ...w, archived: false } : w,
    ),
  }));
}

/** The workspace whose database is open right now. */
export async function currentWorkspaceId(): Promise<string | null> {
  const registry = await readRegistry();
  return registry.lastOpened;
}
