/**
 * Create a task. Used bare on the Tasks screen (no record link) and inside a
 * record's TaskRail (contactId/companyId/dealId pre-filled). Enter in the
 * title saves; the form clears and keeps focus in the title so several tasks
 * can be added back to back.
 *
 * Place and duration ride along beside the due date and time rather than
 * growing a second form: a task with no time is not somewhere the owner has
 * to be, so it has no length and no site either, and both fields only appear
 * once a time is actually picked (a task that only ever gets a date stays
 * exactly the two fields it always was).
 */
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Plus } from "@/ui/icons";
import { Button, DatePicker, Field, Input, TimePicker } from "@/ui";
import * as tasksRepo from "@/db/repos/tasks";
import { dueFromForm } from "@/features/records/lib/taskGroups";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";

/** A whole, positive number of minutes, or null for anything else the owner
 *  might type mid-edit (blank, a stray letter, zero). */
function parseDurationMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function TaskComposer(props: {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  onCreated?: () => void;
  autoFocus?: boolean;
  /**
   * DESIGN.md §9 allows one primary button per screen. The Tasks screen's
   * primary IS this composer; on a record page the primary belongs to the
   * thing he came to do, so the rail passes "secondary".
   */
  emphasis?: "primary" | "secondary";
}): ReactElement {
  const { contactId, companyId, dealId, onCreated, autoFocus, emphasis = "primary" } = props;

  const titleId = useId();
  const titleRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [place, setPlace] = useState("");
  const [duration, setDuration] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const hasTime = dueOn.trim().length > 0 && dueTime.trim().length > 0;

  async function save() {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError("Give the task a title.");
      titleRef.current?.focus();
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const due = dueFromForm(dueOn, dueTime);
      const hasDueAt = Boolean(due.dueAt);
      await tasksRepo.create({
        title: trimmed,
        dueOn: due.dueOn,
        dueAt: due.dueAt,
        contactId: contactId ?? null,
        companyId: companyId ?? null,
        dealId: dealId ?? null,
        place: hasDueAt && place.trim().length > 0 ? place.trim() : null,
        durationMinutes: hasDueAt ? parseDurationMinutes(duration) : null,
      });
      await invalidateRecords();
      setTitle("");
      setDueOn("");
      setDueTime("");
      setPlace("");
      setDuration("");
      titleRef.current?.focus();
      onCreated?.();
    } catch (err) {
      reportError(err, "That task did not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="flex flex-wrap items-end gap-[var(--space-3)]">
        <div className="min-w-[220px] flex-1">
          <Field label="Title" htmlFor={titleId} error={error}>
            <Input
              ref={titleRef}
              id={titleId}
              autoFocus={autoFocus}
              placeholder="What do you need to do?"
              value={title}
              invalid={Boolean(error)}
              onChange={(event) => {
                setTitle(event.target.value);
                if (error) setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </Field>
        </div>

        <div className="w-[168px] shrink-0">
          <Field label="Due date">
            <DatePicker
              value={dueOn || null}
              onChange={(next) => setDueOn(next ?? "")}
              clearable
              className="tabular"
            />
          </Field>
        </div>

        <div className="w-[140px] shrink-0">
          <Field label="Due time">
            <TimePicker
              value={dueTime || null}
              onChange={(next) => setDueTime(next ?? "")}
              disabled={dueOn.trim().length === 0}
            />
          </Field>
        </div>

        {/* A time is what turns a task into a visit: no time, no length and
            no site to speak of, so both fields wait for one (DESIGN.md, one
            wrapped row rather than a form). */}
        {hasTime ? (
          <>
            <div className="w-[200px] shrink-0">
              <Field label="Place">
                <Input
                  value={place}
                  placeholder="Where it happens"
                  onChange={(event) => setPlace(event.target.value)}
                />
              </Field>
            </div>

            <div className="w-[110px] shrink-0">
              <Field label="Duration">
                <Input
                  type="number"
                  min={1}
                  className="tabular"
                  placeholder="Minutes"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </Field>
            </div>
          </>
        ) : null}

        <Button
          variant={emphasis}
          iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
          loading={saving}
          onClick={() => void save()}
          className="shrink-0"
        >
          Add task
        </Button>
      </div>
    </div>
  );
}
