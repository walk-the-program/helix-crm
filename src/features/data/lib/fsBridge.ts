/**
 * The data feature's one door to the filesystem and the file dialogs.
 *
 *   screens ---> fsBridge ---> @tauri-apps/plugin-dialog  (pick a path)
 *                          \-> @tauri-apps/plugin-fs      (read / write it)
 *
 * Everything is a dynamic import so a Node unit test can import the modules
 * that sit above this one without a webview. Every call is wrapped: the
 * plugins reject with plain strings, and the screens want a typed error they
 * can show.
 *
 * Nothing here ever invents a write path for an attachment: that is the Rust
 * `copy_in` command's job (docs/CONTRACTS.md).
 */

export class FileAccessError extends Error {
  readonly path: string | null;
  readonly cause: unknown;
  constructor(message: string, path: string | null, cause?: unknown) {
    super(message);
    this.name = "FileAccessError";
    this.path = path;
    this.cause = cause;
  }
}

function reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

async function fs() {
  return import("@tauri-apps/plugin-fs");
}

async function dialog() {
  return import("@tauri-apps/plugin-dialog");
}

/* -------------------------------------------------------------------------- */
/* paths                                                                      */
/* -------------------------------------------------------------------------- */

/** Which separator this path uses. Windows paths keep their backslashes. */
function sep(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function joinPath(base: string, ...parts: string[]): string {
  const s = sep(base);
  const trimmed = base.replace(/[\\/]+$/, "");
  return [trimmed, ...parts.map((p) => p.replace(/^[\\/]+/, ""))].join(s);
}

export function dirnameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? path : path.slice(0, cut);
}

export function basenameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? path : path.slice(cut + 1);
}

export function extensionOf(path: string): string {
  const name = basenameOf(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* dialogs                                                                    */
/* -------------------------------------------------------------------------- */

export type FileFilter = { name: string; extensions: string[] };

/** Pick one existing file. null when the dialog was cancelled. */
export async function pickOpenFile(options: {
  title?: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  const { open } = await dialog();
  const picked = await open({
    multiple: false,
    directory: false,
    title: options.title,
    filters: options.filters,
  });
  if (picked === null || picked === undefined) return null;
  if (Array.isArray(picked)) return picked.length > 0 ? String(picked[0]) : null;
  return String(picked);
}

/**
 * Pick one existing folder. null when the dialog was cancelled.
 *
 * Used for the second backup folder. The path is handed to Rust, which does the
 * copying: the frontend's own filesystem scope stops at the app data folder,
 * and widening it to "anywhere the owner ever picked" is not a trade worth
 * making for a copy Rust can do on its own (docs/CONTRACTS.md, `backup_mirror`).
 */
export async function pickDirectory(options: { title?: string }): Promise<string | null> {
  const { open } = await dialog();
  const picked = await open({ multiple: false, directory: true, title: options.title });
  if (picked === null || picked === undefined) return null;
  if (Array.isArray(picked)) return picked.length > 0 ? String(picked[0]) : null;
  return String(picked);
}

/** Pick a destination path. null when the dialog was cancelled. */
export async function pickSavePath(options: {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  const { save } = await dialog();
  const picked = await save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  return picked === null || picked === undefined ? null : String(picked);
}

/** A native yes/no. Used before a restore overwrites the live database. */
export async function askConfirm(
  message: string,
  options: { title?: string; okLabel?: string } = {},
): Promise<boolean> {
  const { ask } = await dialog();
  return ask(message, {
    title: options.title,
    okLabel: options.okLabel,
    kind: "warning",
  });
}

/* -------------------------------------------------------------------------- */
/* reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Raw bytes, so the CSV parser can sniff the BOM and the encoding itself.
 *
 * The e2e harness only stubs the text read, so a failure falls back to
 * readTextFile and re-encodes as UTF-8. That costs one extra round trip on a
 * path that never happens in the real app.
 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const mod = await fs();
  try {
    return await mod.readFile(path);
  } catch (err) {
    try {
      const text = await mod.readTextFile(path);
      return new TextEncoder().encode(text);
    } catch {
      throw new FileAccessError(
        `Helix could not read ${basenameOf(path)}: ${reason(err)}`,
        path,
        err,
      );
    }
  }
}

export async function readTextFileAt(path: string): Promise<string> {
  const mod = await fs();
  try {
    return await mod.readTextFile(path);
  } catch (err) {
    throw new FileAccessError(
      `Helix could not read ${basenameOf(path)}: ${reason(err)}`,
      path,
      err,
    );
  }
}

export async function pathExists(path: string): Promise<boolean> {
  const mod = await fs();
  try {
    return await mod.exists(path);
  } catch {
    return false;
  }
}

export type DirFile = { name: string; isFile: boolean };

/** Directory listing. An unreadable or missing directory reads as empty. */
export async function readDirEntries(dir: string): Promise<DirFile[]> {
  const mod = await fs();
  try {
    const entries = await mod.readDir(dir);
    return entries.map((e) => ({ name: e.name, isFile: e.isFile }));
  } catch {
    return [];
  }
}

/** Size in bytes, or null when the file cannot be stat'ed. */
export async function fileSize(path: string): Promise<number | null> {
  const mod = await fs();
  try {
    const info = await mod.stat(path);
    return info.size;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* writing                                                                    */
/* -------------------------------------------------------------------------- */

export async function writeTextFileAt(path: string, text: string): Promise<void> {
  const mod = await fs();
  try {
    await mod.writeTextFile(path, text);
  } catch (err) {
    throw new FileAccessError(
      `Helix could not write ${basenameOf(path)}: ${reason(err)}`,
      path,
      err,
    );
  }
}

export async function writeBytesAt(path: string, bytes: Uint8Array): Promise<void> {
  const mod = await fs();
  try {
    await mod.writeFile(path, bytes);
  } catch (err) {
    throw new FileAccessError(
      `Helix could not write ${basenameOf(path)}: ${reason(err)}`,
      path,
      err,
    );
  }
}

export async function copyFileTo(from: string, to: string): Promise<void> {
  const mod = await fs();
  try {
    await mod.copyFile(from, to);
  } catch (err) {
    throw new FileAccessError(
      `Helix could not copy ${basenameOf(from)}: ${reason(err)}`,
      from,
      err,
    );
  }
}

export async function removePath(path: string): Promise<void> {
  const mod = await fs();
  try {
    await mod.remove(path);
  } catch (err) {
    throw new FileAccessError(
      `Helix could not delete ${basenameOf(path)}: ${reason(err)}`,
      path,
      err,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* opening things the OS owns                                                 */
/* -------------------------------------------------------------------------- */

/** Open a file inside the workspace with whatever the OS uses for it. */
export async function openWithOs(path: string): Promise<void> {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

/** The asset-protocol URL for a file the webview may display (thumbnails). */
export async function assetUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}
