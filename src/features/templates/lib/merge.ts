/**
 * Merge fields: turning a stored template into one message for one customer.
 *
 * Pure. Nothing here reads the database - the caller collects the values (see
 * `values.ts`) and this module does the substitution, which is what makes the
 * live preview on the Templates screen and the real send use exactly the same
 * code path.
 *
 * Three rules, and each one exists because of a way this goes wrong:
 *
 * 1. **One pass.** Substitution is a single regex pass with a replacer
 *    function, so a value that itself contains "{{first_name}}" is inserted as
 *    text and never expanded again. A template cannot be made to loop, and a
 *    customer whose company is literally named "{{business_name}}" gets their
 *    own name back.
 * 2. **A known field with no value renders as nothing**, not as the field name
 *    and not as "undefined". A deal that has no title is a blank, and the
 *    tidy-up below closes the gap it leaves.
 * 3. **An unknown field is left exactly as it was typed.** "{{firstname}}" is
 *    a typo, and a message that silently drops it teaches the owner nothing;
 *    the editor warns about it and the preview shows it, so he can see it.
 */

/** Every field a template may use. Adding one here is all it takes. */
export const MERGE_FIELDS = [
  "first_name",
  "last_name",
  "company",
  "deal_title",
  "deal_value",
  "owner_name",
  "business_name",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export type MergeValues = Partial<Record<MergeField, string | null>>;

/** What each field is, in the owner's words. The editor lists these. */
export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  first_name: "The customer's first name",
  last_name: "The customer's last name",
  company: "The company they belong to",
  deal_title: "The job this is about",
  deal_value: "What the job is worth",
  owner_name: "Your name",
  business_name: "Your business name",
};

const FIELD_SET = new Set<string>(MERGE_FIELDS);

/**
 * `{{ field }}` with optional inner spaces, and nothing else: no filters, no
 * expressions, no nesting. A template language is not what this is.
 */
const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export function isMergeField(name: string): name is MergeField {
  return FIELD_SET.has(name.toLowerCase());
}

/** The recognised fields a body uses, in first-appearance order, deduplicated. */
export function mergeFieldsIn(body: string): MergeField[] {
  const seen: MergeField[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1].toLowerCase();
    if (isMergeField(name) && !seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** Anything in double braces that is not a field Helix knows: a typo. */
export function unknownFieldsIn(body: string): string[] {
  const seen: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (!isMergeField(name) && !seen.includes(name)) seen.push(name);
  }
  return seen;
}

/**
 * Close the gaps an empty field leaves.
 *
 * "the quote for  at ." is what you get when a deal has no title, and it is
 * the tell that a message was generated. Runs of spaces collapse to one and
 * trailing spaces come off each line; line breaks are left alone, because the
 * paragraphs in an email template are deliberate.
 */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""))
    .join("\n");
}

/**
 * Render one template body against one customer's values.
 *
 * `tidy` is on by default and can be turned off for a test that wants to see
 * the raw substitution.
 */
export function renderTemplate(
  body: string,
  values: MergeValues,
  options: { tidy?: boolean } = {},
): string {
  const substituted = body.replace(PLACEHOLDER, (whole, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!isMergeField(name)) return whole;
    const value = values[name];
    return value === null || value === undefined ? "" : value;
  });
  return options.tidy === false ? substituted : tidy(substituted);
}

/**
 * The made-up customer the Templates screen previews against, so the owner can
 * see what a template looks like before he has anybody to send it to.
 *
 * A real-looking Utah name and a real-looking number, because a preview full of
 * "Lorem" or "{{first_name}}" does not tell him whether the wording reads
 * right.
 */
export const SAMPLE_VALUES: MergeValues = {
  first_name: "Nella",
  last_name: "Okonkwo",
  company: "Mountain Shadows Assisted Living",
  deal_title: "Fall cleanup, 32 units",
  deal_value: "$6,780.00",
  owner_name: "Dale",
  business_name: "Alpine Ridge Landscape",
};
