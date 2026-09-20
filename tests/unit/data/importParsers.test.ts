/**
 * Every parser in features/data/import/fields/parsers.ts, cell by cell.
 *
 * These parsers back the generic import wizard (Companies, Deals, Services):
 * a parser must never throw, and a cell it cannot make sense of comes back
 * as `{ value: null, warning: "..." }` (or, for phone/email, the raw text
 * plus a warning) rather than failing the row. That contract is what these
 * tests hold the line on.
 */
import { describe, expect, it } from "vitest";
import {
  parseCell,
  parseChoice,
  parseDate,
  parseEmail,
  parseMoney,
  parsePhone,
  parseTags,
  parseText,
  splitTagCell,
} from "../../../src/features/data/import/fields/parsers";
import type { FieldDefinition } from "../../../src/features/data/import/fields/types";

const BILLING_CHOICES = [
  { value: "One-time", aliases: ["one time", "once", "onetime", "single", "fixed", "flat"] },
  { value: "Monthly", aliases: ["month", "per month", "monthly", "recurring monthly", "mo"] },
  { value: "Yearly", aliases: ["year", "per year", "yearly", "annual", "annually", "yr"] },
];

/** A minimal, otherwise-unused field of a given parser kind, for parseCell. */
function fieldOf(parser: FieldDefinition["parser"], extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    key: "test",
    label: "Test",
    aliases: ["test"],
    parser,
    examples: ["a", "b", "c"],
    ...extra,
  };
}

describe("parseText", () => {
  it("collapses internal and outer whitespace", () => {
    expect(parseText("  hello    world  ")).toEqual({ value: "hello world" });
  });

  it("returns null, no warning, for an empty cell", () => {
    expect(parseText("")).toEqual({ value: null });
    expect(parseText("   ")).toEqual({ value: null });
  });
});

describe("parseMoney", () => {
  it("reads a dollar amount with thousands and a decimal", () => {
    expect(parseMoney("$12,500.00").value).toBe(1250000);
  });

  it("reads a bare integer as whole units", () => {
    expect(parseMoney("12500").value).toBe(1250000);
  });

  it("reads a European-style amount (dot thousands, comma decimal)", () => {
    expect(parseMoney("1.250,00").value).toBe(125000);
  });

  it("reads parenthesised text as negative", () => {
    expect(parseMoney("(250)").value).toBe(-25000);
  });

  it("returns null with no warning for an empty cell", () => {
    expect(parseMoney("")).toEqual({ value: null });
  });

  it("leaves an unparseable amount at null, with a warning", () => {
    const result = parseMoney("call for quote");
    expect(result.value).toBeNull();
    expect(result.warning).toBeTruthy();
  });
});

