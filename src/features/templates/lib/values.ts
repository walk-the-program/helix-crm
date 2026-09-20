/**
 * Where the merge values come from.
 *
 * `merge.ts` is pure and does the substitution; this is the half that reads the
 * database, so the two can be tested separately and the live preview can feed
 * the same renderer a made-up customer.
 *
 * `owner.name` and `business.name` are written by onboarding and are not in the
 * typed settings registry, so they are read through `getRaw` - the documented
 * escape hatch for a key a feature adds (the AI feature reads its own keys the
 * same way). A workspace that never ran onboarding has neither, and both fields
 * render as nothing rather than as a placeholder the customer would see.
 */
import * as contactsRepo from "@/db/repos/contacts";
import * as dealsRepo from "@/db/repos/deals";
import * as settingsRepo from "@/db/repos/settings";
import { formatMoney } from "@/lib/money";
import type { MergeValues } from "@/features/templates/lib/merge";

export const OWNER_NAME_KEY = "owner.name";
export const BUSINESS_NAME_KEY = "business.name";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The two things about the owner every template can use. Blank when unset. */
export async function ownerValues(): Promise<Pick<MergeValues, "owner_name" | "business_name">> {
  const [owner, business] = await Promise.all([
    settingsRepo.getRaw(OWNER_NAME_KEY),
    settingsRepo.getRaw(BUSINESS_NAME_KEY),
  ]);
  return { owner_name: asString(owner), business_name: asString(business) };
}

/**
 * Every value for one contact.
 *
 * The deal is the contact's newest open one, because that is what a follow-up
 * is about. With no open deal it falls back to the newest deal of any kind, and
 * with no deal at all both deal fields are blank.
 */
export async function valuesForContact(contactId: string): Promise<MergeValues> {
  const [contact, owner, locale, currency] = await Promise.all([
    contactsRepo.get(contactId),
    ownerValues(),
    settingsRepo.get("locale"),
    settingsRepo.get("currency"),
  ]);

  const open = await dealsRepo.list({ contactId, openOnly: true }, { limit: 1 });
  const deal =
    open.rows[0] ?? (await dealsRepo.list({ contactId }, { limit: 1 })).rows[0] ?? null;

  return {
    ...owner,
    first_name: contact?.firstName ?? "",
    last_name: contact?.lastName ?? "",
    company: contact?.companyName ?? "",
    deal_title: deal?.title ?? "",
    deal_value: deal ? formatMoney(deal.valueCents, deal.currency || currency, locale) : "",
  };
}
