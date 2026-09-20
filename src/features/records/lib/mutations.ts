/**
 * Writes, invalidation and undo for every records screen.
 *
 * Two rules from the foundations notes are load-bearing here:
 *
 *  - The write lock is NOT reentrant. Nothing in this file calls a repository
 *    write from inside another repository write; every helper awaits one call
 *    at a time.
 *  - Every list on screen is a TanStack Query, so a write is only finished
 *    once the keys in `src/app/queryClient.ts` have been invalidated.
 *
 * Undo. A create is undone through `changeLog.undoBatch`, which deletes the
 * rows the batch inserted. A soft delete is undone by restoring the row: the
 * change_log entry a soft delete writes carries no `before`, so `undoBatch`
 * has nothing to re-insert (recorded in STATUS under "Contract changes
 * needed"). Restore is the exact inverse either way, and it is one statement
 * instead of a replay.
 *
 * Since the HIG pass every helper here also puts its batch on the application
 * undo stack (`src/app/undo.ts`), so Cmd+Z still reverses the change after the
 * toast has gone. The toast stays as the discoverable surface — it is how an
 * owner learns undo exists — and the stack is what makes it durable
 * (design/apple-hig-review.md, finding 3).
 */
import { undoBatch } from "@/db/changeLog";
import { qk, queryClient } from "@/app/queryClient";
import { pushUndo } from "@/app/undo";
import { toast } from "@/ui";
import { newId } from "@/lib/ids";

export const UNDO_MS = 10_000;

export function newBatchId(): string {
  return newId();
}

/** Every key a records write can invalidate. Cheap: these are local queries. */
export async function invalidateRecords(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["contacts"] }),
    queryClient.invalidateQueries({ queryKey: ["contact"] }),
    queryClient.invalidateQueries({ queryKey: ["companies"] }),
    queryClient.invalidateQueries({ queryKey: ["company"] }),
    queryClient.invalidateQueries({ queryKey: ["deals"] }),
    queryClient.invalidateQueries({ queryKey: ["deal"] }),
    queryClient.invalidateQueries({ queryKey: ["board"] }),
    queryClient.invalidateQueries({ queryKey: ["stages"] }),
    queryClient.invalidateQueries({ queryKey: ["activities"] }),
    queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    queryClient.invalidateQueries({ queryKey: ["tags"] }),
    queryClient.invalidateQueries({ queryKey: ["trash"] }),
    queryClient.invalidateQueries({ queryKey: qk.today() }),
    // The Schedule derives its week from tasks, deals, reminders and invoices
    // on every read (no denormalised table), so any records write can change
    // what it shows. One key covers every range currently mounted.
    queryClient.invalidateQueries({ queryKey: ["schedule"] }),
    // Search's own results and its "recent" list are both keyed off
    // qk.search(...) (src/features/today/search/SearchDialog.tsx), so a
    // record restored from the Trash, or any other write, reappears in
    // search immediately instead of waiting out its 10s staleTime
    // (F-W1-3).
    queryClient.invalidateQueries({ queryKey: ["search"] }),
  ]);
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  return fallback;
}

export function reportError(err: unknown, fallback: string): void {
  toast.error(errorMessage(err, fallback));
}

/**
 * Soft-delete something and offer ten seconds of Undo.
 *
 * `remove` and `restore` are the entity's own repository functions, so the
 * right change_log entries are written either way.
 */
export async function deleteWithUndo(options: {
  label: string;
  remove: (batchId: string) => Promise<void>;
  restore: (batchId: string) => Promise<void>;
  onUndone?: () => void;
}): Promise<void> {
  const batchId = newBatchId();
  await options.remove(batchId);
  await invalidateRecords();
  pushUndo({ batchId, label: `deleted ${options.label}` });

  toast.undo(
    `Deleted ${options.label}`,
    () => {
      void (async () => {
        try {
          await options.restore(newBatchId());
          await invalidateRecords();
          options.onUndone?.();
          toast.success(`Restored ${options.label}`);
        } catch (err) {
          reportError(err, `Could not restore ${options.label}.`);
        }
      })();
    },
    { duration: UNDO_MS },
  );
}

/**
 * Offer Undo on something just created. `undoBatch` deletes exactly the rows
 * the batch inserted, which is what quick add needs.
 */
export function offerUndoCreate(batchId: string, label: string): void {
  pushUndo({ batchId, label: `added ${label}` });
  toast.undo(
    `Added ${label}`,
    () => {
      void (async () => {
        try {
          await undoBatch(batchId);
          await invalidateRecords();
          toast.success(`Removed ${label}`);
        } catch (err) {
          reportError(err, `Could not undo ${label}.`);
        }
      })();
    },
    { duration: UNDO_MS },
  );
}

/**
 * A write that is reversible but has no toast: an inline field edit, a pipeline
 * move — the things an owner does dozens of times an hour, where a toast every
 * time would be noise but losing the change would be a defeat.
 *
 * `write` gets the batch id and must pass it through to the repository, which
 * is the whole point: without it the change_log rows carry no `batch_id` and
 * there is nothing for `undoBatch` to find. `label` is the past-tense phrase
 * the undo toast will read back — "moved Retaining wall to Quoted" — so it is
 * lower case and has no full stop.
 */
export async function writeWithUndo(options: {
  label: string;
  write: (batchId: string) => Promise<void>;
}): Promise<void> {
  const batchId = newBatchId();
  await options.write(batchId);
  pushUndo({ batchId, label: options.label });
}