describe("parseDate", () => {
  const cases: [string, string][] = [
    ["2026-03-14", "2026-03-14"],
    ["2026-03-14T09:00:00Z", "2026-03-14"],
    ["3/14/2026", "2026-03-14"],
    ["03-14-26", "2026-03-14"],
    ["14/3/2026", "2026-03-14"], // day-first flip: 14 cannot be a month
    ["14.03.2026", "2026-03-14"],
    ["Mar 14, 2026", "2026-03-14"],
    ["March 14 2026", "2026-03-14"],
    ["14 Mar 2026", "2026-03-14"],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${expected}`, () => {
      expect(parseDate(input)).toEqual({ value: expected });
    });
  }

  it("rejects a calendar date that does not exist, with a warning", () => {
    const result = parseDate("2026-02-31");
    expect(result.value).toBeNull();
    expect(result.warning).toBeTruthy();
  });

  it("rejects unreadable text, with a warning", () => {
    const result = parseDate("sometime in spring");
    expect(result.value).toBeNull();
    expect(result.warning).toBeTruthy();
  });

  it("returns null with no warning for an empty cell", () => {
    expect(parseDate("")).toEqual({ value: null });
  });
});

describe("parsePhone", () => {
  it("normalizes a dashed US number to E.164", () => {
    expect(parsePhone("801-555-0142")).toEqual({ value: "+18015550142" });
  });

  it("normalizes a parenthesised US number to E.164", () => {
    expect(parsePhone("(385) 555-0199")).toEqual({ value: "+13855550199" });
  });

  it("keeps the raw text and warns when it cannot dial the cell", () => {
    const result = parsePhone("ask for Dave");
    expect(result.value).toBe("ask for Dave");
    expect(result.warning).toBeTruthy();
  });
});

describe("parseEmail", () => {
  it("lowercases the address", () => {
    expect(parseEmail("SARAH@WASATCHPEAK.EXAMPLE")).toEqual({
      value: "sarah@wasatchpeak.example",
    });
  });

  it("still returns a value for something that is not an email, with a warning", () => {
    const result = parseEmail("not-an-email");
    expect(result.value).toBe("not-an-email");
    expect(result.warning).toBeTruthy();
  });
});

describe("parseChoice", () => {
  it("matches a choice's own value", () => {
    expect(parseChoice("Monthly", BILLING_CHOICES)).toEqual({ value: "Monthly" });
  });

  it("matches on an alias", () => {
    expect(parseChoice("mo", BILLING_CHOICES)).toEqual({ value: "Monthly" });
  });

  it("is case- and punctuation-insensitive", () => {
    expect(parseChoice("MONTHLY!!", BILLING_CHOICES)).toEqual({ value: "Monthly" });
    expect(parseChoice("one-time", BILLING_CHOICES)).toEqual({ value: "One-time" });
  });

  it("falls back to the first choice, with a warning, for an unknown cell", () => {
    const result = parseChoice("whenever suits", BILLING_CHOICES, "billing");
    expect(result.value).toBe("One-time");
    expect(result.warning).toBeTruthy();
  });

  it("returns null with no warning for an empty cell", () => {
    expect(parseChoice("", BILLING_CHOICES)).toEqual({ value: null });
  });
});

describe("splitTagCell", () => {
  it("splits on semicolons", () => {
    expect(splitTagCell("Repeat; Referral")).toEqual(["Repeat", "Referral"]);
  });

  it("splits on commas", () => {
    expect(splitTagCell("Repeat, Referral")).toEqual(["Repeat", "Referral"]);
  });

  it("strips a leading star and splits on ':::' the way Google writes it", () => {
    expect(splitTagCell("* myContacts ::: Suppliers")).toEqual(["myContacts", "Suppliers"]);
  });

  it("drops blanks from doubled separators", () => {
    expect(splitTagCell("Repeat,, Referral,")).toEqual(["Repeat", "Referral"]);
  });
});

describe("parseTags", () => {
  it("joins the split tags back with a semicolon", () => {
    expect(parseTags("Repeat; Referral")).toEqual({ value: "Repeat;Referral" });
  });

  it("returns null with no warning for an empty cell", () => {
    expect(parseTags("")).toEqual({ value: null });
  });
});

describe("parseCell", () => {
  it("routes a text field to parseText", () => {
    expect(parseCell(fieldOf("text"), "  hi  ")).toEqual(parseText("  hi  "));
  });

  it("routes a money field to parseMoney, using the field's label", () => {
    const field = fieldOf("money", { label: "Price" });
    expect(parseCell(field, "call for quote")).toEqual(parseMoney("call for quote", "price"));
  });

  it("routes a date field to parseDate", () => {
    expect(parseCell(fieldOf("date"), "3/14/2026")).toEqual(parseDate("3/14/2026"));
  });

  it("routes a phone field to parsePhone", () => {
    expect(parseCell(fieldOf("phone"), "801-555-0142")).toEqual(parsePhone("801-555-0142"));
  });

  it("routes an email field to parseEmail", () => {
    expect(parseCell(fieldOf("email"), "A@B.example")).toEqual(parseEmail("A@B.example"));
  });

  it("routes a choice field to parseChoice, using its own choices and label", () => {
    const field = fieldOf("choice", { label: "Billing", choices: BILLING_CHOICES });
    expect(parseCell(field, "mo")).toEqual(parseChoice("mo", BILLING_CHOICES, "billing"));
  });

  it("routes a tags field to parseTags", () => {
    expect(parseCell(fieldOf("tags"), "Repeat; Referral")).toEqual(
      parseTags("Repeat; Referral"),
    );
  });
});
