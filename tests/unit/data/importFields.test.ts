/**
 * Cross-checks over every `ImportTypeDefinition` in features/data/import/fields
 * - Contacts, Companies, Deals and Services - covering the properties the
 * wizard, the example-file generator and the mapping guesser all assume hold
 * for every field, without each of them having to re-check.
 *
 *   - keys are unique, labels and aliases are non-empty
 *   - aliases are already in the normalised form the guesser compares against
 *   - no two fields on the same type fight over the same alias
 *   - exactly one required field, and it leads the list
 *   - every example cell parses cleanly - this is the property the
 *     downloadable example CSV depends on: 100% auto-mapped, zero warnings
 */
import { describe, expect, it } from "vitest";
import { normalizeHeader } from "../../../src/features/data/lib/mapping";
import { parseCell } from "../../../src/features/data/import/fields/parsers";
import { COMPANIES_IMPORT } from "../../../src/features/data/import/fields/companies";
import { SERVICES_IMPORT } from "../../../src/features/data/import/fields/services";
import { IMPORT_TYPES } from "../../../src/features/data/import/fields/index";
import type {
  Draft,
  FieldDefinition,
  ImportTypeDefinition,
} from "../../../src/features/data/import/fields/types";

/** Everything on the first step's radio list, so no type can drift unchecked. */
const TYPES: readonly ImportTypeDefinition[] = IMPORT_TYPES;

describe.each(TYPES.map((t) => [t.label, t] as const))("%s fields", (_label, type) => {
  it("has a unique, non-empty key and label on every field", () => {
    const keys = new Set<string>();
    for (const field of type.fields) {
      expect(field.key.trim().length).toBeGreaterThan(0);
      expect(field.label.trim().length).toBeGreaterThan(0);
      expect(keys.has(field.key)).toBe(false);
      keys.add(field.key);
    }
  });

  it("gives every field at least one alias", () => {
    for (const field of type.fields) {
      expect(field.aliases.length).toBeGreaterThan(0);
    }
  });

  it("gives every field exactly three example cells", () => {
    for (const field of type.fields) {
      expect(field.examples).toHaveLength(3);
    }
    // At least one cell of the type has to say something, or the example file
    // is a header row and three blank lines. A single field may legitimately
    // be blank in all three - a deal that was never lost has no lost date.
    const filled = type.fields.flatMap((f) => f.examples).filter((c) => c.trim().length > 0);
    expect(filled.length).toBeGreaterThanOrEqual(type.fields.length);
  });

  it("writes every alias already in normalizeHeader's form", () => {
    for (const field of type.fields) {
      for (const alias of field.aliases) {
        expect(normalizeHeader(alias)).toBe(alias);
      }
    }
  });

  it("never lets two fields claim the same alias", () => {
    const owner = new Map<string, string>();
    for (const field of type.fields) {
      for (const alias of field.aliases) {
        const clash = owner.get(alias);
        expect(clash === undefined || clash === field.key).toBe(true);
        owner.set(alias, field.key);
      }
    }
  });

  it("has exactly one required field, and it comes first", () => {
    const required = type.fields.filter((f) => f.required === true);
    expect(required).toHaveLength(1);
    expect(type.fields[0]?.required).toBe(true);
    expect(type.fields[0]?.key).toBe(required[0]?.key);
  });

  it("parses every filled example cell cleanly (no null, no warning)", () => {
    for (const field of type.fields) {
      for (const example of field.examples) {
        if (example.trim().length === 0) continue;
        const result = parseCell(field, example);
        expect(result.value, `${type.id}.${field.key} example "${example}"`).not.toBeNull();
        expect(
          result.warning,
          `${type.id}.${field.key} example "${example}" warned: ${result.warning}`,
        ).toBeUndefined();
      }
    }
  });

  it("round-trips every choice field's declared values through parseCell", () => {
    for (const field of type.fields) {
      if (field.parser !== "choice") continue;
      for (const choice of field.choices ?? []) {
        const result = parseCell(field, choice.value);
        expect(result.value).toBe(choice.value);
        expect(result.warning).toBeUndefined();
      }
    }
  });
});

describe("companies tags field", () => {
  const tagsField = COMPANIES_IMPORT.fields.find((f) => f.key === "tags") as FieldDefinition;

  it("has a custom writer", () => {
    expect(tagsField).toBeDefined();
    expect(typeof tagsField.write).toBe("function");
  });

  it("splits a cell into the tags array on the draft", () => {
    const draft: Draft = {};
    tagsField.write!(draft, "unused", "Plumbing; Repeat customer");
    expect(draft.tags).toEqual(["Plumbing", "Repeat customer"]);
  });

  it("does not duplicate a tag already on the draft, across columns or rows", () => {
    const draft: Draft = {};
    tagsField.write!(draft, "unused", "Plumbing; Repeat customer");
    tagsField.write!(draft, "unused", "Repeat customer; Referral");
    expect(draft.tags).toEqual(["Plumbing", "Repeat customer", "Referral"]);
  });
});

describe("the register", () => {
  it("offers contacts, companies, deals and services, in that order", () => {
    expect(IMPORT_TYPES.map((t) => t.id)).toEqual([
      "contacts",
      "companies",
      "deals",
      "services",
    ]);
  });

  it("keeps the services columns the catalog expects", () => {
    expect(SERVICES_IMPORT.fields.map((f) => f.key)).toEqual([
      "name",
      "description",
      "price",
      "billing",
      "taxable",
    ]);
  });

  it("gives every type a file name, a noun and a sentence of its own", () => {
    for (const type of IMPORT_TYPES) {
      expect(type.exampleFileName).toMatch(/^helix-[a-z]+-example\.csv$/);
      expect(type.noun.trim().length).toBeGreaterThan(0);
      expect(type.hint.trim().length).toBeGreaterThan(0);
    }
  });
});
