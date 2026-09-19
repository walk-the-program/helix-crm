/**
 * One task. Used both on the full Tasks screen and, in `compact` form, inside
 * a record's TaskRail. All the state a row needs comes from `task` and the
 * already-resolved `chips`; every write goes through `@/db/repos/tasks`,
 * followed by `invalidateRecords()` and the caller's `onChanged`.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { Clock, Trash } from "@/ui/icons";
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@/ui";
import { cn } from "@/ui/cn";
import * as tasksRepo from "@/db/repos/tasks";
import type { Task } from "@/db/repos/tasks";
import { isOverdue } from "@/lib/dates";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { deleteWithUndo, invalidateRecords, reportError } from "@/features/records/lib/mutations";
import { RecordChip, type RecordChipTarget } from "@/features/records/components/RecordChip";

export function TaskRow(props: {
  task: Task;
  chips?: RecordChipTarget[];
  reference?: string;
  compact?: boolean;
  onChanged?: () => void;
}): ReactElement {
  const { task, chips, reference, compact, onChanged } = props;
  const [checkPending, setCheckPending] = useState(false);
  const [snoozePending, setSnoozePending] = useState(false);

  const done = task.doneAt !== null;
  const overdue = !done && isOverdue(task);

  async function toggleDone(next: boolean) {
    setCheckPending(true);
    try {
      if (next) {
        await tasksRepo.complete(task.id);
      } else {
        await tasksRepo.uncomplete(task.id);
      }
      await invalidateRecords();
      onChanged?.();
    } catch (err) {
      reportError(err, `"${task.title}" did not save.`);
    } finally {
      setCheckPending(false);
    }
  }

  async function snooze(when: "tomorrow" | "next-week") {
    setSnoozePending(true);
    try {
      await tasksRepo.snooze(task.id, when);
      await invalidateRecords();
      onChanged?.();
    } catch (err) {
      reportError(err, `"${task.title}" could not be snoozed.`);
    } finally {
      setSnoozePending(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteWithUndo({
        label: `"${task.title}"`,
        remove: (batchId) => tasksRepo.softDelete(task.id, { batchId }),
        restore: (batchId) => tasksRepo.restore(task.id, { batchId }),
        onUndone: onChanged,
      });
      onChanged?.();
    } catch (err) {
      reportError(err, `"${task.title}" could not be deleted.`);
    }
  }

  return (
    <div
      className={cn(
        "group/task-row flex w-full items-center gap-[var(--space-3)]",
        "min-h-[var(--row-h)]",
        compact ? "py-[var(--space-1)]" : "py-[var(--space-2)]",
      )}
    >
      <Checkbox
        checked={done}
        disabled={checkPending}
        onCheckedChange={(next) => void toggleDone(next)}
        ariaLabel={done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        className="shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[length:var(--text-base)] font-medium",
            done ? "text-[var(--color-text-muted)] line-through" : "text-[var(--color-text)]",
          )}
          title={task.title}
        >
          {task.title}
        </div>

        {!compact && chips && chips.length > 0 ? (
          <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-[var(--space-1)]">
            {chips.map((chip) => (
              <RecordChip key={`${chip.kind}-${chip.id}`} target={chip} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-[var(--space-2)]">
        {/* Overdue is carried by weight and full ink, not by a colour
            (DESIGN.md §5, §2 "'Needs you' is position and weight"). */}
        <span
          className={cn(
            "tabular whitespace-nowrap text-[length:var(--text-sm)]",
            overdue ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
          )}
        >
          {dueLabel(task, reference)}
        </span>
      </div>

      {/* Revealed on hover or focus. A snooze and a red trash glyph beside
          every row turns a task list into a column of icons; the row is about
          the promise, not about its controls (DESIGN.md §10). */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-[var(--space-1)]",
          "opacity-0 group-hover/task-row:opacity-100 group-focus-within/task-row:opacity-100",
          "transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
        )}
      >
        {!done ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label="Snooze"
                icon={<Clock size={16} weight="bold" aria-hidden="true" />}
                disabled={snoozePending}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void snooze("tomorrow")}>Tomorrow</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void snooze("next-week")}>Next week</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <IconButton
          label={`Delete "${task.title}"`}
          variant="danger"
          icon={<Trash size={16} weight="bold" aria-hidden="true" />}
          onClick={() => void handleDelete()}
        />
      </div>
    </div>
  );
}
