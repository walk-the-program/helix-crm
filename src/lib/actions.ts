/**
 * One-tap actions (docs/PLAN.md item 12).
 *
 * Every phone number, email address and street address in the product is a
 * control, not a string: tapping it hands the OS a `tel:`, `sms:`, `mailto:`
 * or maps URL through `@tauri-apps/plugin-opener`, and then offers to write
 * the timeline entry the owner would otherwise forget.
 *
 * Wave 3 merged two copies of this — `src/features/today/actions.ts` and
 * `src/features/records/lib/{links,oneTap}.ts` — into this one module, which
 * both features now import. The two offer styles both survived because they
 * are two different moments, not two opinions:
 *
 *   oneTap(...)   opens the link and shows a toast with a "Log it" button.
 *                 Used by the record screens, where the owner is at the desk.
 *   openTel(...)  opens the link and hands the caller back a `logThis`
 *                 callback plus the label to put on it. Used by Today, whose
 *                 rows render their own inline affordance.
 *
 * Neither writes anything until the owner says so: tapping a number is not
 * proof that a conversation happened — half the time it rings out.
 *
 * The opener is scoped in src-tauri/capabilities/default.json to https,
 * mailto, tel and sms, so a maps link is an https URL and not a
 * platform-specific `maps:` scheme.
 *
 * NOTE on the layer: everything else in `src/lib` is pure. This module is the
 * documented exception (docs/CONTRACTS.md) — it reaches the OS opener, the
 * activities repository, the query client and the toaster, because a one-tap
 * action is exactly the sum of those four and splitting it put the same code
 * in two features.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "@/ui";
import * as activities from "@/db/repos/activities";
import type { ActivityKind } from "@/db/repos/activities";
import { queryClient, qk } from "@/app/queryClient";
import { formatPhone } from "@/lib/phone";

/* -------------------------------------------------------------------------- */
/* the links (pure)                                                           */
/* -------------------------------------------------------------------------- */

export type OneTapKind = "call" | "text" | "email" | "map";

/** `tel:` wants digits and a leading +, nothing else. */
export function telHref(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, "")}`;
}

/**
 * `sms:` with an optional prefilled message.
 *
 * The two platforms disagree about the separator: iOS and macOS Messages read
 * `sms:<number>&body=...`, Android reads `sms:<number>?body=...`. `?&body=`
 * satisfies both - Android sees a query string whose first parameter is empty,
 * and Messages sees the `&body=` it wants - and it is the form every
 * cross-platform SMS link has used since iOS 8. Nothing else works on both, so
 * do not "tidy" it to `?body=`.
 */
export function smsHref(value: string, options: { body?: string } = {}): string {
  const number = value.replace(/[^\d+]/g, "");
  const body = options.body?.trim();
  return body ? `sms:${number}?&body=${encodeQueryValue(body)}` : `sms:${number}`;
}

/**
 * Strips CR and LF before a value is ever percent-encoded into the
 * *address* segment of a `mailto:` URL.
 *
 * `encodeURIComponent` already turns a literal newline into `%0D`/`%0A`, so
 * the character never appears raw in the URL Helix builds - but the URL is
 * handed to whatever mail client the OS opens, and that client decodes it
 * before showing (or, worse, before re-composing) the message. A mail
 * client that then writes the decoded "To" value straight into a header
 * line it builds itself would see the newline again on the other side of
 * that decode, which is the CRLF header-injection class this closes: an
 * address of `a@b.com\nBcc:attacker@evil.com` never reaches the client with
 * a newline in it at all, encoded or not.
 *
 * This is deliberately NOT applied to the subject or body: a real newline
 * inside the message body is how a multi-paragraph template (blank line
 * between "Hi Nella," and the next sentence) is supposed to look once the
 * owner's mail app decodes it, and stripping it there would silently mangle
 * every templated email into one run-on paragraph. The subject and body are
 * still fully percent-encoded (`encodeQueryValue` below) - a newline there
 * lands inside the message text a mail client shows, never inside a header
 * line the way it would in the recipient address.
 */
function stripCrlf(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Percent-encoding for a `mailto:` or `sms:` parameter (subject/body).
 *
 * Not `URLSearchParams`: that encodes a space as `+`, which a mail client shows
 * to the customer as a literal plus sign in every gap of the message. RFC 6068
 * wants percent-encoding, and `encodeURIComponent` gives `%20`.
 */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value);
}

export function mailtoHref(
  value: string,
  options: { subject?: string; body?: string } = {},
): string {
  const params: string[] = [];
  if (options.subject) params.push(`subject=${encodeQueryValue(options.subject)}`);
  if (options.body) params.push(`body=${encodeQueryValue(options.body)}`);
  const query = params.join("&");
  return `mailto:${encodeURIComponent(stripCrlf(value.trim()))}${query ? `?${query}` : ""}`;
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

/**
 * A free-text "website" field (CSV import, pasted text, anything an owner or
 * a competitor's export can put in a text column), validated down to a URL
 * `openUrl` is actually willing to open: `http:`/`https:` only, a bare
 * domain upgraded to `https:`, everything else refused with a plain-English
 * reason instead of being handed to the OS opener or a raw `<a href>`.
 *
 * Two things a naive `startsWith("http")` check (or a scheme regex alone)
 * gets wrong, both closed here:
 *
 *  - **Control characters split a scheme.** A URL parser strips embedded
 *    TAB/CR/LF before it ever reads the scheme - that is how `java\tscript:`
 *    or `java\nscript:` decode to `javascript:`. Every TAB, CR and LF is
 *    stripped from the whole string before anything else runs, and leading/
 *    trailing whitespace (a leading space ahead of `javascript:`, a trailing
 *    newline after a legitimate `https://…`) is trimmed next.
 *  - **A bare domain with a port looks like a scheme.** `example.com:8080`
 *    matches the URI grammar for a scheme (letters, digits, `+`, `-`, `.`
 *    before a colon) just as easily as `javascript:` does. No real scheme
 *    Helix would ever ALLOW or need to REFUSE contains a literal `.`, so a
 *    candidate scheme with a dot in it is treated as part of a bare domain
 *    instead - `example.com:8080/path` upgrades to
 *    `https://example.com:8080/path` rather than being refused as an
 *    unrecognised scheme called "example.com".
 */
