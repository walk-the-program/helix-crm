/**
 * One-tap actions (docs/PLAN.md item 12).
 *
 * Every phone number, email address and street address in the product is a
 * control, not a string: tapping it hands the OS a `tel:`, `sms:`, `mailto:`
 * or maps URL through `@tauri-apps/plugin-opener`, and then offers to write
 * the timeline entry the owner would otherwise forget.
 *
 * The shape is deliberately two-step. `openTel(...)` returns a `logThis`
 * callback rather than writing the activity itself, because tapping a number
 * is not proof that a conversation happened — half the time it rings out. The
 * caller shows an affordance ("Log this call") and only the tap on that writes
 * a row. Nothing here writes to the database unless `logThis` is called.
 *
 * The opener is scoped in src-tauri/capabilities/default.json to https, mailto,
 * tel and sms. A maps link is therefore an https URL, not a platform-specific
 * `maps:` scheme.
 *
 * SCOPE NOTE for the orchestrator: the records agent is building its own copy
 * of this for record screens. This one is kept small and dependency-light on
 * purpose so the two can be reconciled into `src/lib/` by merging, not by
 * rewriting. The only thing it needs from the app is the activities repository.
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import * as activities from "@/db/repos/activities";
import type { ActivityKind } from "@/db/repos/activities";

/** Which record the logged activity hangs off. At least one should be set. */
export type ActionTarget = {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
};

export type OneTapResult = {
  /** The URL handed to the OS, kept so the caller can show or test it. */
  url: string;
  /** Writes the matching timeline entry. Safe to never call. */
  logThis: (note?: string) => Promise<void>;
  /** The button label for the affordance, in the owner's words. */
  logLabel: string;
};

/**
 * Digits and a leading plus only. A `tel:` URL with a space or a bracket in it
 * is handled inconsistently across platforms, and the raw string a contact was
 * imported with is usually `(801) 555-0147`.
 */
export function telHref(phone: string): string {
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${cleaned.replace(/\+/g, "")}`;
}

export function smsHref(phone: string): string {
  return `sms:${telHref(phone).slice("tel:".length)}`;
}

export function mailtoHref(
  email: string,
  options: { subject?: string; body?: string } = {},
): string {
  const params = new URLSearchParams();
  if (options.subject) params.set("subject", options.subject);
  if (options.body) params.set("body", options.body);
  const query = params.toString();
  return `mailto:${email.trim()}${query ? `?${query}` : ""}`;
}

/**
 * A web maps URL rather than a platform scheme, because the capability only
 * allows https and because a link that opens in a browser always works, even
 * on a machine with no maps app installed.
 */
export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    address.trim(),
  )}`;
}

async function open(url: string): Promise<void> {
  await openUrl(url);
}

function logger(
  kind: ActivityKind,
  target: ActionTarget,
  fallbackBody: string,
): (note?: string) => Promise<void> {
  return async (note?: string) => {
    await activities.create({
      kind,
      body: note && note.trim().length > 0 ? note.trim() : fallbackBody,
      contactId: target.contactId ?? null,
      companyId: target.companyId ?? null,
      dealId: target.dealId ?? null,
    });
  };
}

/** Ring a number. Offers "Log this call". */
export async function openTel(
  phone: string,
  target: ActionTarget = {},
): Promise<OneTapResult> {
  const url = telHref(phone);
  await open(url);
  return {
    url,
    logLabel: "Log this call",
    logThis: logger("call", target, `Called ${phone}.`),
  };
}

/** Text a number. Offers "Log this text". */
export async function openSms(
  phone: string,
  target: ActionTarget = {},
): Promise<OneTapResult> {
  const url = smsHref(phone);
  await open(url);
  return {
    url,
    logLabel: "Log this text",
    logThis: logger("text", target, `Texted ${phone}.`),
  };
}

/** Compose an email in the owner's mail app. Offers "Log this email". */
export async function openMailto(
  email: string,
  target: ActionTarget = {},
  options: { subject?: string; body?: string } = {},
): Promise<OneTapResult> {
  const url = mailtoHref(email, options);
  await open(url);
  return {
    url,
    logLabel: "Log this email",
    logThis: logger("email", target, `Emailed ${email}.`),
  };
}

/** Open an address in maps. Offers "Log this visit" as a meeting. */
export async function openMaps(
  address: string,
  target: ActionTarget = {},
): Promise<OneTapResult> {
  const url = mapsHref(address);
  await open(url);
  return {
    url,
    logLabel: "Log this visit",
    logThis: logger("meeting", target, `Visited ${address}.`),
  };
}

/**
 * The "log a call" path Today uses without dialling first: the owner already
 * had the conversation on their phone and is recording it afterwards. Separate
 * from `openTel` because nothing is opened.
 */
export async function logCall(
  target: ActionTarget,
  note: string,
): Promise<void> {
  await logger("call", target, "Called them.")(note);
}
