/**
 * The mapping guesses, checked against the header rows of every fixture, plus
 * the row-level mapping and the dedupe key.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHeaders, sniffCsv } from "../../../src/lib/csv";
import {
  applyMapping,
  applyRemembered,
  addressJsonFor,
  dedupeKeyFor,
  guessMapping,
  headerSignature,
  looksLikeDealColumn,
  mappingSummary,
  normalizeHeader,
  splitFullName,
  splitTags,
  toRemembered,
  type ColumnMapping,
  type FieldId,
} from "../../../src/features/data/lib/mapping";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "..", "fixtures");

function headersOf(...names: string[]): string[] {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, ...names)));
  return readHeaders(sniffCsv(bytes).text).headers;
}

/** field -> the headers guessed for it. */
function guessed(headers: string[]): Map<FieldId, string[]> {
  const out = new Map<FieldId, string[]>();
  for (const column of guessMapping(headers)) {
    const list = out.get(column.field) ?? [];
    list.push(column.header);
    out.set(column.field, list);
  }
  return out;
}

describe("normalizeHeader", () => {
  it("flattens punctuation and case", () => {
    expect(normalizeHeader("E-mail 1 - Value")).toBe("e mail 1 value");
    expect(normalizeHeader("State/Region")).toBe("state region");
    expect(normalizeHeader("  Person - Name  ")).toBe("person name");
  });
});

describe("guessing a HubSpot export", () => {
  const map = guessed(headersOf("hubspot-contacts.csv"));

  it("finds the names, company and address", () => {
    expect(map.get("firstName")).toEqual(["First Name"]);
    expect(map.get("lastName")).toEqual(["Last Name"]);
    expect(map.get("company")).toEqual(["Associated Company"]);
    expect(map.get("city")).toEqual(["City"]);
    expect(map.get("state")).toEqual(["State/Region"]);
    expect(map.get("postal")).toEqual(["Postal Code"]);
    expect(map.get("country")).toEqual(["Country/Region"]);
  });

  it("takes both phone columns and the email", () => {
    expect(map.get("phone")).toEqual(["Phone Number", "Mobile Phone Number"]);
    expect(map.get("email")).toEqual(["Email"]);
  });

  it("leaves the internal columns alone", () => {
    const skipped = map.get("skip") ?? [];
    expect(skipped).toContain("Record ID");
    expect(skipped).toContain("Contact owner");
    expect(skipped).toContain("Create Date");
    expect(skipped).toContain("Job Title");
  });

  it("labels the mobile column as mobile", () => {
    const mobile = guessMapping(headersOf("hubspot-contacts.csv")).find(
      (c) => c.header === "Mobile Phone Number",
    );
    expect(mobile?.label).toBe("mobile");
  });
});

describe("guessing a Zoho export", () => {
  const map = guessed(headersOf("zoho-contacts.csv"));

  it("maps the account name to company and the mailing address", () => {
    expect(map.get("company")).toEqual(["Account Name"]);
    expect(map.get("street")).toEqual(["Mailing Street"]);
    expect(map.get("city")).toEqual(["Mailing City"]);
    expect(map.get("state")).toEqual(["Mailing State"]);
    expect(map.get("postal")).toEqual(["Mailing Zip"]);
  });

  it("takes all three phone columns and the description as notes", () => {
    expect(map.get("phone")).toEqual(["Phone", "Home Phone", "Mobile"]);
    expect(map.get("notes")).toEqual(["Description"]);
    expect(map.get("tags")).toEqual(["Tag"]);
  });

  it("does not import the job title or the department", () => {
    const skipped = map.get("skip") ?? [];
    expect(skipped).toContain("Title");
    expect(skipped).toContain("Department");
  });
});

describe("guessing a Pipedrive export", () => {
  const map = guessed(headersOf("pipedrive-persons.csv"));

  it("recognises the single full-name column", () => {
    expect(map.get("fullName")).toEqual(["Person - Name"]);
    expect(map.get("firstName")).toBeUndefined();
  });

  it("takes both emails and both phones", () => {
    expect(map.get("email")).toEqual([
      "Person - Email - Work",
      "Person - Email - Home",
    ]);
    expect(map.get("phone")).toEqual([
      "Person - Phone - Work",
      "Person - Phone - Mobile",
    ]);
  });

  it("maps the organisation, the label and the notes", () => {
    expect(map.get("company")).toEqual(["Person - Organization"]);
    expect(map.get("tags")).toEqual(["Person - Label"]);
    expect(map.get("notes")).toEqual(["Person - Notes"]);
    expect(map.get("street")).toEqual(["Person - Address"]);
  });

  it("skips the deal columns, because v1 does not import deals", () => {
    const skipped = map.get("skip") ?? [];
    expect(skipped).toContain("Person - Open deals");
    expect(skipped).toContain("Person - Won deals");
  });
});

