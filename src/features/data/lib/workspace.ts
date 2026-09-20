/**
 * Where the open workspace lives on disk, derived from the database itself.
 *
 *   raw.info().path = <workspacesDir>/<id>/helix.db
 *                     ^^^^^^^^^^^^^^^^^^^^^  the workspace directory
 *                                            + /backups     backup files
 *                                            + /attachments copied files
 *                                            + /documents   generated quote/invoice PDFs
 *
 * The frontend never invents these paths for a write: Rust chooses the
 * destination for `copy_in` and for `db_backup`; the invoices feature chooses
 * `documentsDir` the same way (`joinPath(dir, "documents")`), which is why it
 * is derived identically here rather than imported from that feature. They
 * are used for reading a directory listing, for the asset-protocol thumbnail
 * URL, for the one copy a restore performs over a path the user already
 * picked, and for the trash purge sweep to know which generated PDF files are
 * ours to remove (a quote or invoice can also be saved somewhere else
 * entirely through the save dialog; the purge sweep never touches a path
 * outside this folder, because that path was the owner's own choice).
 */
import { raw } from "@/db/client";
import { dirnameOf, joinPath } from "@/features/data/lib/fsBridge";
import { readRegistry } from "@/app/appSettings";

export type WorkspacePaths = {
  /** The workspace id from helix.json, when the open file matches an entry. */
  workspaceId: string | null;
  dbPath: string;
  dir: string;
  backupsDir: string;
  attachmentsDir: string;
  /** Where a saved quote or invoice PDF lands by default (docs/CONTRACTS.md has no
   *  entry for this folder yet; it is the invoices feature's own convention,
   *  reproduced here so the purge sweep can find its own files without
   *  importing across the ownership boundary). */
  documentsDir: string;
};

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm(a) === norm(b);
}

export async function workspacePaths(): Promise<WorkspacePaths> {
  const info = await raw.info();
  const dbPath = info.path;
  const dir = dirnameOf(dbPath);
  let workspaceId: string | null = null;
  try {
    const registry = await readRegistry();
    const entry = registry.workspaces.find((w) => samePath(w.path, dbPath));
    workspaceId = entry?.id ?? null;
  } catch {
    workspaceId = null;
  }
  return {
    workspaceId,
    dbPath,
    dir,
    backupsDir: joinPath(dir, "backups"),
    attachmentsDir: joinPath(dir, "attachments"),
    documentsDir: joinPath(dir, "documents"),
  };
}
