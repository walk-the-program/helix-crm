/**
 * Column-to-field mapping: the guess, the catalogue the owner picks from, and
 * the row-level validation the preview shows.
 *
 *   headers --> guessMapping --> [ColumnMapping]  (owner edits any of them)
 *   cells   --> applyMapping --> MappedRow { firstName, emails, phones, ... }
 *                             \-> flags: what looks wrong on this row
 *
 * Pure: no database, no filesystem. The guesses are checked against every
 * fixture in tests/fixtures by tests/unit/data/mapping.test.ts.
 */
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { normalizePhone } from "@/lib/phone";

export type FieldId =
  | "skip"
  | "firstName"
  | "lastName"
  | "fullName"
  | "company"
  | "email"
  | "phone"
  | "street"
  | "city"
  | "state"
  | "postal"
  | "country"
  | "tags"
  | "notes"
  | "source"
  | "custom";

export type FieldDefinition = {
  id: FieldId;
  label: string;
  /** Several columns may carry this field (emails, phones, tags, notes). */
  multiple: boolean;
  hint?: string;
};

export const FIELDS: readonly FieldDefinition[] = [
  { id: "skip", label: "Skip this column", multiple: true },
  { id: "firstName", label: "First name", multiple: false },
  { id: "lastName", label: "Last name", multiple: false },
  {
    id: "fullName",
    label: "Full name",
    multiple: false,
    hint: "Split into first and last on the last space.",
  },
  {
    id: "company",
    label: "Company",
    multiple: false,
    hint: "Linked by exact name, or created if it is new.",
  },
  { id: "email", label: "Email", multiple: true },
  { id: "phone", label: "Phone", multiple: true },
  { id: "street", label: "Street", multiple: false },
  { id: "city", label: "City", multiple: false },
  { id: "state", label: "State", multiple: false },
  { id: "postal", label: "Postal code", multiple: false },
  { id: "country", label: "Country", multiple: false },
  { id: "tags", label: "Tags", multiple: true, hint: "Separated by ; or ," },
  { id: "notes", label: "Notes", multiple: true },
  { id: "source", label: "Source", multiple: false },
  { id: "custom", label: "Create a custom field", multiple: true },
] as const;

export function fieldLabel(id: FieldId): string {
  return FIELDS.find((f) => f.id === id)?.label ?? id;
}

export function allowsMultiple(id: FieldId): boolean {
  return FIELDS.find((f) => f.id === id)?.multiple ?? false;
}

export type ColumnMapping = {
  /** The header exactly as it appears in the file. */
  header: string;
  index: number;
  field: FieldId;
  /** Only for field "custom": the custom field's name. */
  customName?: string;
  /** For emails and phones: "work", "mobile", "home" ... taken from the header. */
  label?: string;
  /** True when the guess came from a rule rather than from the owner. */
  guessed: boolean;
};

/* -------------------------------------------------------------------------- */
/* header normalisation and the guess rules                                   */
/* -------------------------------------------------------------------------- */

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Headers that look like a deal column: v1 imports contacts only. */
const DEAL_LIKE =
  /(^| )deals?( |$)|(^| )opportunit(y|ies)( |$)|(^| )pipeline( |$)|(^| )stages?( |$)|(^| )amount( |$)|(^| )close date( |$)/;

export function looksLikeDealColumn(header: string): boolean {
  return DEAL_LIKE.test(normalizeHeader(header));
}

/**
 * Columns no CRM export ever wants imported: internal ids, the exporting
 * user's own name, timestamps the app stamps itself, and the structurally
 * empty columns Google Contacts pads its files with.
 */
const NEVER =
  /^(record id|id|person id|contact id|row id)$|(^| )(phonetic|photo|nickname|file as|name prefix|name suffix|middle name|birthday|department|job title|title|owner|contact owner|person owner|created|create date|created time|person created|modified|modified time|last activity date|last activity|last contacted|lead status|opt out|do not|fax)( |$)/;

