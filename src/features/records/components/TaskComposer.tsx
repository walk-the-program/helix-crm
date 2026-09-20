/**
 * Create a task. Used bare on the Tasks screen (no record link) and inside a
 * record's TaskRail (contactId/companyId/dealId pre-filled). Enter in the
 * title saves; the form clears and keeps focus in the title so several tasks
 * can be added back to back.
 */
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Plus } from "@/ui/icons";
import { Button, DatePicker, Field, Input, TimePicker } from "@/ui";
import * as tasksRepo from "@/db/repos/tasks";
import { dueFromForm } from "@/features/records/lib/taskGroups";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";

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
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

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
      await tasksRepo.create({
        title: trimmed,
        dueOn: due.dueOn,
        dueAt: due.dueAt,
        contactId: contactId ?? null,
        companyId: companyId ?? null,
        dealId: dealId ?? null,
      });
      await invalidateRecords();
      setTitle("");
      setDueOn("");
      setDueTime("");
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
              placeholder="Follow up with Brent about the estimate"
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
