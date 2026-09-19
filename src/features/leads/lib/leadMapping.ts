/**
 * Turning one website lead into the rows Helix keeps.
 *
 *   lead  ->  contact (deduped on email, then phone)
 *         ->  deal    (first stage, source Website, external_id "<origin>:<id>")
 *         ->  system activity holding the original message
 *
 * Everything here is pure: no database, no clock beyond what is passed in, so
 * the mapping is unit-testable on its own. docs/PLAN.md, Core item 10.
 */
import type { Lead } from "@/features/leads/lib/types";

/** The source name every website lead is filed under. */
export const WEBSITE_SOURCE = "Website";

/**
 * The idempotency key. One deal per lead per site: a repeated poll finds the
 * row and skips it, so re-polling is free.
 */
export function externalIdFor(siteOrigin: string, leadId: string): string {
  return `${normaliseOrigin(siteOrigin)}:${leadId}`;
}

/** Trailing slashes off, lowercased scheme and host: one stable key per site. */
export function normaliseOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export type LeadName = { firstName: string; lastName: string };

/**
 * Website forms have one name box. Split on the last space so "Mary Anne
 * Sorensen" keeps "Mary Anne" together, and fall back to the email's local
 * part, then to "Website lead", because a contact with no name at all is
 * unfindable in a list.
 */
export function splitLeadName(lead: Lead): LeadName {
  const raw = (lead.name ?? "").trim().replace(/\s+/g, " ");
  if (raw.length > 0) {
    const cut = raw.lastIndexOf(" ");
    if (cut === -1) return { firstName: raw, lastName: "" };
    return { firstName: raw.slice(0, cut), lastName: raw.slice(cut + 1) };
  }
  const email = (lead.email ?? "").trim();
  const local = email.includes("@") ? email.slice(0, email.indexOf("@")) : "";
  if (local.length > 0) return { firstName: local, lastName: "" };
  return { firstName: "Website lead", lastName: "" };
}

/**
 * The deal's title: what the owner scans for in the pipeline.
 *
 * The person's name here is the one the visitor actually gave, not
 * `splitLeadName`'s "Website lead" placeholder: a form with a service and no
 * name should read "Lawn care", never "Lawn care - Website lead".
 */
export function dealTitleFor(lead: Lead): string {
  const service = (lead.service ?? "").trim();
  const { firstName, lastName } = splitLeadName(lead);
  const person = hasRealName(lead) ? `${firstName} ${lastName}`.trim() : "";
  if (service.length > 0 && person.length > 0) return `${service} - ${person}`;
  if (service.length > 0) return service;
  return person.length > 0 ? person : "Website lead";
}

/** True when the lead carried something a person would recognise as a name. */
function hasRealName(lead: Lead): boolean {
  if ((lead.name ?? "").trim().length > 0) return true;
  const email = (lead.email ?? "").trim();
  return email.includes("@") && email.indexOf("@") > 0;
}

/**
 * The system timeline entry. It holds the three things the owner will want
 * when he calls back: what they asked for, what they typed, and which page
 * they were on. Labels are spelled out because the entry is immutable and has
 * to read on its own years later.
 */
export function systemActivityBody(lead: Lead): string {
  const lines = ["Lead from the website."];
  const service = (lead.service ?? "").trim();
  const message = (lead.message ?? "").trim();
  const pageUrl = (lead.pageUrl ?? "").trim();
  if (service.length > 0) lines.push(`Service: ${service}`);
  if (message.length > 0) lines.push(`Message: ${message}`);
  if (pageUrl.length > 0) lines.push(`Page: ${pageUrl}`);
  return lines.join("\n");
}

export type MappedLead = {
  externalId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dealTitle: string;
  activityBody: string;
  /** The site's own timestamp, used as the activity's occurred_at. */
  occurredAt: string;
};

/** Everything the applier needs, derived once per lead. */
export function mapLead(lead: Lead, siteOrigin: string): MappedLead {
  const { firstName, lastName } = splitLeadName(lead);
  const email = (lead.email ?? "").trim();
  const phone = (lead.phone ?? "").trim();
  return {
    externalId: externalIdFor(siteOrigin, lead.id),
    firstName,
    lastName,
    email: email.length > 0 ? email : null,
    phone: phone.length > 0 ? phone : null,
    dealTitle: dealTitleFor(lead),
    activityBody: systemActivityBody(lead),
    occurredAt: lead.createdAt,
  };
}
