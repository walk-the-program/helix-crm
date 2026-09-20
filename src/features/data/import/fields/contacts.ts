/**
 * Contacts, described the way the other types are described.
 *
 * This is NOT the contacts importer. That is `lib/mapping.ts` plus
 * `lib/importRun.ts`, it has been in the product since v1, it knows about
 * custom fields and per-column email labels, and rewriting it on top of the
 * generic field machinery would be a rewrite of the one import path with a
 * year of fixtures behind it. `legacy: true` tells the wizard to keep using it.
 *
 * What this file is for is everything that is not the write path: the radio on
 * the first step, the noun on the result screen, and - the reason it carries a
 * field list at all - the downloadable example file. The labels below are
 * exactly the labels in `lib/mapping.ts`, and every one of them is a header
 * `guessMapping` recognises, which is what makes the example Helix hands out
 * an example Helix can read straight back in.
 * `tests/unit/data/importExamples.test.ts` holds that promise to the wall.
 */
import type { FieldDefinition, ImportTypeDefinition } from "@/features/data/import/fields/types";

const FIELDS: readonly FieldDefinition[] = [
  {
    key: "firstName",
    label: "First name",
    required: true,
    parser: "text",
    aliases: ["first name", "given name", "forename"],
    examples: ["Dana", "Marcus", "Renee"],
  },
  {
    key: "lastName",
    label: "Last name",
    parser: "text",
    aliases: ["last name", "surname", "family name"],
    examples: ["Whitfield", "Olsen", "Tanaka"],
  },
  {
    key: "company",
    label: "Company",
    parser: "text",
    aliases: ["company", "company name", "organisation", "organization", "account name"],
    hint: "Linked by exact name, or created if it is new.",
    examples: [
      "Wasatch Peak Property Group",
      "Olsen Heating & Air",
      "Tanaka Property Management",
    ],
  },
  {
    key: "email",
    label: "Email",
    parser: "email",
    aliases: ["email", "email address", "e mail"],
    examples: [
      "dana.whitfield@wasatchpeak.example",
      "marcus@olsenhvac.example",
      "renee.tanaka@tanakaproperty.example",
    ],
  },
  {
    key: "phone",
    label: "Phone",
    parser: "phone",
    aliases: ["phone", "phone number", "mobile", "cell", "telephone"],
    examples: ["801-555-0142", "385-555-0117", "801-555-0164"],
  },
  {
    key: "street",
    label: "Street",
    parser: "text",
    aliases: ["street", "street address", "address", "address line 1", "mailing street"],
    examples: ["4820 Highland Drive", "188 W Center Street", "6310 S Redwood Road"],
  },
  {
    key: "city",
    label: "City",
    parser: "text",
    aliases: ["city", "town"],
    examples: ["Holladay", "Orem", "Taylorsville"],
  },
  {
    key: "state",
    label: "State",
    parser: "text",
    aliases: ["state", "province", "region", "state region"],
    examples: ["UT", "UT", "UT"],
  },
  {
    key: "postal",
    label: "Postal code",
    parser: "text",
    aliases: ["postal code", "zip", "zip code", "postcode", "post code"],
    examples: ["84117", "84057", "84123"],
  },
  {
    key: "country",
    label: "Country",
    parser: "text",
    aliases: ["country"],
    examples: ["United States", "United States", "United States"],
  },
  {
    key: "tags",
    label: "Tags",
    parser: "tags",
    multiple: true,
    aliases: ["tags", "tag", "labels", "label", "groups", "group"],
    hint: "Separated by ; or ,",
    examples: ["Repeat", "Maintenance plan", "Referral;Property manager"],
  },
  {
    key: "notes",
    label: "Notes",
    parser: "text",
    multiple: true,
    aliases: ["notes", "note", "description", "comments", "details"],
    examples: [
      "Prefers a text the morning of.",
      "Gate code is on the work order.",
      "Manages eleven rentals along Redwood Road.",
    ],
  },
  {
    key: "source",
    label: "Source",
    parser: "text",
    aliases: ["source", "lead source", "traffic source", "original traffic source"],
    examples: ["Referral", "Google", "Repeat customer"],
  },
];

export const CONTACTS_IMPORT: ImportTypeDefinition = {
  id: "contacts",
  label: "Contacts",
  hint: "People and the businesses they work for. The place most owners start.",
  exampleFileName: "helix-contacts-example.csv",
  noun: "contacts",
  fields: FIELDS,
  legacy: true,
};