export type SafeExternalUrlResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

const CONTROL_CHARS = /[\t\r\n]/g;
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

export function safeExternalUrl(input: string): SafeExternalUrlResult {
  const trimmed = input.replace(CONTROL_CHARS, "").trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "There's no web address saved." };
  }

  const refused = (): SafeExternalUrlResult => ({
    ok: false,
    message: `"${trimmed}" isn't a web address Helix can open.`,
  });

  // "//evil.com" has no scheme of its own; it borrows whatever loads it.
  // Refuse it outright rather than let it fall through to the bare-domain
  // path below, even though prefixing "https://" would not change its host.
  if (trimmed.startsWith("//")) return refused();

  const schemeMatch = SCHEME_PATTERN.exec(trimmed);
  const hasRealScheme = schemeMatch !== null && !schemeMatch[1].includes(".");

  if (hasRealScheme) {
    const scheme = schemeMatch![1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return refused();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return refused();
      return { ok: true, url: parsed.toString() };
    } catch {
      return refused();
    }
  }

  // No recognisable scheme: treat the whole thing as a bare domain (with an
  // optional port and path) and upgrade it to https.
  try {
    const parsed = new URL(`https://${trimmed}`);
    return { ok: true, url: parsed.toString() };
  } catch {
    return refused();
  }
}

/**
 * The href for a kind and a value. "map" returns null on purpose: a map link
 * is built from a whole formatted address, so the caller passes `mapsHref`
 * through `oneTap`'s `href` option rather than letting this guess.
 */
export function hrefFor(kind: OneTapKind, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (kind === "call") return telHref(trimmed);
  if (kind === "text") return smsHref(trimmed);
  if (kind === "email") return mailtoHref(trimmed);
  return null;
}

/* -------------------------------------------------------------------------- */
/* the timeline entry                                                         */
/* -------------------------------------------------------------------------- */

/** Which record a logged action belongs to. At least one should be set. */
export type ActionTarget = {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
};

/** The name the records feature has always used for the same thing. */
export type RecordLink = ActionTarget;

const LOG_BODY: Record<OneTapKind, (target: string) => string> = {
  call: (target) => `Called ${target}`,
  text: (target) => `Texted ${target}`,
  email: (target) => `Emailed ${target}`,
  map: (target) => `Looked up ${target}`,
};

const LOG_KIND: Record<OneTapKind, ActivityKind> = {
  call: "call",
  text: "text",
  email: "email",
  map: "note",
};

