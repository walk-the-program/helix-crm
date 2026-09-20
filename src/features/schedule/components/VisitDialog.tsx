/**
 * "Schedule a visit" - one dialog, opened from anywhere, that puts a time and
 * a place on a task.
 *
 * The kit `Dialog` is mounted once, by this feature's overlays slot, and
 * listens for `OPEN_VISIT_EVENT` the exact way `SearchOverlay`
 * (src/features/today/search/overlay.tsx) listens for its own event: a
 * window event is the seam a caller with no React context - a palette
 * command, a day agenda, a row's menu item - can still reach.
 *
 * A visit IS a task (decision PX-6): the form here collects a title, who and
 * where it is for, and a required time and place, and hands all of it to
 * `saveVisit` (./lib/visit.ts), which is the one write path a visit and a
 * plain task both go through. Opening with a `taskId` loads that task and
 * turns the same form into an edit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FormRow,
  Input,
  Textarea,
  TimePicker,
  toast,
  type ComboboxItem,
} from "@/ui";
import * as tasksRepo from "@/db/repos/tasks";
import * as dealsRepo from "@/db/repos/deals";
import { PICKER_LIMIT } from "@/db/repos/_pickers";
import { useVocabulary } from "@/app/vocabulary";
import { useDeal } from "@/features/records/lib/hooks";
import {
  CompanyPicker,
  ContactPicker,
  companyAfterContactPick,
} from "@/features/records/components/Pickers";
import { reportError } from "@/features/records/lib/mutations";
import { dueLabel, timeFromDueAt } from "@/features/records/lib/taskGroups";
import { todayLocal } from "@/lib/dates";
import { durationLabel } from "@/features/schedule/lib/labels";
import {
  OPEN_VISIT_EVENT,
  type VisitPrefill,
} from "@/features/schedule/lib/visitDialog";
import {
  VISIT_DURATIONS,
  VISIT_TITLES,
  defaultPlaceFor,
  saveVisit,
} from "@/features/schedule/lib/visit";

const DEFAULT_DURATION = 60;

/** A chip: a secondary button that fills a field, showing which one won. */
function Chip(props: { label: string; chosen: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      aria-pressed={props.chosen}
      className={props.chosen ? "bg-[var(--color-selected)] text-[var(--color-text)]" : undefined}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}

/** The job/deal picker: the one record picker with no ready-made component,
 *  because there is no `deals.search` - `list`'s own `search` filter (title,
 *  company name, contact last name) is the deal repository's search, and it
 *  is read here, never edited. */
function useJobSearch() {
  return useCallback(async (query: string): Promise<ComboboxItem[]> => {
    const { rows } = await dealsRepo.list(
      { search: query.trim() || undefined, openOnly: true },
      { limit: PICKER_LIMIT },
    );
    return rows.map((deal) => {
      const person = [deal.contactFirstName, deal.contactLastName].filter(Boolean).join(" ");
      const detail = deal.companyName ?? (person.length > 0 ? person : undefined);
      return { id: deal.id, label: deal.title, ...(detail ? { detail } : {}) };
    });
  }, []);
}

function pickerLabelClassName(): string {
  return "block text-[length:var(--text-sm)] text-[var(--color-text-muted)]";
}

function VisitDialogBody(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: VisitPrefill;
}) {
  const { open, onOpenChange, prefill } = props;
  const vocabulary = useVocabulary();
  const jobSearch = useJobSearch();

  const editingTaskId = prefill.taskId ?? null;
  const editing = Boolean(editingTaskId);

  const [title, setTitle] = useState<string>(VISIT_TITLES[0]);
  const [date, setDate] = useState<string>(todayLocal());
  const [time, setTime] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<number>(DEFAULT_DURATION);
  const [place, setPlace] = useState<string>("");
  const [placeTouched, setPlaceTouched] = useState(false);
  const [note, setNote] = useState<string>("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const [timeError, setTimeError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: chosenDeal } = useDeal(dealId ?? "");
  const dealSelectedItem = useMemo<ComboboxItem | null>(
    () => (dealId && chosenDeal ? { id: chosenDeal.id, label: chosenDeal.title } : null),
    [dealId, chosenDeal],
  );

  // Reset (or reload, for an edit) every time the dialog opens, so a
  // cancelled draft never comes back and a second "New visit" does not
  // inherit the last one's fields.
  useEffect(() => {
    if (!open) return;
    setTitleError(undefined);
    setDateError(undefined);
    setTimeError(undefined);

    if (prefill.taskId) {
      setLoading(true);
      void tasksRepo
        .get(prefill.taskId)
        .then((task) => {
          if (!task) return;
          setTitle(task.title);
          setDate(task.dueOn ?? todayLocal());
          setTime(timeFromDueAt(task.dueAt));
          setDurationMinutes(task.durationMinutes ?? DEFAULT_DURATION);
          setPlace(task.place ?? "");
          setPlaceTouched(Boolean(task.place));
          setNote(task.notes ?? "");
          setContactId(task.contactId);
          setCompanyId(task.companyId);
          setDealId(task.dealId);
        })
        .catch((err: unknown) => reportError(err, "That visit could not be opened."))
        .finally(() => setLoading(false));
      return;
    }

    setTitle(VISIT_TITLES[0]);
    setDate(prefill.date ?? todayLocal());
    setTime(prefill.time ?? "");
    setDurationMinutes(DEFAULT_DURATION);
    setPlace("");
    setPlaceTouched(false);
    setNote("");
    setContactId(prefill.contactId ?? null);
    setCompanyId(prefill.companyId ?? null);
    setDealId(prefill.dealId ?? null);
    // Every field this depends on comes from `prefill`, which the host
    // replaces wholesale on every open rather than mutating in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  // Suggest a place the moment a contact or company is chosen, but only
  // while the owner has not typed one of their own - the same rule
  // `AddToCalendarButton`'s address lookup follows, applied before the save
  // rather than at export time.
  useEffect(() => {
    if (!open || placeTouched) return;
    if (!contactId && !companyId) return;
    let cancelled = false;
    void defaultPlaceFor({ contactId, companyId }).then((found) => {
      if (!cancelled && found) setPlace(found);
    });
    return () => {
      cancelled = true;
    };
  }, [open, contactId, companyId, placeTouched]);

  async function save() {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setTitleError("Give the visit a title.");
      return;
    }
    if (date.trim().length === 0) {
      setTitleError(undefined);
      setDateError("Pick a date.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setDateError(undefined);
      setTimeError("A visit needs a time. Leave it out and it is just a task.");
      return;
    }
    setTitleError(undefined);
    setDateError(undefined);
    setTimeError(undefined);
    setSaving(true);
    try {
      const saved = await saveVisit({
        taskId: editingTaskId,
        title: trimmedTitle,
        date,
        time,
        durationMinutes,
        place: place.trim().length > 0 ? place : null,
        note,
        contactId,
        companyId,
        dealId,
      });
      // A new visit already announced itself: `saveVisit` puts it through the
      // same create-undo toast every other task creation uses. An edit has
      // nothing to undo, so it gets the plain save toast here instead.
      if (editingTaskId) {
        toast.success(`Saved "${saved.title}" — ${dueLabel(saved)}`);
      }
      onOpenChange(false);
    } catch (err) {
      reportError(err, "That visit did not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="visit-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit visit" : "Schedule a visit"}</DialogTitle>
          <DialogDescription>
            A visit is a task with a time and a place. It shows up on Today,
            on the Tasks screen and in search exactly like any other task -
            and it can go on your own calendar as a .ics file once it is
            saved.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </p>
        ) : (
          <FormRow>
            <div>
              <Field label="Title" required error={titleError}>
                <Input
                  autoFocus
                  value={title}
                  placeholder="Visit"
                  invalid={Boolean(titleError)}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (titleError) setTitleError(undefined);
                  }}
                />
              </Field>
              <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
                {VISIT_TITLES.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    chosen={title === option}
                    onClick={() => setTitle(option)}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2">
              <Field label="Date" required error={dateError}>
                <DatePicker
                  value={date || null}
                  onChange={(next) => {
                    setDate(next ?? "");
                    if (dateError) setDateError(undefined);
                  }}
                />
              </Field>
              <Field label="Time" required error={timeError}>
                <TimePicker
                  value={time || null}
                  onChange={(next) => {
                    setTime(next ?? "");
                    if (timeError) setTimeError(undefined);
                  }}
                />
              </Field>
            </div>

            <div>
              <label className={pickerLabelClassName()}>Duration</label>
              <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-[var(--space-2)]">
                {VISIT_DURATIONS.map((minutes) => (
                  <Chip
                    key={minutes}
                    label={durationLabel(minutes)}
                    chosen={durationMinutes === minutes}
                    onClick={() => setDurationMinutes(minutes)}
                  />
                ))}
                <Input
                  type="number"
                  min={1}
                  max={24 * 60}
                  className="tabular w-[96px]"
                  aria-label="Custom duration in minutes"
                  value={String(durationMinutes)}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setDurationMinutes(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2">
              <div>
                <label htmlFor="visit-contact" className={pickerLabelClassName()}>
                  Contact
                </label>
                <ContactPicker
                  id="visit-contact"
                  label="Contact"
                  value={contactId}
                  onChange={(id, contact) => {
                    setContactId(id);
                    setCompanyId((current) => companyAfterContactPick(contact, current));
                  }}
                />
              </div>
              <div>
                <label htmlFor="visit-company" className={pickerLabelClassName()}>
                  Company
                </label>
                <CompanyPicker
                  id="visit-company"
                  label="Company"
                  value={companyId}
                  onChange={setCompanyId}
                />
              </div>
            </div>

            <div>
              <label htmlFor="visit-job" className={pickerLabelClassName()}>
                {vocabulary.one}
              </label>
              <Combobox
                id="visit-job"
                aria-label={vocabulary.one}
                value={dealId}
                selectedItem={dealSelectedItem}
                items={jobSearch}
                clearable
                placeholder={`Search ${vocabulary.lowerMany}`}
                emptyText={`No ${vocabulary.lower} matches`}
                onChange={setDealId}
              />
            </div>

            <Field label="Place" hint="Where the visit happens. Optional.">
              <Input
                value={place}
                placeholder="12 Main St"
                onChange={(event) => {
                  setPlace(event.target.value);
                  setPlaceTouched(true);
                }}
              />
            </Field>

            <Field label="Note" hint="Anything worth remembering. Optional.">
              <Textarea
                value={note}
                placeholder="Bring the long ladder"
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </FormRow>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            loadingLabel="Saving"
            disabled={loading}
            onClick={() => void save()}
          >
            {editing ? "Save changes" : "Schedule visit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted once, by this feature's overlays slot. Every caller - a palette
 * command, a row's menu, the Schedule's own empty state - reaches this
 * through `openVisitDialog()` (./lib/visitDialog.ts) rather than importing
 * the dialog directly, so there is one instance and one React tree.
 */
export function VisitDialogHost(): ReactElement {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<VisitPrefill>({});

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<VisitPrefill>).detail ?? {};
      setPrefill(detail);
      setOpen(true);
    };
    window.addEventListener(OPEN_VISIT_EVENT, handler);
    return () => window.removeEventListener(OPEN_VISIT_EVENT, handler);
  }, []);

  return <VisitDialogBody open={open} onOpenChange={setOpen} prefill={prefill} />;
}