/**
 * Google Contacts writes a "- Label" column beside every value column
 * ("E-mail 1 - Label" holds the word "Home"). Those are labels for another
 * column, not tags, and not the value either.
 */
const VALUE_LABEL = /^(e ?mail|phone|mobile|address|im|website|relation)\b.*\blabel$/;

type Rule = { field: FieldId; test: (h: string) => boolean };

const RULES: Rule[] = [
  // Emails first: "E-mail 1 - Label" must not be read as a phone or a tag.
  {
    field: "email",
    test: (h) => /(^| )(e ?mail|email address)( |$)|^email/.test(h) && !/ label$/.test(h),
  },
  {
    field: "phone",
    test: (h) =>
      /(^| )(phone|mobile|cell|telephone|tel)( |$)|^phone|^mobile/.test(h) &&
      !/ label$/.test(h),
  },
  { field: "firstName", test: (h) => /(^| )(first name|given name|forename)( |$)/.test(h) },
  {
    field: "lastName",
    test: (h) => /(^| )(last name|surname|family name)( |$)/.test(h),
  },
  {
    field: "fullName",
    test: (h) =>
      /^(name|full name|contact name|person name|display name|contact)$/.test(h) ||
      /(^| )(full name|person name|contact name|display name)( |$)/.test(h),
  },
  {
    field: "company",
    test: (h) =>
      /(^| )(company|company name|organi[sz]ation|organi[sz]ation name|account name|business|employer|org)( |$)/.test(
        h,
      ),
  },
  { field: "city", test: (h) => /(^| )(city|town)( |$)/.test(h) },
  {
    field: "state",
    test: (h) => /(^| )(state|state region|region|province|st)( |$)/.test(h),
  },
  {
    field: "postal",
    test: (h) => /(^| )(zip|zip code|postal|postal code|postcode|post code)( |$)/.test(h),
  },
  { field: "country", test: (h) => /(^| )country( |$)/.test(h) },
  {
    field: "street",
    test: (h) =>
      /(^| )(street|address|address line 1|mailing street|formatted)( |$)/.test(h),
  },
  { field: "tags", test: (h) => /(^| )(tags?|labels?|groups?|categor(y|ies))( |$)/.test(h) },
  {
    field: "source",
    test: (h) => /(^| )(source|lead source|traffic source|original traffic source)( |$)/.test(h),
  },
  {
    field: "notes",
    test: (h) => /(^| )(notes?|description|comments?|message|details)( |$)/.test(h),
  },
];

/** "E-mail 1 - Value" on a Google export is a work address; take what we can. */
export function labelFromHeader(header: string, field: FieldId): string | undefined {
  const h = normalizeHeader(header);
  if (field === "phone") {
    if (/(^| )(mobile|cell)( |$)/.test(h)) return "mobile";
    if (/(^| )(work|office|business)( |$)/.test(h)) return "work";
    if (/(^| )home( |$)/.test(h)) return "home";
    return "phone";
  }
  if (field === "email") {
    if (/(^| )(work|office|business)( |$)/.test(h)) return "work";
    if (/(^| )(home|personal)( |$)/.test(h)) return "home";
    return "work";
  }
  return undefined;
}

/**
 * The guess. Rules run in order and the first match wins; a field that can
 * only be filled once (first name, city, ...) is not guessed twice, so
 * "Mailing City" wins and a later "Other City" is left on Skip for the owner.
 */
export function guessMapping(headers: string[]): ColumnMapping[] {
  const taken = new Set<FieldId>();
  return headers.map((header, index) => {
    const base = { header, index, guessed: true };
    const h = normalizeHeader(header);

    if (
      h.length === 0 ||
      NEVER.test(h) ||
      VALUE_LABEL.test(h) ||
      looksLikeDealColumn(header)
    ) {
      return { ...base, field: "skip" as FieldId };
    }

    for (const rule of RULES) {
      if (!rule.test(h)) continue;
      if (!allowsMultiple(rule.field) && taken.has(rule.field)) continue;
      taken.add(rule.field);
      const label = labelFromHeader(header, rule.field);
      return { ...base, field: rule.field, label };
    }

    return { ...base, field: "skip" as FieldId };
  });
}