const LOG_LABEL: Record<OneTapKind, string> = {
  call: "Log this call",
  text: "Log this text",
  email: "Log this email",
  map: "Log this visit",
};

function displayTarget(kind: OneTapKind, value: string): string {
  return kind === "call" || kind === "text" ? formatPhone(value) || value : value;
}

/**
 * Write the timeline entry, then refresh whatever is on screen. `note` wins
 * over the generated body when the caller collected one.
 */
export async function logOneTap(
  kind: OneTapKind,
  value: string,
  link: ActionTarget,
  note?: string,
): Promise<void> {
  const target = displayTarget(kind, value);
  const body =
    note && note.trim().length > 0 ? note.trim() : LOG_BODY[kind](target);
  await activities.create({
    kind: LOG_KIND[kind],
    body,
    contactId: link.contactId ?? null,
    companyId: link.companyId ?? null,
    dealId: link.dealId ?? null,
  });
  await queryClient.invalidateQueries({ queryKey: ["activities"] });
  await queryClient.invalidateQueries({ queryKey: qk.today() });
}

/**
 * The "log a call" path Today uses without dialling first: the owner already
 * had the conversation on their phone and is recording it afterwards. Nothing
 * is opened.
 */
export async function logCall(
  target: ActionTarget,
  note: string,
): Promise<void> {
  await logOneTap("call", "", target, note || "Called them.");
}

/* -------------------------------------------------------------------------- */
/* opening, with the toast offer (the record screens)                         */
/* -------------------------------------------------------------------------- */

/**
 * Hand the link to the OS, then offer the log entry. The toast is the offer:
 * one click, no dialog, and it disappears on its own if he is already driving.
 */
export async function oneTap(
  kind: OneTapKind,
  value: string,
  link: ActionTarget,
  options: { href?: string | null; label?: string } = {},
): Promise<void> {
  const href = options.href ?? hrefFor(kind, value);
  if (!href) return;

  try {
    await openUrl(href);
  } catch (err) {
    toast.error(
      `Could not open ${options.label ?? displayTarget(kind, value)}. ${
        err instanceof Error ? err.message : ""
      }`.trim(),
    );
    return;
  }

  toast.info(`Opened ${options.label ?? displayTarget(kind, value)}`, {
    duration: 10000,
    action: {
      label: "Log it",
      onClick: () => {
        void logOneTap(kind, value, link)
          .then(() => {
            toast.success(`Logged: ${LOG_BODY[kind](displayTarget(kind, value))}`);
          })
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not write that to the timeline.",
            );
          });
      },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* opening, with an inline affordance (Today)                                 */
/* -------------------------------------------------------------------------- */

export type OneTapResult = {
  /** The URL handed to the OS, kept so the caller can show or test it. */
  url: string;
  /** Writes the matching timeline entry. Safe to never call. */
  logThis: (note?: string) => Promise<void>;
  /** The button label for the affordance, in the owner's words. */
  logLabel: string;
};

async function openAndOffer(
  kind: OneTapKind,
  value: string,
  url: string,
  target: ActionTarget,
): Promise<OneTapResult> {
  await openUrl(url);
  return {
    url,
    logLabel: LOG_LABEL[kind],
    logThis: (note?: string) => logOneTap(kind, value, target, note),
  };
}

/** Ring a number. Offers "Log this call". */
export async function openTel(
  phone: string,
  target: ActionTarget = {},
): Promise<OneTapResult> {
  return openAndOffer("call", phone, telHref(phone), target);
}

/**
 * Text a number, optionally with the message already written. Offers "Log this
 * text".
 *
 * The body is what a template renders to; the opener hands it to Messages and
 * the owner still presses send himself, which is the only place that decision
 * belongs.
 */
export async function openSms(
  phone: string,
  target: ActionTarget = {},
  options: { body?: string } = {},
): Promise<OneTapResult> {
  return openAndOffer("text", phone, smsHref(phone, options), target);
}

/** Compose an email in the owner's mail app. Offers "Log this email". */
export async function openMailto(
  email: string,
  target: ActionTarget = {},
  options: { subject?: string; body?: string } = {},
): Promise<OneTapResult> {
  return openAndOffer("email", email, mailtoHref(email, options), target);
}

/** Open an address in maps. Offers "Log this visit". */
export async function openMaps(
  address: string,
  target: ActionTarget = {},
): Promise<OneTapResult> {
  return openAndOffer("map", address, mapsHref(address), target);
}
