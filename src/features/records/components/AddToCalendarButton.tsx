/**
 * "Add to calendar" on a task row and on a meeting in the timeline.
 *
 * Helix does not own the owner's calendar and is not going to. It writes a
 * standard .ics file, asks where to put it, and hands it to the OS; Calendar,
 * Outlook or whatever he actually uses imports it and owns it from there. No
 * account, no permission prompt, no sync, and nothing to break when he changes
 * mail providers.
 *
 * `src/lib/ics.ts` builds the text and is pure. This is the impure half: the
 * save dialog, the write and the opener, in the one place that needs them. It
 * reaches the plugins through dynamic imports so a Node unit test can import
 * anything above it without a webview, which is the pattern
 * `src/features/data/lib/fsBridge.ts` established.
 */
import { useState } from "react";
import { CalendarBlank } from "@/ui/icons";
import { IconButton, Tooltip, toast } from "@/ui";
import { buildIcs, icsFileName, icsUid, type IcsEvent } from "@/lib/ics";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import {
  formatAddressOneLine,
  isEmptyAddress,
  parseAddress,
} from "@/features/records/lib/address";
import type { RecordChipTarget } from "@/features/records/components/RecordChip";

export type CalendarSubject = {
  /** "task" or "meeting": part of the UID, so re-importing replaces. */
  kind: string;
  /** The row id the UID is built from. */
  id: string;
  summary: string;
  /** A local calendar day for an all-day entry. */
  dateOnly?: string | null;
  /** An instant, when the record has a time on it. */
  startAt?: string | null;
  /**
   * When it ends. Only meaningful beside `startAt`; left out, a timed event
   * runs for the hour `src/lib/ics.ts` defaults to. The Schedule passes this
   * from a visit's duration, which is the whole reason a duration is stored.
   */
  endAt?: string | null;
  description?: string | null;
  /** Given explicitly, or resolved from the record below. */
  location?: string | null;
  /** Whose address becomes the event's LOCATION, when there is one. */
  contactId?: string | null;
  companyId?: string | null;
};

const PATH_FOR = {
  contact: "/contacts",
  company: "/companies",
  deal: "/deals",
} as const;

/**
 * What goes in DESCRIPTION: which record this came from, and where to find it
 * again in Helix.
 *
 * A calendar entry that says only "Send revised estimate" is a mystery three
 * weeks later, so the record's name and its path travel with it. The chips a
 * row already resolved are preferred, because they carry the customer's name;
 * with no chips the ids still give a path worth following.
 */
export function calendarDescription(input: {
  chips?: readonly RecordChipTarget[];
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}): string | null {
  const lines: string[] = [];

  if (input.chips && input.chips.length > 0) {
    for (const chip of input.chips) {
      lines.push(`${chip.label}: Helix ${PATH_FOR[chip.kind]}/${chip.id}`);
    }
  } else {
    if (input.contactId) lines.push(`Helix ${PATH_FOR.contact}/${input.contactId}`);
    if (input.companyId) lines.push(`Helix ${PATH_FOR.company}/${input.companyId}`);
    if (input.dealId) lines.push(`Helix ${PATH_FOR.deal}/${input.dealId}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * The address to put in LOCATION: the contact's, or the company's when the
 * event is about a company. Absent or unreadable, the property is left off
 * rather than emitted empty.
 */
async function resolveLocation(subject: CalendarSubject): Promise<string | null> {
  if (subject.location) return subject.location;
  try {
    if (subject.contactId) {
      const contact = await contactsRepo.get(subject.contactId);
      const address = parseAddress(contact?.addressJson);
      if (!isEmptyAddress(address)) return formatAddressOneLine(address);
    }
    if (subject.companyId) {
      const company = await companiesRepo.get(subject.companyId);
      const address = parseAddress(company?.addressJson);
      if (!isEmptyAddress(address)) return formatAddressOneLine(address);
    }
  } catch {
    // An address is a nicety. A read that fails must not stop the download.
    return null;
  }
  return null;
}

/**
 * Save the file, then open it. Exported so the e2e harness can be pointed at
 * the same path the button takes.
 */
export async function saveAndOpenIcs(subject: CalendarSubject): Promise<string | null> {
  const event: IcsEvent = {
    uid: icsUid(subject.kind, subject.id),
    summary: subject.summary,
    dateOnly: subject.dateOnly ?? null,
    startAt: subject.startAt ?? null,
    endAt: subject.endAt ?? null,
    description: subject.description ?? null,
    location: await resolveLocation(subject),
  };

  const dialog = await import("@tauri-apps/plugin-dialog");
  const path = await dialog.save({
    title: "Save this to your calendar",
    defaultPath: icsFileName(subject.summary),
    filters: [{ name: "Calendar event", extensions: ["ics"] }],
  });
  if (path === null || path === undefined) return null;

  const target = String(path);
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.writeTextFile(target, buildIcs(event));

  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openPath(target);
  return target;
}

export function AddToCalendarButton(props: {
  subject: CalendarSubject;
  size?: "sm";
}) {
  const { subject, size } = props;
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const saved = await saveAndOpenIcs(subject);
      if (saved) toast.success(`Saved "${subject.summary}" to your calendar`);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.trim().length > 0
          ? `That calendar file did not save. ${err.message}`
          : "That calendar file did not save.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tooltip content="Add to calendar">
      <IconButton
        label={`Add "${subject.summary}" to your calendar`}
        size={size}
        data-testid="add-to-calendar"
        disabled={busy}
        icon={<CalendarBlank size={16} weight="bold" aria-hidden="true" />}
        onClick={() => void run()}
      />
    </Tooltip>
  );
}
