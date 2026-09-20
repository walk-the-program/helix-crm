/**
 * Merge field rendering.
 *
 * Three behaviours are load-bearing and each has a failure mode a customer
 * would see: a missing value must render as nothing rather than as the field
 * name, a value that itself contains braces must not be expanded again, and a
 * field Helix does not know must survive untouched so the owner can see his own
 * typo.
 */
import { describe, expect, it } from "vitest";
import {
  MERGE_FIELDS,
  MERGE_FIELD_LABELS,
  SAMPLE_VALUES,
  isMergeField,
  mergeFieldsIn,
  renderTemplate,
  unknownFieldsIn,
} from "@/features/templates/lib/merge";

describe("renderTemplate: substitution", () => {
  it("replaces every known field", () => {
    const body =
      "Hi {{first_name}} {{last_name}} at {{company}}: {{deal_title}} is {{deal_value}}. {{owner_name}}, {{business_name}}";
    expect(renderTemplate(body, SAMPLE_VALUES)).toBe(
      "Hi Nella Okonkwo at Mountain Shadows Assisted Living: Fall cleanup, 32 units is $6,780.00. Dale, Alpine Ridge Landscape",
    );
  });

  it("replaces the same field wherever it appears", () => {
    expect(renderTemplate("{{first_name}}, {{first_name}}", { first_name: "Nella" })).toBe(
      "Nella, Nella",
    );
  });

  it("tolerates spaces inside the braces", () => {
    expect(renderTemplate("Hi {{ first_name }}", { first_name: "Nella" })).toBe("Hi Nella");
  });

  it("is case-insensitive about the field name", () => {
    expect(renderTemplate("Hi {{First_Name}}", { first_name: "Nella" })).toBe("Hi Nella");
  });
});

describe("renderTemplate: missing values", () => {
  it("renders a known field with no value as nothing", () => {
    expect(renderTemplate("Hi {{first_name}}.", {})).toBe("Hi .");
    expect(renderTemplate("Hi {{first_name}}.", { first_name: null })).toBe("Hi .");
    expect(renderTemplate("Hi {{first_name}}.", { first_name: "" })).toBe("Hi .");
  });

  it("never emits the words undefined or null", () => {
    const out = renderTemplate("{{first_name}}/{{deal_value}}/{{owner_name}}", {});
    expect(out).not.toMatch(/undefined|null/);
    expect(out).toBe("//");
  });

  it("closes the double space an empty field leaves in the middle of a line", () => {
    expect(renderTemplate("the quote for {{deal_title}} is ready", {})).toBe(
      "the quote for is ready",
    );
  });

  it("keeps deliberate line breaks while tidying trailing spaces", () => {
    const body = "Hi {{first_name}},\n\nThanks. {{deal_title}}\n{{owner_name}}";
    expect(renderTemplate(body, { first_name: "Nella", owner_name: "Dale" })).toBe(
      "Hi Nella,\n\nThanks.\nDale",
    );
  });

  it("leaves the raw substitution alone when tidying is off", () => {
    expect(
      renderTemplate("the quote for {{deal_title}} is ready", {}, { tidy: false }),
    ).toBe("the quote for  is ready");
  });
});

describe("renderTemplate: no re-expansion", () => {
  it("inserts a value containing braces as plain text", () => {
    // A customer whose company is literally named "{{business_name}}" gets that
    // back, not the business's own name.
    const out = renderTemplate("Hi {{first_name}}", {
      first_name: "{{business_name}}",
      business_name: "Alpine Ridge Landscape",
    });
    expect(out).toBe("Hi {{business_name}}");
  });

  it("cannot be made to loop through a self-referencing value", () => {
    const out = renderTemplate("{{first_name}}", { first_name: "{{first_name}}" });
    expect(out).toBe("{{first_name}}");
  });

  it("does not treat a dollar pattern in a value as a replacement group", () => {
    // String.replace would read "$&" in a replacement string as the match.
    const out = renderTemplate("Total {{deal_value}}", { deal_value: "$&$1" });
    expect(out).toBe("Total $&$1");
  });
});

describe("unknown fields", () => {
  it("leaves a field Helix does not know exactly as it was typed", () => {
    expect(renderTemplate("Hi {{firstname}}", { first_name: "Nella" })).toBe(
      "Hi {{firstname}}",
    );
  });

  it("lists the unknown fields so the editor can warn about them", () => {
    expect(unknownFieldsIn("{{first_name}} {{firstname}} {{nope}} {{nope}}")).toEqual([
      "firstname",
      "nope",
    ]);
    expect(unknownFieldsIn("{{first_name}}")).toEqual([]);
  });

  it("ignores a single brace and an unclosed placeholder", () => {
    expect(renderTemplate("{first_name} {{first_name", { first_name: "Nella" })).toBe(
      "{first_name} {{first_name",
    );
    expect(unknownFieldsIn("{first_name}")).toEqual([]);
  });
});

describe("mergeFieldsIn", () => {
  it("returns the known fields used, in order, without repeats", () => {
    expect(mergeFieldsIn("{{last_name}} {{first_name}} {{last_name}} {{nope}}")).toEqual([
      "last_name",
      "first_name",
    ]);
  });

  it("returns nothing for a body with no fields", () => {
    expect(mergeFieldsIn("Running about 20 minutes behind.")).toEqual([]);
  });
});

describe("the field list itself", () => {
  it("is the seven fields the product documents", () => {
    expect([...MERGE_FIELDS]).toEqual([
      "first_name",
      "last_name",
      "company",
      "deal_title",
      "deal_value",
      "owner_name",
      "business_name",
    ]);
  });

  it("labels every field, so the editor cannot show an empty tooltip", () => {
    for (const field of MERGE_FIELDS) {
      expect(MERGE_FIELD_LABELS[field].length).toBeGreaterThan(0);
    }
  });

  it("recognises exactly those names", () => {
    expect(isMergeField("first_name")).toBe(true);
    expect(isMergeField("FIRST_NAME")).toBe(true);
    expect(isMergeField("firstname")).toBe(false);
  });

  it("gives the preview a value for every field", () => {
    for (const field of MERGE_FIELDS) {
      expect(SAMPLE_VALUES[field]).toBeTruthy();
    }
  });
});
