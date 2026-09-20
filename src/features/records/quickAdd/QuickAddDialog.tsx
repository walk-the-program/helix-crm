/**
 * Quick add (PLAN.md item 8): Cmd/Ctrl+N from anywhere, one form, a type
 * switcher, and exactly the required fields the plan names —
 * contact = name, company = name, deal = title + stage, task = title,
 * note = body + a record.
 *
 * Enter saves and closes. Shift+Enter saves and clears, for the owner working
 * through a stack of business cards. Every save offers ten seconds of Undo,
 * which replays through `changeLog.undoBatch`.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { navigate } from "wouter/use-browser-location";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FormRow,
  DatePicker,
  Input,
  TimePicker,
  Kbd,
  Textarea,
} from "@/ui";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import * as dealsRepo from "@/db/repos/deals";
import * as tasksRepo from "@/db/repos/tasks";
import * as activitiesRepo from "@/db/repos/activities";
import type { DuplicateWarning } from "@/db/errors";
import { useVocabulary } from "@/app/vocabulary";
import { parseMoneyToCents } from "@/lib/money";
import {
  usePipeline,
  useStages,
  useDebounced,
} from "@/features/records/lib/hooks";
import {
  invalidateRecords,
  newBatchId,
  offerUndoCreate,
  reportError,
} from "@/features/records/lib/mutations";
import {
  ContactPicker,
  CompanyPicker,
  companyAfterContactPick,
  StagePicker,
} from "@/features/records/components/Pickers";
import { DuplicateNotice } from "@/features/records/components/NewContactDialog";
import { dueFromForm } from "@/features/records/lib/taskGroups";
import {
  closeQuickAdd,
  quickAddSnapshot,
  quickAddType,
  subscribeQuickAdd,
  type QuickAddType,
} from "@/features/records/quickAdd/store";

export function useQuickAddOpen(): boolean {
  return useSyncExternalStore(subscribeQuickAdd, quickAddSnapshot, quickAddSnapshot);
}

export function QuickAddDialog() {
  const open = useQuickAddOpen();
  const vocabulary = useVocabulary();
  const { data: pipeline } = usePipeline();
  const { data: stages } = useStages(pipeline?.id);

  const [type, setType] = useState<QuickAddType>("contact");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [stageId, setStageId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [body, setBody] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<DuplicateWarning[]>([]);
  const firstField = useRef<HTMLInputElement | null>(null);

  const debouncedEmail = useDebounced(email, 300);
  const debouncedPhone = useDebounced(phone, 300);

  const types = useMemo(
    () =>
      [
        { id: "contact" as const, label: "Contact" },
        { id: "company" as const, label: "Company" },
        { id: "deal" as const, label: vocabulary.one },
        { id: "task" as const, label: "Task" },
        { id: "note" as const, label: "Note" },
      ],
    [vocabulary.one],
  );

  useEffect(() => {
    if (open) {
      setType(quickAddType());
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (stageId === "" && stages && stages.length > 0) setStageId(stages[0].id);
  }, [stages, stageId]);

  // The duplicate warning, live while he types, for the contact type only.
  useEffect(() => {
    if (!open || type !== "contact") {
      setWarnings([]);
      return;
    }
    if (debouncedEmail.trim().length === 0 && debouncedPhone.trim().length === 0) {
      setWarnings([]);
      return;
    }
    let cancelled = false;
    void contactsRepo
      .findDuplicates({
        emails: debouncedEmail.trim() ? [debouncedEmail] : [],
        phones: debouncedPhone.trim() ? [debouncedPhone] : [],
      })
      .then((found) => {
        if (!cancelled) setWarnings(found);
      })
      .catch(() => {
        if (!cancelled) setWarnings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedEmail, debouncedPhone, open, type]);

  function clearForm() {
    setName("");
    setPhone("");
    setEmail("");
    setTitle("");
    setValue("");
    setDueOn("");
    setDueTime("");
    setBody("");
    setWarnings([]);
    setError(null);
    window.requestAnimationFrame(() => firstField.current?.focus());
  }

  async function save(keepOpen: boolean) {
    setError(null);
    const batchId = newBatchId();
    setSaving(true);
    try {
      if (type === "contact") {
        if (name.trim().length === 0) {
          setError("A contact needs a name.");
          return;
        }
        const [first, ...rest] = name.trim().split(/\s+/);
        const contact = await contactsRepo.create(
          {
            firstName: first ?? "",
            lastName: rest.join(" "),
            phones: phone.trim() ? [{ raw: phone, label: "mobile", isPrimary: true }] : [],
            emails: email.trim() ? [{ email, label: "work", isPrimary: true }] : [],
          },
          { batchId },
        );
        await finish(batchId, contactsRepo.contactName(contact), keepOpen);
        return;
      }

      if (type === "company") {
        if (name.trim().length === 0) {
          setError("A company needs a name.");
          return;
        }
        const company = await companiesRepo.create({ name, phone }, { batchId });
        await finish(batchId, company.name, keepOpen);
        return;
      }

      if (type === "deal") {
        if (title.trim().length === 0) {
          setError(`A ${vocabulary.lower} needs a title.`);
          return;
        }
        if (stageId === "") {
          setError("Pick a stage.");
          return;
        }
        const deal = await dealsRepo.create(
          {
            title: title.trim(),
            stageId,
            valueCents: parseMoneyToCents(value) ?? 0,
            contactId,
            companyId,
          },
          { batchId },
        );
        await finish(batchId, deal.title, keepOpen);
        return;
      }

      if (type === "task") {
        if (title.trim().length === 0) {
          setError("A task needs a title.");
          return;
        }
        const due = dueFromForm(dueOn, dueTime);
        const task = await tasksRepo.create(
          {
            title: title.trim(),
            dueOn: due.dueOn,
            dueAt: due.dueAt,
            contactId,
            companyId,
          },
          { batchId },
        );
        await finish(batchId, task.title, keepOpen);
        return;
      }

      if (body.trim().length === 0) {
        setError("A note needs something written in it.");
        return;
      }
      if (!contactId && !companyId) {
        setError("A note belongs to a record. Pick a contact or a company.");
        return;
      }
      await activitiesRepo.create(
        { kind: "note", body: body.trim(), contactId, companyId },
        { batchId },
      );
      await finish(batchId, "note", keepOpen);
    } catch (err) {
      reportError(err, "That did not save.");
    } finally {
      setSaving(false);
    }
  }

  async function finish(batchId: string, label: string, keepOpen: boolean) {
    await invalidateRecords();
    offerUndoCreate(batchId, label);
    if (keepOpen) clearForm();
    else {
      clearForm();
      closeQuickAdd();
    }
  }

  function onFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") return;
    // A textarea keeps Enter for new lines; Cmd/Ctrl+Enter saves there.
    const target = event.target as HTMLElement;
    const inTextarea = target.tagName === "TEXTAREA";
    if (inTextarea && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void save(event.shiftKey);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeQuickAdd();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Quick add</DialogTitle>
          <DialogDescription>
            <Kbd keys="enter" /> saves and closes. <Kbd keys="shift+enter" /> saves and keeps
            the form open for the next one.
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="What to add" className="flex flex-wrap gap-[var(--space-1)]">
          {types.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={type === option.id}
              onClick={() => {
                setType(option.id);
                setError(null);
              }}
              className={[
                "min-h-[var(--control-h)] px-[var(--space-3)]",
                "text-[length:var(--text-sm)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                type === option.id
                  ? "bg-[var(--color-selected)] font-medium text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>

        <form
          role="tabpanel"
          aria-label={`New ${types.find((option) => option.id === type)?.label ?? "record"}`}
          className="mt-[var(--space-4)]"
          onKeyDown={onFormKeyDown}
          onSubmit={(event) => event.preventDefault()}
        >
          <FormRow>
            {type === "contact" || type === "company" ? (
              <Field label="Name" error={error ?? undefined}>
                <Input
                  ref={firstField}
                  autoFocus
                  value={name}
                  placeholder={type === "contact" ? "Brent Hendrickson" : "Sorensen Landscaping"}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            ) : null}

            {type === "contact" ? (
              <div className="grid grid-cols-2 gap-[var(--space-4)]">
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={phone}
                    placeholder="(801) 555-0147"
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    placeholder="name@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {type === "company" ? (
              <Field label="Phone">
                <Input
                  type="tel"
                  value={phone}
                  placeholder="(801) 555-0147"
                  onChange={(event) => setPhone(event.target.value)}
                />
              </Field>
            ) : null}

            {type === "contact" ? (
              <DuplicateNotice
                warnings={warnings}
                onOpen={(entityId) => {
                  closeQuickAdd();
                  navigate(`/contacts/${entityId}`);
                }}
              />
            ) : null}

            {type === "deal" || type === "task" ? (
              <Field label="Title" error={error ?? undefined}>
                <Input
                  ref={firstField}
                  autoFocus
                  value={title}
                  placeholder={
                    type === "deal" ? "Spring cleanup and mulch" : "Call back about the quote"
                  }
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
            ) : null}

            {type === "deal" ? (
              <div className="grid grid-cols-2 gap-[var(--space-4)]">
                <div>
                  <label
                    htmlFor="quick-add-stage"
                    className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                  >
                    Stage
                  </label>
                  <StagePicker
                    id="quick-add-stage"
                    label="Stage"
                    pipelineId={pipeline?.id}
                    value={stageId}
                    onChange={setStageId}
                  />
                </div>
                <Field label="Value">
                  <Input
                    value={value}
                    inputMode="decimal"
                    className="money"
                    placeholder="1,500.00"
                    onChange={(event) => setValue(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {type === "task" ? (
              <div className="grid grid-cols-2 gap-[var(--space-4)]">
                <Field label="Due date">
                  <DatePicker
                    aria-label="Due date"
                    value={dueOn.length > 0 ? dueOn : null}
                    clearable
                    onChange={(next) => setDueOn(next ?? "")}
                  />
                </Field>
                <Field label="Time (optional)">
                  <TimePicker
                    aria-label="Time"
                    value={dueTime.length > 0 ? dueTime : null}
                    onChange={(next) => setDueTime(next ?? "")}
                  />
                </Field>
              </div>
            ) : null}

            {type === "note" ? (
              <Field label="Note" error={error ?? undefined}>
                <Textarea
                  autoFocus
                  rows={4}
                  value={body}
                  placeholder="What happened."
                  onChange={(event) => setBody(event.target.value)}
                />
              </Field>
            ) : null}

            {type === "deal" || type === "task" || type === "note" ? (
              <div className="grid grid-cols-2 gap-[var(--space-4)]">
                <div>
                  <label
                    htmlFor="quick-add-contact"
                    className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                  >
                    Contact
                  </label>
                  <ContactPicker
                    id="quick-add-contact"
                    label="Contact"
                    value={contactId}
                    onChange={(id, contact) => {
                      setContactId(id);
                      setCompanyId((current) => companyAfterContactPick(contact, current));
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="quick-add-company"
                    className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                  >
                    Company
                  </label>
                  <CompanyPicker
                    id="quick-add-company"
                    label="Company"
                    value={companyId}
                    onChange={setCompanyId}
                  />
                </div>
              </div>
            ) : null}
          </FormRow>
        </form>

        <DialogFooter>
          <Button variant="secondary" onClick={() => closeQuickAdd()}>
            Cancel
          </Button>
          <Button variant="secondary" loading={saving} onClick={() => void save(true)}>
            Save and add another
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save(false)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
