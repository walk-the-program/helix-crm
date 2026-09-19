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
 */
import { undoBatch } from "@/db/changeLog";
import { qk, queryClient } from "@/app/queryClient";
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
