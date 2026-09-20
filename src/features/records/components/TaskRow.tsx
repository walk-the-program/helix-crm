/**
 * One task. Used both on the full Tasks screen and, in `compact` form, inside
 * a record's TaskRail. All the state a row needs comes from `task` and the
 * already-resolved `chips`; every write goes through `@/db/repos/tasks`,
 * followed by `invalidateRecords()` and the caller's `onChanged`.
 *
 * A task with a time is a visit, and a visit's length and place ride along
 * quietly under the title, in the same ink the record chips already use -
 * the due label above stays the one thing in full weight, because "when" is
 * still the row's first job. "Edit time and place" opens the same dialog a
 * brand-new visit does (`openVisitDialog`), so there is exactly one form for
 * putting a time and a place on a task, not a second one grown here.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { Clock, Trash } from "@/ui/icons";
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@/ui";
import { cn } from "@/ui/cn";
import * as tasksRepo from "@/db/repos/tasks";
import type { Task } from "@/db/repos/tasks";
import { isOverdue } from "@/lib/dates";
import { useFormats } from "@/app/formats";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { deleteWithUndo, invalidateRecords, reportError } from "@/features/records/lib/mutations";
import { RecordChip, type RecordChipTarget } from "@/features/records/components/RecordChip";
import {
  AddToCalendarButton,
  calendarDescription,
} from "@/features/records/components/AddToCalendarButton";
import { durationLabel } from "@/features/schedule/lib/labels";
import { openVisitDialog } from "@/features/schedule/lib/visitDialog";
import { taskEndAt } from "@/features/schedule/lib/visit";

export function TaskRow(props: {
  task: Task;
  chips?: RecordChipTarget[];
  reference?: string;
  compact?: boolean;
  onChanged?: () => void;
}): ReactElement {
  const { task, chips, reference, compact, onChanged } = props;
  const formats = useFormats();
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
      data-testid="task-row"
      data-task-title={task.title}
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

        {/* A plain task has neither of these, so nothing prints here at all -
            no "null", no dangling " · " (DESIGN.md: must keep working for a
            task with none of the new fields set). */}
        {!compact && (task.durationMinutes || task.place) ? (
          <div className="mt-[var(--space-1)] truncate text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
            {[task.durationMinutes ? durationLabel(task.durationMinutes) : null, task.place]
              .filter((part): part is string => Boolean(part))
              .join(" · ")}
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
          {dueLabel(task, reference, formats.locale)}
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
        {/* Only a task with a date can be a calendar event, and a finished one
            has nothing to put in a calendar. */}
        {!done && task.dueOn ? (
          <AddToCalendarButton
            subject={{
              kind: "task",
              id: task.id,
              summary: task.title,
              dateOnly: task.dueAt ? null : task.dueOn,
              startAt: task.dueAt,
              endAt: taskEndAt(task),
              description: calendarDescription({
                chips,
                contactId: task.contactId,
                companyId: task.companyId,
                dealId: task.dealId,
              }),
              location: task.place,
              contactId: task.contactId,
              companyId: task.companyId,
            }}
          />
        ) : null}

        {!done ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label="More actions"
                icon={<Clock size={16} weight="bold" aria-hidden="true" />}
                disabled={snoozePending}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void snooze("tomorrow")}>Tomorrow</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void snooze("next-week")}>Next week</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openVisitDialog({ taskId: task.id })}>
                Edit time and place
              </DropdownMenuItem>
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