describe("guessing a Google Contacts export", () => {
  const headers = headersOf("google-contacts.csv");
  const map = guessed(headers);

  it("never mistakes a phonetic column for a name", () => {
    const phonetic = guessMapping(headers).filter((c) =>
      c.header.startsWith("Phonetic"),
    );
    expect(phonetic).toHaveLength(3);
    for (const column of phonetic) expect(column.field).toBe("skip");
    expect(map.get("firstName")).toEqual(["First Name"]);
    expect(map.get("lastName")).toEqual(["Last Name"]);
  });

  it("takes the email value column but not its label column", () => {
    expect(map.get("email")).toEqual(["E-mail 1 - Value"]);
    const label = guessMapping(headers).find((c) => c.header === "E-mail 1 - Label");
    expect(label?.field).toBe("skip");
  });

  it("takes both phone value columns", () => {
    expect(map.get("phone")).toEqual(["Phone 1 - Value", "Phone 2 - Value"]);
  });

  it("uses Labels as tags and Organization Name as the company", () => {
    expect(map.get("tags")).toEqual(["Labels"]);
    expect(map.get("company")).toEqual(["Organization Name"]);
  });

  it("only takes one street column when the file has several candidates", () => {
    expect(map.get("street")).toHaveLength(1);
  });
});

describe("guessing an Excel save-as", () => {
  const headers = headersOf("excel-saveas.csv");
  const map = guessed(headers);

  it("reads the loose spreadsheet headers", () => {
    expect(map.get("fullName")).toEqual(["Name"]);
    expect(map.get("company")).toEqual(["Business"]);
    expect(map.get("phone")).toEqual(["Phone"]);
    expect(map.get("email")).toEqual(["Email"]);
    expect(map.get("street")).toEqual(["Address"]);
    expect(map.get("state")).toEqual(["ST"]);
    expect(map.get("postal")).toEqual(["Zip"]);
    expect(map.get("notes")).toEqual(["Notes"]);
  });

  it("skips Excel's two phantom trailing columns", () => {
    const trailing = guessMapping(headers).slice(-2);
    for (const column of trailing) {
      expect(column.header).toBe("");
      expect(column.field).toBe("skip");
    }
  });
});

describe("guessing Walker's ClearPath export", () => {
  const headers = headersOf("clearpath-prospects.csv");
  const map = guessed(headers);

  it("maps everything a contact needs", () => {
    expect(map.get("firstName")).toEqual(["First name"]);
    expect(map.get("lastName")).toEqual(["Last name"]);
    expect(map.get("company")).toEqual(["Company"]);
    expect(map.get("email")).toEqual(["Email"]);
    expect(map.get("phone")).toEqual(["Phone"]);
    expect(map.get("source")).toEqual(["Source"]);
    expect(map.get("tags")).toEqual(["Tags"]);
    expect(map.get("notes")).toEqual(["Notes"]);
  });

  it("flags the deal columns rather than importing them", () => {
    expect(looksLikeDealColumn("Deal title")).toBe(true);
    expect(looksLikeDealColumn("Deal stage")).toBe(true);
    expect(looksLikeDealColumn("Deal value")).toBe(true);
    expect(looksLikeDealColumn("Email")).toBe(false);
    const skipped = map.get("skip") ?? [];
    expect(skipped).toEqual(
      expect.arrayContaining(["Deal title", "Deal stage", "Deal value"]),
    );
  });
});

describe("header signatures and remembered mappings", () => {
  it("is stable for the same headers and different for others", () => {
    const a = headerSignature(["First Name", "Last Name"]);
    expect(headerSignature(["First Name", "Last Name"])).toBe(a);
    expect(headerSignature(["first name", "last name"])).toBe(a);
    expect(headerSignature(["Last Name", "First Name"])).not.toBe(a);
  });

  it("restores a remembered mapping by header, not by position", () => {
    const remembered = toRemembered(guessMapping(["First Name", "Email"]));
    const restored = applyRemembered(["Email", "First Name"], remembered);
    expect(restored[0].field).toBe("email");
    expect(restored[1].field).toBe("firstName");
    expect(restored[0].guessed).toBe(false);
  });

  it("leaves a column the remembered mapping never saw on skip", () => {
    const remembered = toRemembered(guessMapping(["First Name"]));
    const restored = applyRemembered(["First Name", "Nickname"], remembered);
    expect(restored[1].field).toBe("skip");
  });
});

describe("splitting", () => {
  it("splits a full name on the last space", () => {
    expect(splitFullName("Sarah J Mitchell")).toEqual({
      firstName: "Sarah J",
      lastName: "Mitchell",
    });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitFullName("  ")).toEqual({ firstName: "", lastName: "" });
  });

  it("understands the 'Last, First' form", () => {
    expect(splitFullName("Mitchell, Sarah")).toEqual({
      firstName: "Sarah",
      lastName: "Mitchell",
    });
  });

  it("splits tags on commas, semicolons and Google's separator", () => {
    expect(splitTags("clearpath;landscaping;outreach_ready")).toEqual([
      "clearpath",
      "landscaping",
      "outreach_ready",
    ]);
    expect(splitTags("* myContacts ::: Suppliers")).toEqual([
      "myContacts",
      "Suppliers",
    ]);
    expect(splitTags("  ")).toEqual([]);
  });
});

