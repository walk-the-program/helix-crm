/**
 * Getting a CSV into the wizard: the file dialog, and drag-and-drop with the
 * dialog as the fallback.
 *
 *   dialog          -> a path -> readFileBytes -> sniff
 *   drag-drop (app) -> a path from Tauri's drag-drop event -> the same
 *   drag-drop (web) -> a File object with no readable path -> file.text()
 *   anything else   -> open the dialog and say why (docs/PLAN.md item 9:
 *                      "drops go through the file dialog on platforms where
 *                       the dropped path is outside the app's file scope")
 */
import {
  basenameOf,
  pickOpenFile,
  readFileBytes,
  FileAccessError,
} from "@/features/data/lib/fsBridge";
import { sniffCsv, type CsvSniff } from "@/lib/csv";

export type LoadedCsv = CsvSniff & {
  /** null when the bytes came from a browser File with no real path. */
  path: string | null;
  name: string;
  text: string;
  bytes: number;
};

export const CSV_FILTERS = [
  { name: "Spreadsheet", extensions: ["csv", "tsv", "txt"] },
];

function loaded(name: string, path: string | null, bytes: Uint8Array): LoadedCsv {
  const sniffed = sniffCsv(bytes);
  return { ...sniffed, path, name, bytes: bytes.length };
}

/** Open the file dialog. null when the owner cancelled. */
export async function pickCsvFile(): Promise<LoadedCsv | null> {
  const path = await pickOpenFile({
    title: "Choose a CSV to import",
    filters: CSV_FILTERS,
  });
  if (path === null) return null;
  return loadCsvFromPath(path);
}

export async function loadCsvFromPath(path: string): Promise<LoadedCsv> {
  const bytes = await readFileBytes(path);
  return loaded(basenameOf(path), path, bytes);
}

/** A browser File (the e2e build, and a drop the OS hands over as data). */
export async function loadCsvFromFile(file: File): Promise<LoadedCsv> {
  const buffer = await file.arrayBuffer();
  return loaded(file.name, null, new Uint8Array(buffer));
}

/**
 * A dropped path Helix cannot read is not an error the owner should have to
 * decode: the dialog opens instead, which also grants the app read access to
 * whatever they choose.
 */
export async function loadDroppedPath(path: string): Promise<LoadedCsv | null> {
  try {
    return await loadCsvFromPath(path);
  } catch (err) {
    if (err instanceof FileAccessError) return pickCsvFile();
    throw err;
  }
}

/**
 * Tauri's own drag-drop event, which carries real paths. Returns a function
 * that stops listening; a plain browser gets a no-op.
 */
export function subscribeFileDrop(
  onPaths: (paths: string[]) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths ?? [];
        if (paths.length > 0) onPaths(paths);
      });
      if (cancelled) stop();
      else unlisten = stop;
    } catch {
      // No Tauri runtime (the e2e build, or a browser): HTML5 drop only.
    }
  })();

  return () => {
    cancelled = true;
    if (unlisten) unlisten();
  };
}
