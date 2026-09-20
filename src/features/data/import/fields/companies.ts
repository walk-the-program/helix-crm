/**
 * The Companies import: the businesses an owner sells to or buys from.
 *
 * A company is matched by name, not created fresh every time:
 *
 *   row --> guess columns --> parseCell per field --> Draft --> write path
 *                                                        |
 *                                             { name, phone, website,
 *                                               street, city, state,
 *                                               postal, country, source,
 *                                               tags: [...], notes: [...] }
 *
 * Running the same export twice should not double the list, which is why
 * `name` is the one required field and the thing the write path matches on.
 *
 * The aliases below are the header wording HubSpot, Pipedrive, Zoho, Google
 * Contacts (organisation fields) and a plain Excel export actually use for a
 * company record. Add a new export's wording here rather than teaching the
 * guesser a one-off rule.
 */
import type { Draft, ImportTypeDefinition } from "@/features/data/import/fields/types";
import { splitTagCell } from "@/features/data/import/fields/parsers";

export const COMPANIES_IMPORT: ImportTypeDefinition = {
  id: "companies",
  label: "Companies",
  noun: "companies",
  hint: "Businesses you work for or sell to. Matched by name, so importing the same list twice will not double it.",
  exampleFileName: "helix-companies-example.csv",
  fields: [
    {
      key: "name",
      label: "Company name",
      required: true,
      parser: "text",
      aliases: [
        "company name",
        "company",
        "name",
        "organisation name",
        "organization name",
        "account name",
        "business name",
        "org",
        "business",
      ],
      examples: [
        "Wasatch Peak Plumbing",
        "Cottonwood Heights Electric",
        "Provo Valley Roofing",
      ],
    },
    {
      key: "phone",
      label: "Phone",
      parser: "phone",
      aliases: [
        "phone",
        "phone number",
        "main phone",
        "company phone",
        "office phone",
        "telephone",
        "tel",
      ],
      examples: ["801-555-0101", "801-555-0117", "801-555-0142"],
    },
    {
      key: "website",
      label: "Website",
      parser: "text",
      aliases: [
        "website",
        "web site",
        "website url",
        "domain",
        "company domain name",
        "url",
        "homepage",
      ],
      examples: [
        "wasatchpeakplumbing.example",
        "cottonwoodheightselectric.example",
        "provovalleyroofing.example",
      ],
    },
    {
      key: "street",
      label: "Street",
      parser: "text",
      aliases: [
        "street",
        "street address",
        "address",
        "address line 1",
        "mailing street",
        "billing street",
      ],
      examples: ["482 Wasatch Blvd", "6740 S Bengal Blvd", "1275 N University Ave"],
    },
    {
      key: "city",
      label: "City",
      parser: "text",
      aliases: ["city", "town", "mailing city", "billing city"],
      examples: ["Salt Lake City", "Cottonwood Heights", "Provo"],
    },
    {
      key: "state",
      label: "State",
      parser: "text",
      aliases: ["state", "state region", "province", "region", "mailing state", "billing state"],
      examples: ["UT", "UT", "UT"],
    },
    {
      key: "postal",
      label: "Postal code",
      parser: "text",
      aliases: [
        "zip",
        "zip code",
        "postal code",
        "postcode",
        "post code",
        "mailing zip",
        "billing zip",
      ],
      examples: ["84109", "84121", "84604"],
    },
    {
      key: "country",
      label: "Country",
      parser: "text",
      aliases: ["country", "country region", "mailing country", "billing country"],
      examples: ["United States", "United States", "United States"],
    },
    {
      key: "source",
      label: "Where they came from",
      parser: "text",
      aliases: [
        "source",
        "lead source",
        "original source",
        "original traffic source",
        "traffic source",
        "referral source",
      ],
      examples: ["Referral", "Google", "Website"],
    },
    {
      key: "tags",
      label: "Tags",
      parser: "tags",
      multiple: true,
      hint: "Separated by ; or ,",
      aliases: ["tags", "tag", "labels", "label", "groups", "group", "category", "categories"],
      // The default writer would overwrite the array on a second tag column.
      // Every tag column feeds the same `tags` list, and a tag already on it
      // (from an earlier column, or spelled the same way twice in one cell)
      // is not added again.
      write: (draft: Draft, _value: string | number, raw: string): void => {
        const existing = Array.isArray(draft.tags) ? (draft.tags as string[]) : [];
        for (const tag of splitTagCell(raw)) {
          if (!existing.includes(tag)) existing.push(tag);
        }
        draft.tags = existing;
      },
      examples: [
        "Plumbing; Repeat customer",
        "Electrical; Commercial",
        "Roofing; Storm damage",
      ],
    },
    {
      key: "notes",
      label: "Notes",
      parser: "text",
      multiple: true,
      aliases: ["notes", "note", "description", "comments", "comment", "details", "about"],
      examples: [
        "Prefers text over calls.",
        "Net 30 terms on file.",
        "Ask for the office manager, not the crew lead.",
      ],
    },
  ],
};