/** A stable key for "this shape of file", so the mapping can be remembered. */
export function headerSignature(headers: string[]): string {
  const joined = headers.map((h) => normalizeHeader(h)).join("|");
  // djb2: short, stable across sessions, and good enough to key a setting.
  let hash = 5381;
  for (let i = 0; i < joined.length; i += 1) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  return `${headers.length}-${(hash >>> 0).toString(36)}`;
}

/** Rebuild a remembered mapping against the headers actually in this file. */
export function applyRemembered(
  headers: string[],
  remembered: { header: string; field: FieldId; customName?: string; label?: string }[],
): ColumnMapping[] {
  const byHeader = new Map(remembered.map((r) => [normalizeHeader(r.header), r]));
  return headers.map((header, index) => {
    const hit = byHeader.get(normalizeHeader(header));
    if (!hit) return { header, index, field: "skip" as FieldId, guessed: true };
    return {
      header,
      index,
      field: hit.field,
      customName: hit.customName,
      label: hit.label ?? labelFromHeader(header, hit.field),
      guessed: false,
    };
  });
}

/** What gets stored in settings: no indexes, so a reordered file still matches. */
export function toRemembered(
  mapping: ColumnMapping[],
): { header: string; field: FieldId; customName?: string; label?: string }[] {
  return mapping.map((m) => ({
    header: m.header,
    field: m.field,
    customName: m.customName,
    label: m.label,
  }));
}

/* -------------------------------------------------------------------------- */
/* applying the mapping to a row                                              */
/* -------------------------------------------------------------------------- */

export type MappedEmail = { email: string; label: string; valid: boolean };
export type MappedPhone = { raw: string; e164: string | null; label: string };

export type RowFlag = {
  level: "error" | "warning";
  message: string;
  column?: string;
};

export type MappedRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  company: string;
  emails: MappedEmail[];
  phones: MappedPhone[];
  address: {
    street: string;
    city: string;
    state: string;
    postal: string;
    country: string;
  };
  tags: string[];
  notes: string;
  source: string;
  custom: { name: string; value: string }[];
  flags: RowFlag[];
  /** False when the row has nothing Helix can file: it is counted as skipped. */
  importable: boolean;
};

/** "Sarah J Mitchell" -> first "Sarah J", last "Mitchell". */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return { firstName: "", lastName: "" };
  // "Mitchell, Sarah" is how a "File As" column writes it.
  const comma = trimmed.indexOf(",");
  if (comma > 0) {
    return {
      lastName: trimmed.slice(0, comma).trim(),
      firstName: trimmed.slice(comma + 1).trim(),
    };
  }
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, lastSpace),
    lastName: trimmed.slice(lastSpace + 1),
  };
}

export function splitTags(value: string): string[] {
  return value
    // Google writes "* myContacts ::: Suppliers".
    .split(/[;,]|:::/)
    .map((t) => t.replace(/^\*/, "").trim())
    .filter((t) => t.length > 0);
}

