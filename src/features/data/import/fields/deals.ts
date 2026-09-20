/**
 * Deals: the columns Helix can read out of a pipeline export, and the rules
 * for tying each row to the people and businesses already in the workspace.
 *
 *   Deal Name  -> title                      (the one column a row cannot skip)
 *   Amount     -> value_cents
 *   Upfront    -> one_time_cents
 *   Monthly    -> recurring_monthly_cents
 *   Deal Stage -> the stage whose name matches, ignoring case
 *   Close Date -> expected_on
 *   Contact    -> matched on email, then phone, then the exact full name
 *   Company    -> matched on the exact name, created when it is new
 *   Notes      -> a note on the deal's timeline
 *
 * The money needs one sentence of its own, because `value_cents` is derived:
 * it is the ANNUAL value, one_time_cents + 12 x recurring_monthly_cents
 * (drizzle/0004_revenue.sql). A file with an Upfront and a Monthly column is
 * read from those two and the total is recomputed; a file with only a total
 * puts all of it in one_time_cents.
 *
 * Nothing here writes anything: this file says what the columns mean, and
 * `lib/typedImportRun.ts` turns a read row into statements. The matching rules
 * live there too, because they need the workspace; the aliases live here,
 * because they are the same on every machine.
 *
 * The aliases cover the two exports a trade owner actually arrives with.
 * HubSpot writes "Deal Name", "Amount", "Deal Stage", "Close Date",
 * "Associated Contact"; Pipedrive writes "Title", "Value", "Stage",
 * "Expected close date", "Person". Both are in the fixtures.
 */
import { splitTagCell } from "@/features/data/import/fields/parsers";
import type { Draft, FieldDefinition, ImportTypeDefinition } from "@/features/data/import/fields/types";

/** Tags arrive one column at a time and several to a cell; keep them unique. */
function writeTags(draft: Draft, _value: string | number, raw: string): void {
  const existing = draft.tags;
  const list = Array.isArray(existing) ? existing : [];
  for (const tag of splitTagCell(raw)) {
    if (!list.includes(tag)) list.push(tag);
  }
  draft.tags = list;
}

