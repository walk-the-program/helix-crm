/**
 * The recovery key, from the screen's side.
 *
 *   BackupsScreen ---> revealRecoveryKey()      ---> recovery_key_reveal   (Rust)
 *                 ---> saveRecoveryKeyFile()    ---> save dialog + write
 *                 ---> adoptBackup(path, key)   ---> workspace_adopt_backup (Rust)
 *                                                    + a helix.json entry
 *
 * Why the key is allowed on this side of the boundary at all is argued in
 * `src-tauri/src/recovery.rs`: a key that lives only in one machine's keychain
 * dies with that machine, and every backup dies with it. Nothing here keeps the
 * key: it is fetched on a button press, held in the screen's state while the
 * panel is open, and dropped when the panel closes. It is never written to
 * SQLite, never to helix.json, and never to the log.
 *
 * The Rust side owns the format, the parser and the words in the saved file, so
 * there is one copy of each rather than two that drift.
 */
import { readRegistry, updateRegistry, type WorkspaceEntry } from "@/app/appSettings";
import {
  basenameOf,
  pickOpenFile,
  pickSavePath,
  writeTextFileAt,
} from "@/features/data/lib/fsBridge";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return (core.invoke as InvokeFn)<T>(cmd, args);
}

export type RevealedKey = { key: string; fileText: string };

/**
 * A file name an owner will still recognise in a year, with no spaces to get
 * mangled by whatever they mail it to themselves with.
 */
export function recoveryKeyFileName(workspaceName: string, on: Date): string {
  const slug =
    workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";
  const day = on.toISOString().slice(0, 10);
  return `helix-recovery-key-${slug}-${day}.txt`;
}

/** The name of the workspace that is open, for the saved file's first line. */
async function openWorkspaceName(): Promise<string> {
  try {
    const registry = await readRegistry();
    const open = registry.workspaces.find((w) => w.id === registry.lastOpened);
    return open?.name ?? "This workspace";
  } catch {
    return "This workspace";
  }
}

/**
 * Ask Rust for this workspace's recovery key. One round trip, on a button press,
 * never on render.
 */
export async function revealRecoveryKey(now: Date = new Date()): Promise<RevealedKey> {
  return invoke<RevealedKey>("recovery_key_reveal", {
    workspaceName: await openWorkspaceName(),
    writtenAt: now.toISOString().slice(0, 10),
  });
}

/**
 * Write the key to a file the owner picks. Returns the path, or null when they
 * cancelled the dialog.
 *
 * The dialog is what grants the write: Tauri's fs scope stops the frontend
 * writing anywhere outside the app data folder unless the owner has just
 * pointed at the place themselves.
 */
export async function saveRecoveryKeyFile(
  revealed: RevealedKey,
  now: Date = new Date(),
): Promise<string | null> {
  const defaultPath = recoveryKeyFileName(await openWorkspaceName(), now);
  const path = await pickSavePath({
    title: "Save your recovery key",
    defaultPath,
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (!path) return null;
  await writeTextFileAt(path, revealed.fileText);
  return path;
}

/** Pick the backup file to open. Returns null when the dialog was cancelled. */
export async function pickBackupFile(): Promise<string | null> {
  return pickOpenFile({
    title: "Choose a backup file",
    filters: [{ name: "Helix backup", extensions: ["db"] }],
  });
}

export type AdoptedWorkspace = { workspaceId: string; path: string };

/**
 * Open a backup from another machine as a new workspace here.
 *
 * Rust does the whole of the risky half - proving the key, copying the file,
 * writing the keychain entry, and undoing both if the proof fails - and returns
 * a workspace that is already openable. All that is left here is the helix.json
 * entry, which is the one thing Rust does not own.
 *
 * If the registry write fails the workspace folder is still there and still
 * readable; the owner is told to restart, and the entry is rebuilt on the next
 * launch by nothing at all, so this rethrows rather than pretending.
 */
export async function adoptBackup(
  sourcePath: string,
  recoveryKey: string,
  name: string,
): Promise<WorkspaceEntry> {
  const adopted = await invoke<AdoptedWorkspace>("workspace_adopt_backup", {
    sourcePath,
    recoveryKey,
  });

  const entry: WorkspaceEntry = {
    id: adopted.workspaceId,
    name: name.trim().length > 0 ? name.trim() : suggestedName(sourcePath),
    path: adopted.path,
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

/**
 * A name for a workspace that arrived as a file. The backup's own name is a
 * timestamp and a reason, which says nothing, so this offers the date instead
 * and lets the owner type over it.
 */
export function suggestedName(sourcePath: string): string {
  const base = basenameOf(sourcePath).replace(/\.db$/i, "");
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(base)?.[1];
  return date ? `Restored from ${date}` : "Restored workspace";
}
