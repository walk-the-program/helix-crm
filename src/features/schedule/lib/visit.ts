/**
 * The impure half of "schedule a visit": turning a filled-in form into the
 * one write `tasks.ts` already knows how to make, and finding a place to
 * suggest before the owner has typed one.
 *
 * Decision PX-6: a visit is a task with a time on it. There is no separate
 * "appointment" row and no second write path — `saveVisit` calls the exact
 * `tasksRepo.create` / `tasksRepo.update` every other task goes through, so a
 * visit shows up on the Tasks screen, in search, in the Trash and in undo
 * without any of those knowing a "visit" is a thing. `composeVisit` is kept
 * pure and exported on its own so the shape of that write can be tested
 * without a database.
 */
import * as tasksRepo from "@/db/repos/tasks";
import type { Task } from "@/db/repos/tasks";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import {
  formatAddressOneLine,
  isEmptyAddress,
  parseAddress,
} from "@/features/records/lib/address";
import { dueFromForm, dueLabel } from "@/features/records/lib/taskGroups";
import {
  invalidateRecords,
  newBatchId,
  offerUndoCreate,
} from "@/features/records/lib/mutations";
import { parseIso, toIso } from "@/lib/dates";

/** The title chips the dialog offers. The field also takes free text. */
export const VISIT_TITLES = ["Visit", "Estimate", "Site visit"] as const;

/** The duration chips the dialog offers, in minutes. The field also takes a
 *  custom number. */
export const VISIT_DURATIONS = [30, 60, 90, 120] as const;

/** What the visit dialog collects. Every field is a plain string or number so
 *  the form has no state `composeVisit` cannot see. */
export type VisitForm = {
  /** Set to edit that task instead of creating one. */
  taskId?: string | null;
  title: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM", local. A visit's whole point is that this is never empty. */
  time: string;
  durationMinutes: number | null;
  place: string | null;
  /** Free text with nowhere else to live; see the note on `composeVisit`. */
  note: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
};

export type VisitWrite = {
  title: string;
  dueOn: string | null;
  dueAt: string | null;
  place: string | null;
  durationMinutes: number | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
};

/**
 * A task has one text field. The dialog has two - the title chips and a note
 * that says more than three words. Rather than grow the schema for a line
 * that is genuinely optional, the note rides in the title's own tail, exactly
 * the way a person would write it on a paper ticket: "Estimate — bring the
 * long ladder."
 */
function titleWithNote(title: string, note: string): string {
  const t = title.trim();
  const n = note.trim();
  return n.length > 0 ? `${t} — ${n}` : t;
}

/**
 * The pure half of a save: what the form says, as the write `tasks.ts`
 * expects it. A duration with no time is a contradiction a visit cannot have
 * - there is nothing to be long - so it is dropped rather than stored, which
 * also keeps a plain task (no time picked) from picking one up by accident.
 */
export function composeVisit(form: VisitForm): VisitWrite {
  const due = dueFromForm(form.date, form.time);
  const place = form.place?.trim();
  return {
    title: titleWithNote(form.title, form.note),
    dueOn: due.dueOn,
    dueAt: due.dueAt,
    place: place && place.length > 0 ? place : null,
    durationMinutes: due.dueAt ? (form.durationMinutes ?? null) : null,
    contactId: form.contactId,
    companyId: form.companyId,
    dealId: form.dealId,
  };
}

/**
 * The sentence the save toast reads back: the visit's name and when it is
 * now on the calendar for, in the same words the Tasks screen already uses.
 */
function visitLabel(task: Task): string {
  return `"${task.title}" — ${dueLabel(task)}`;
}

/**
 * The contact's address as one line, else the company's, else nothing at
 * all. A read that fails is not a reason to block a save the owner is trying
 * to make right now - an address is a nicety, exactly as `resolveLocation`
 * (AddToCalendarButton.tsx) treats it.
 */
export async function defaultPlaceFor(link: {
  contactId?: string | null;
  companyId?: string | null;
}): Promise<string | null> {
  try {
    if (link.contactId) {
      const contact = await contactsRepo.get(link.contactId);
      const address = parseAddress(contact?.addressJson);
      if (!isEmptyAddress(address)) return formatAddressOneLine(address);
    }
    if (link.companyId) {
      const company = await companiesRepo.get(link.companyId);
      const address = parseAddress(company?.addressJson);
      if (!isEmptyAddress(address)) return formatAddressOneLine(address);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Save the form: create a new visit, or update the one the dialog opened to
 * edit. A created visit is undone exactly the way any other created task is -
 * the same `newBatchId`/`offerUndoCreate` pair `NewDealDialog` and
 * `NewContactDialog` already use - so there is exactly one undo path in the
 * product, not a second one grown here.
 */
export async function saveVisit(form: VisitForm): Promise<Task> {
  const input = composeVisit(form);

  if (form.taskId) {
    const updated = await tasksRepo.update(form.taskId, input);
    await invalidateRecords();
    return updated;
  }

  const batchId = newBatchId();
  const created = await tasksRepo.create({ ...input, source: "user" }, { batchId });
  await invalidateRecords();
  offerUndoCreate(batchId, visitLabel(created));
  return created;
}

/**
 * A task's calendar-export end instant: its due time plus its length, when
 * both exist. Mirrors `endOfItem` (schedule/lib/calendar.ts), which does the
 * same arithmetic for a `ScheduleItem`; this is the `Task`-shaped twin of it
 * for `TaskRow`'s own "Add to calendar" button, so a visit edited from the
 * Tasks screen exports the same length it shows.
 */
export function taskEndAt(task: {
  dueAt: string | null;
  durationMinutes: number | null;
}): string | null {
  if (!task.dueAt || !task.durationMinutes) return null;
  const start = parseIso(task.dueAt);
  if (!start) return null;
  return toIso(new Date(start.getTime() + task.durationMinutes * 60 * 1000));
}
