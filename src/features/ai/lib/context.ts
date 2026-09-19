/**
 * Building the little bundle of text an AI action is allowed to send.
 *
 * This file is the enforcement point for "only the record on screen"
 * (PLAN.md, Security). Everything sent is read here, from one record and its
 * own timeline, capped, and nothing else can reach the provider.
 */
import * as deals from "@/db/repos/deals";
import * as contacts from "@/db/repos/contacts";
import * as companies from "@/db/repos/companies";
import * as activities from "@/db/repos/activities";
import * as settingsRepo from "@/db/repos/settings";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import type {
  DealContext,
  RecordContext,
  TimelineEntry,
} from "@/features/ai/provider";

/** The newest entries only: a five-year-old note does not help a follow-up. */
const TIMELINE_LIMIT = 30;

export type AiEntityType = "contact" | "company" | "deal";

async function timelineFor(
  entityType: AiEntityType,
  entityId: string,
): Promise<TimelineEntry[]> {
  const filter =
    entityType === "deal"
      ? { dealId: entityId }
      : entityType === "contact"
        ? { contactId: entityId }
        : { companyId: entityId };

  const { rows } = await activities.list(
    { ...filter, includeSystem: true },
    { limit: TIMELINE_LIMIT },
  );
  return rows.map((row) => ({
    kind: row.kind,
    at: row.occurredAt.slice(0, 10),
    text: row.body,
  }));
}

export async function dealContext(
  dealId: string,
): Promise<{ deal: DealContext; timeline: TimelineEntry[] } | null> {
  const deal = await deals.get(dealId);
  if (!deal) return null;
  const [currency, locale] = await Promise.all([
    settingsRepo.get("currency"),
    settingsRepo.get("locale"),
  ]);

  const contactName = [deal.contactFirstName, deal.contactLastName]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();

  return {
    deal: {
      title: deal.title,
      stage: deal.stageName,
      value:
        deal.valueCents > 0 ? formatMoney(deal.valueCents, currency, locale) : null,
      contactName: contactName.length > 0 ? contactName : null,
      companyName: deal.companyName,
      expectedOn: deal.expectedOn
        ? formatDateDisplay(deal.expectedOn, locale)
        : null,
    },
    timeline: await timelineFor("deal", dealId),
  };
}

export async function recordContext(
  entityType: AiEntityType,
  entityId: string,
): Promise<{ record: RecordContext; timeline: TimelineEntry[] } | null> {
  const [currency, locale] = await Promise.all([
    settingsRepo.get("currency"),
    settingsRepo.get("locale"),
  ]);

  if (entityType === "deal") {
    const deal = await deals.get(entityId);
    if (!deal) return null;
    return {
      record: {
        kind: "deal",
        name: deal.title,
        fields: [
          { label: "Stage", value: deal.stageName },
          {
            label: "Value",
            value: formatMoney(deal.valueCents, currency, locale),
          },
          ...(deal.companyName
            ? [{ label: "Company", value: deal.companyName }]
            : []),
          ...(deal.expectedOn
            ? [{ label: "Expected", value: formatDateDisplay(deal.expectedOn, locale) }]
            : []),
        ],
      },
      timeline: await timelineFor("deal", entityId),
    };
  }

  if (entityType === "contact") {
    const contact = await contacts.get(entityId);
    if (!contact) return null;
    return {
      record: {
        kind: "contact",
        name: contacts.contactName(contact),
        fields: [
          ...(contact.companyName
            ? [{ label: "Company", value: contact.companyName }]
            : []),
          ...contact.phones.map((p) => ({ label: "Phone", value: p.raw })),
          ...contact.emails.map((e) => ({ label: "Email", value: e.emailLower })),
          ...(contact.notes ? [{ label: "Notes", value: contact.notes }] : []),
        ],
      },
      timeline: await timelineFor("contact", entityId),
    };
  }

  const company = await companies.get(entityId);
  if (!company) return null;
  return {
    record: {
      kind: "company",
      name: company.name,
      fields: [
        ...(company.phoneRaw ? [{ label: "Phone", value: company.phoneRaw }] : []),
        ...(company.website ? [{ label: "Website", value: company.website }] : []),
        ...(company.notes ? [{ label: "Notes", value: company.notes }] : []),
      ],
    },
    timeline: await timelineFor("company", entityId),
  };
}
