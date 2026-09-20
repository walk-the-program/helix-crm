/**
 * The application undo stack.
 *
 * Before this module, undo was a ten-second toast: if it timed out, or the
 * owner dismissed it, the change was gone — and a pipeline drag or an inline
 * field edit never offered one at all (design/apple-hig-review.md, finding 3).
 * `undo-and-redo.md` asks for Cmd+Z to reverse the last thing the owner did,
 * repeatedly, and for the Edit menu to say what it will reverse.
 *
 * How it works. `change_log` already records every repository write, grouped by
 * `batch_id`, and `changeLog.undoBatch` already knows how to reverse one batch.
 * All this adds is the stack: a write that logs a batch pushes the batch id and
 * a past-tense phrase for it ("moved Retaining wall to Quoted"), and Cmd+Z pops
 * the newest one, reverses it and says so. Redo re-applies the same batch
 * forward through `changeLog.redoBatch`.
 *
 * Three deliberate limits:
 *
 *  - **In memory only.** The stack is emptied on every `db_open` (launch,
 *    restore, workspace switch), because a batch id belongs to the file it was
 *    written in. Reopening the app is a clean slate; the Trash screen is still
 *    the thirty-day answer for a delete.
 *  - **Text fields keep their own undo.** The generic shortcut binder already
 *    suppresses every shortcut while the owner is typing, so Cmd+Z inside an
 *    input falls through to the web view's native undo. The macOS menu takes a
 *    second route to the same place — see `src/app/menu.ts`.
 *  - **A merge is not on the stack.** Reversing one re-points rows across
 *    several tables and only `merge.reverse(mergeId)` knows how; neither
 *    `undoBatch` nor `redoBatch` replays a merge from the log.
 *
 * This file is shell-level, not a feature: it imports the database layer and
 * the component kit and nothing from `src/features`.
 */
import { redoBatch, undoBatch } from "@/db/changeLog";
import { queryClient } from "@/app/queryClient";
import { toast } from "@/ui/toast";
import type { FeatureCommand } from "@/app/feature";

/** One reversible thing the owner did. */
export type UndoEntry = {
  /** The `change_log.batch_id` every row of that write shares. */
  batchId: string;
  /**
   * A past-tense phrase naming what happened, with no leading capital and no
   * full stop, so it reads inside a sentence: "moved Retaining wall to Quoted"
   * becomes the toast "Undone: moved Retaining wall to Quoted" and the Edit
   * menu's "Undo moved Retaining wall to Quoted" would be wrong — the menu
   * keeps the plain "Undo" for now, because a Tauri menu item's text is fixed
   * at build time.
   */
  label: string;
};

/**
 * How far back Cmd+Z goes. Twenty is what the review asked for: enough to walk
 * out of a bad five minutes, short enough that the stack cannot quietly hold a
 * batch id from an hour ago that the owner has forgotten the context for.
 */
export const UNDO_LIMIT = 20;

let undoStack: UndoEntry[] = [];
let redoStack: UndoEntry[] = [];

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to stack changes, for anything that wants to grey out a control. */
export function subscribeUndo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Record a write that can be reversed.
 *
 * Doing something new abandons the redo branch, which is what every editor
 * does and what the owner expects: there is one history, not a tree.
 */
export function pushUndo(entry: UndoEntry): void {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) undoStack = undoStack.slice(-UNDO_LIMIT);
  redoStack = [];
  emit();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

/** What Cmd+Z would reverse, for a label or a tooltip. */
export function peekUndo(): UndoEntry | null {
  return undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
}

/** What Shift+Cmd+Z would re-apply. */
export function peekRedo(): UndoEntry | null {
  return redoStack.length > 0 ? redoStack[redoStack.length - 1] : null;
}

/**
 * Emptied after every `db_open`. A batch id means nothing in another file, and
 * replaying one against the wrong workspace would be the worst kind of bug.
 */
export function clearUndoHistory(): void {
  undoStack = [];
  redoStack = [];
  emit();
}

/**
 * Everything on screen is a TanStack Query over local SQLite, and an undo can
 * touch any table, so it invalidates the whole cache rather than guessing which
 * keys a batch reached. These are local reads; the refetch costs nothing.
 */
async function refresh(): Promise<void> {
  await queryClient.invalidateQueries();
}

function failed(err: unknown, fallback: string): void {
  const message =
    err instanceof Error && err.message.trim().length > 0 ? err.message : fallback;
  toast.error(message);
}

/** Reverse the newest reversible write. */
export async function undo(): Promise<void> {
  const entry = undoStack[undoStack.length - 1];
  if (!entry) {
    toast.info("Nothing to undo");
    return;
  }

  // Pop first: a failed undo must not leave the same batch on top for Cmd+Z to
  // try again forever. It goes back on only if the reversal throws.
  undoStack.pop();
  emit();

  try {
    await undoBatch(entry.batchId);
    redoStack.push(entry);
    emit();
    await refresh();
    toast.success(`Undone: ${entry.label}`);
  } catch (err) {
    undoStack.push(entry);
    emit();
    failed(err, `Could not undo ${entry.label}.`);
  }
}

/** Re-apply the write the last undo reversed. */
export async function redo(): Promise<void> {
  const entry = redoStack[redoStack.length - 1];
  if (!entry) {
    toast.info("Nothing to redo");
    return;
  }

  redoStack.pop();
  emit();

  try {
    await redoBatch(entry.batchId);
    undoStack.push(entry);
    emit();
    await refresh();
    toast.success(`Redone: ${entry.label}`);
  } catch (err) {
    redoStack.push(entry);
    emit();
    failed(err, `Could not redo ${entry.label}.`);
  }
}

/**
 * Undo and redo as registry commands, so the palette lists them and the shell's
 * one keydown handler binds them like every other shortcut — including its rule
 * that typing suppresses a shortcut, which is exactly what leaves Cmd+Z to the
 * text field the owner is typing in.
 *
 * These are app-level rather than a feature's: `src/app/registry.ts` prepends
 * them to `allCommands()`.
 */
export const undoCommands: FeatureCommand[] = [
  {
    id: "undo",
    label: "Undo last change",
    shortcut: "mod+z",
    group: "Edit",
    keywords: ["revert", "back", "mistake", "oops"],
    run: () => undo(),
  },
  {
    id: "redo",
    label: "Redo last change",
    shortcut: "mod+shift+z",
    group: "Edit",
    keywords: ["again", "forward", "reapply"],
    run: () => redo(),
  },
];

/** Tests reset the module between cases. */
export function __resetUndoForTests(): void {
  undoStack = [];
  redoStack = [];
  listeners.clear();
}