describe("applying a mapping to a row", () => {
  const headers = ["First Name", "Last Name", "Company", "Email", "Mobile", "City", "Tags"];
  const mapping = guessMapping(headers);

  it("fills the fields and normalises the phone", () => {
    const row = applyMapping(
      ["Sarah", "Mitchell", "Sandy Landscape Co", "SARAH@Example.com", "801.555.0142", "Provo", "vip;landscaping"],
      mapping,
      2,
    );
    expect(row.firstName).toBe("Sarah");
    expect(row.company).toBe("Sandy Landscape Co");
    expect(row.emails[0]).toMatchObject({ email: "sarah@example.com", valid: true });
    expect(row.phones[0].e164).toBe("+18015550142");
    expect(row.phones[0].label).toBe("mobile");
    expect(row.address.city).toBe("Provo");
    expect(row.tags).toEqual(["vip", "landscaping"]);
    expect(row.importable).toBe(true);
    expect(row.flags).toHaveLength(0);
  });

  it("warns but still imports an unparseable phone and a bad email", () => {
    const row = applyMapping(
      ["Dave", "", "", "not-an-email", "call the shop", "", ""],
      mapping,
      3,
    );
    expect(row.importable).toBe(true);
    expect(row.phones[0].e164).toBeNull();
    expect(row.phones[0].raw).toBe("call the shop");
    expect(row.flags.map((f) => f.level)).toEqual(["warning", "warning"]);
  });

  it("refuses a row with nothing to file it under", () => {
    const row = applyMapping(["", "", "", "", "", "Provo", ""], mapping, 4);
    expect(row.importable).toBe(false);
    expect(row.flags[0].level).toBe("error");
  });

  it("files a company-only row (Walker's export has several)", () => {
    const row = applyMapping(
      ["", "", "Ironwood Landscaping", "ironwood@example.com", "", "Sandy", ""],
      mapping,
      5,
    );
    expect(row.importable).toBe(true);
    expect(row.flags.map((f) => f.level)).toEqual(["warning"]);
  });

  it("does not repeat the same email twice", () => {
    const twoEmails = guessMapping(["Email", "E-mail 2 - Value"]);
    const row = applyMapping(["a@b.com", "A@B.com"], twoEmails, 6);
    expect(row.emails).toHaveLength(1);
  });

  it("splits a full name only when there is no first or last column", () => {
    const full = guessMapping(["Name", "Email"]);
    const row = applyMapping(["Thomas Nguyen", "t@example.com"], full, 7);
    expect(row.firstName).toBe("Thomas");
    expect(row.lastName).toBe("Nguyen");
  });

  it("writes the address parts it has as JSON, and null when it has none", () => {
    expect(addressJsonFor({ street: "", city: "", state: "", postal: "", country: "" })).toBeNull();
    expect(
      addressJsonFor({ street: "1 Main", city: "Provo", state: "UT", postal: "", country: "" }),
    ).toBe('{"street":"1 Main","city":"Provo","state":"UT"}');
  });

  it("puts a custom column under the name the owner chose", () => {
    const custom: ColumnMapping[] = [
      { header: "Roof type", index: 0, field: "custom", customName: "Roof type", guessed: false },
    ];
    const row = applyMapping(["Asphalt"], custom, 8);
    expect(row.custom).toEqual([{ name: "Roof type", value: "Asphalt" }]);
  });
});

describe("the dedupe key", () => {
  const mapping = guessMapping(["Email", "Phone", "First Name"]);

  it("prefers the email", () => {
    const row = applyMapping(["a@b.com", "801-555-0142", "Ann"], mapping, 2);
    expect(dedupeKeyFor(row)).toEqual({ kind: "email", value: "a@b.com" });
  });

  it("falls back to the E.164 phone", () => {
    const row = applyMapping(["", "801-555-0142", "Ann"], mapping, 2);
    expect(dedupeKeyFor(row)).toEqual({ kind: "phone", value: "+18015550142" });
  });

  it("is null when there is neither", () => {
    const row = applyMapping(["", "", "Ann"], mapping, 2);
    expect(dedupeKeyFor(row)).toBeNull();
  });

  it("is null when the only phone cannot be normalised", () => {
    const row = applyMapping(["", "ask at the desk", "Ann"], mapping, 2);
    expect(dedupeKeyFor(row)).toBeNull();
  });
});

describe("mappingSummary", () => {
  it("counts what is mapped and names what is missing", () => {
    const summary = mappingSummary(guessMapping(["First Name", "Email", "Record ID"]));
    expect(summary.mapped).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.missing).toEqual(["lastName", "phone", "company"]);
  });
});