const FIELDS: readonly FieldDefinition[] = [
  {
    key: "title",
    label: "Deal",
    required: true,
    parser: "text",
    aliases: [
      "title",
      "deal",
      "deal name",
      "name",
      "opportunity",
      "opportunity name",
      "job",
      "job name",
      "project",
      "project name",
    ],
    hint: "What the job is. Every row needs one.",
    examples: [
      "Water heater replacement - Holladay",
      "Furnace tune-up and duct clean",
      "Roof tear-off and reshingle",
    ],
  },
  {
    key: "value",
    label: "Value",
    parser: "money",
    aliases: [
      "value",
      "amount",
      "deal value",
      "deal amount",
      "total",
      "total value",
      "price",
      "revenue",
      "quote",
      "quoted",
    ],
    hint: "The whole job for a year. Currency symbols and commas are fine.",
    examples: ["$2,450.00", "$468.00", "$14,800.00"],
  },
  {
    key: "upfront",
    label: "Upfront",
    parser: "money",
    aliases: [
      "upfront",
      "up front",
      "one time",
      "one off",
      "onetime",
      "deposit",
      "upfront amount",
      "one time amount",
      "setup fee",
      "install",
    ],
    hint: "The part billed once, if you split the job that way.",
    examples: ["$2,450.00", "$0.00", "$14,800.00"],
  },
  {
    key: "monthly",
    label: "Monthly",
    parser: "money",
    aliases: [
      "monthly",
      "monthly value",
      "monthly amount",
      "recurring",
      "recurring monthly",
      "per month",
      "mrr",
      "maintenance",
    ],
    hint: "The part that repeats every month. Upfront plus twelve of these is the value.",
    examples: ["$0.00", "$39.00", "$0.00"],
  },
  {
    key: "stage",
    label: "Stage",
    parser: "text",
    aliases: [
      "stage",
      "deal stage",
      "pipeline stage",
      "status",
      "deal status",
      "phase",
      "stage name",
    ],
    hint: "Matched to your stage names, ignoring capitals. A name Helix does not have lands in your first stage.",
    // Filled from the workspace so the file downloads directly importable.
    examples: ["New", "Quoted", "Won"],
    liveExamples: (context) => {
      const names = context.stageNames;
      const first = names[0] ?? "New";
      const middle = names[Math.min(1, names.length - 1)] ?? first;
      const last = names[names.length - 1] ?? first;
      return [first, middle, last];
    },
  },
  {
    key: "expectedOn",
    label: "Expected close",
    parser: "date",
    aliases: [
      "expected close date",
      "close date",
      "closing date",
      "expected date",
      "expected on",
      "estimated close date",
      "expected closing",
      "target date",
      "due date",
    ],
    hint: "When you expect to hear yes or no.",
    examples: ["2026-10-14", "2026-10-02", "2026-11-20"],
  },
  {
    key: "contactName",
    label: "Contact",
    parser: "text",
    aliases: [
      "contact",
      "person",
      "contact name",
      "person name",
      "associated contact",
      "primary contact",
      "customer",
      "client",
      "full name",
    ],
    hint: "Matched on their email first, then their phone, then this exact name.",
    examples: ["Dana Whitfield", "Marcus Olsen", "Renee Tanaka"],
  },
  {
    key: "contactEmail",
    label: "Contact email",
    parser: "email",
    aliases: [
      "contact email",
      "person email",
      "associated contact email",
      "email",
      "email address",
      "customer email",
      "primary email",
    ],
    examples: [
      "dana.whitfield@wasatchpeak.example",
      "marcus@olsenhvac.example",
      "renee.tanaka@tanakaproperty.example",
    ],
  },
  {
    key: "contactPhone",
    label: "Contact phone",
    parser: "phone",
    aliases: [
      "contact phone",
      "person phone",
      "associated contact phone",
      "phone",
      "phone number",
      "mobile",
      "cell",
      "customer phone",
    ],
    examples: ["801-555-0142", "385-555-0117", "801-555-0164"],
  },
  {
    key: "company",
    label: "Company",
    parser: "text",
    aliases: [
      "company",
      "company name",
      "organization",
      "organisation",
      "organization name",
      "organisation name",
      "associated company",
      "account",
      "account name",
      "business",
    ],
    hint: "Linked by exact name, or created if it is new.",
    examples: [
      "Wasatch Peak Property Group",
      "Olsen Heating & Air",
      "Tanaka Property Management",
    ],
  },
  {
    key: "source",
    label: "Where it came from",
    parser: "text",
    aliases: [
      "source",
      "lead source",
      "deal source",
      "original source",
      "original traffic source",
      "traffic source",
      "referral source",
      "how they found us",
    ],
    examples: ["Referral", "Google", "Repeat customer"],
  },
  {
    key: "notes",
    label: "Notes",
    parser: "text",
    multiple: true,
    aliases: ["notes", "note", "description", "comments", "comment", "details", "summary"],
    hint: "Saved as the first note on the deal.",
    examples: [
      "Old unit is a 50-gallon gas. Access through the garage.",
      "Wants the filter swap on the same visit.",
      "Needs the estimate before the HOA meeting on the 12th.",
    ],
  },
  {
    key: "tags",
    label: "Tags",
    parser: "tags",
    multiple: true,
    aliases: ["tags", "tag", "labels", "label", "category", "categories", "groups", "group"],
    hint: "Separated by ; or ,",
    write: writeTags,
    examples: ["Referral", "Maintenance plan", "Repeat;Insurance"],
  },
  {
    key: "wonOn",
    label: "Won on",
    parser: "date",
    aliases: [
      "won on",
      "won date",
      "date won",
      "closed won date",
      "close won date",
      "date closed won",
      "won",
    ],
    hint: "Fill this in and Helix marks the deal won, even if the stage column is blank.",
    examples: ["", "", "2026-09-04"],
  },
  {
    key: "lostOn",
    label: "Lost on",
    parser: "date",
    aliases: [
      "lost on",
      "lost date",
      "date lost",
      "closed lost date",
      "close lost date",
      "date closed lost",
      "lost",
    ],
    hint: "The same, the other way.",
    examples: ["", "", ""],
  },
] as const;

export const DEALS_IMPORT: ImportTypeDefinition = {
  id: "deals",
  label: "Deals",
  hint: "Jobs you are quoting or chasing. Helix ties each one to the person and the business it belongs to.",
  exampleFileName: "helix-deals-example.csv",
  noun: "deals",
  fields: FIELDS,
};