export function addressJsonFor(address: MappedRow["address"]): string | null {
  const entries = Object.entries(address).filter(([, v]) => v.trim().length > 0);
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

export function applyMapping(
  cells: string[],
  mapping: ColumnMapping[],
  rowNumber: number,
  options: { region?: string } = {},
): MappedRow {
  const row: MappedRow = {
    rowNumber,
    firstName: "",
    lastName: "",
    company: "",
    emails: [],
    phones: [],
    address: { street: "", city: "", state: "", postal: "", country: "" },
    tags: [],
    notes: "",
    source: "",
    custom: [],
    flags: [],
    importable: true,
  };

  let fullName = "";
  const notes: string[] = [];

  for (const column of mapping) {
    const value = (cells[column.index] ?? "").trim();
    if (column.field === "skip") continue;
    if (value.length === 0) continue;

    switch (column.field) {
      case "firstName":
        row.firstName = value;
        break;
      case "lastName":
        row.lastName = value;
        break;
      case "fullName":
        fullName = value;
        break;
      case "company":
        row.company = value;
        break;
      case "email": {
        const normalized = normalizeEmail(value);
        const valid = isValidEmail(value);
        if (!valid) {
          row.flags.push({
            level: "warning",
            message: `"${value}" does not look like an email address. It will be saved as typed.`,
            column: column.header,
          });
        }
        if (!row.emails.some((e) => e.email === normalized.lower)) {
          row.emails.push({
            email: normalized.lower,
            label: column.label ?? "work",
            valid,
          });
        }
        break;
      }
      case "phone": {
        const normalized = normalizePhone(value, options.region);
        if (normalized.e164 === null) {
          row.flags.push({
            level: "warning",
            message: `"${value}" is not a phone number Helix can dial. It will be saved exactly as typed.`,
            column: column.header,
          });
        }
        const already = row.phones.some(
          (p) =>
            (normalized.e164 !== null && p.e164 === normalized.e164) ||
            p.raw === normalized.raw,
        );
        if (!already) {
          row.phones.push({
            raw: normalized.raw,
            e164: normalized.e164,
            label: column.label ?? "phone",
          });
        }
        break;
      }
      case "street":
        row.address.street = value;
        break;
      case "city":
        row.address.city = value;
        break;
      case "state":
        row.address.state = value;
        break;
      case "postal":
        row.address.postal = value;
        break;
      case "country":
        row.address.country = value;
        break;
      case "tags":
        for (const tag of splitTags(value)) {
          if (!row.tags.includes(tag)) row.tags.push(tag);
        }
        break;
      case "notes":
        notes.push(mapping.filter((m) => m.field === "notes").length > 1
          ? `${column.header}: ${value}`
          : value);
        break;
      case "source":
        row.source = value;
        break;
      case "custom":
        row.custom.push({ name: column.customName ?? column.header, value });
        break;
    }
  }

  if (fullName.length > 0 && row.firstName.length === 0 && row.lastName.length === 0) {
    const split = splitFullName(fullName);
    row.firstName = split.firstName;
    row.lastName = split.lastName;
  }
  row.notes = notes.join("\n");

  const hasName = row.firstName.length > 0 || row.lastName.length > 0;
  if (!hasName && row.company.length === 0 && row.emails.length === 0 && row.phones.length === 0) {
    row.importable = false;
    row.flags.push({
      level: "error",
      message: "Nothing to file this row under: no name, company, email or phone.",
    });
  } else if (!hasName) {
    row.flags.push({
      level: "warning",
      message: "No name on this row. Helix will file it under the company or the email.",
    });
  }

  return row;
}

/** The dedupe key: email first, then the E.164 phone (docs/PLAN.md item 9). */
export function dedupeKeyFor(row: MappedRow): { kind: "email" | "phone"; value: string } | null {
  const email = row.emails.find((e) => e.email.length > 0);
  if (email) return { kind: "email", value: email.email };
  const phone = row.phones.find((p) => p.e164 !== null);
  if (phone && phone.e164) return { kind: "phone", value: phone.e164 };
  return null;
}

/** Everything the owner mapped, for the "what will happen" line. */
export function mappingSummary(mapping: ColumnMapping[]): {
  mapped: number;
  skipped: number;
  custom: number;
  missing: FieldId[];
} {
  const mapped = mapping.filter((m) => m.field !== "skip");
  const present = new Set(mapped.map((m) => m.field));
  const wanted: FieldId[] = ["firstName", "lastName", "email", "phone", "company"];
  return {
    mapped: mapped.length,
    skipped: mapping.length - mapped.length,
    custom: mapped.filter((m) => m.field === "custom").length,
    missing: wanted.filter(
      (f) => !present.has(f) && !(f === "firstName" && present.has("fullName")),
    ),
  };
}
