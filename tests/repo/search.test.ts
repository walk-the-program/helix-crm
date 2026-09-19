import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import * as search from "../../src/db/repos/search";
import * as contacts from "../../src/db/repos/contacts";
import * as companies from "../../src/db/repos/companies";
import * as deals from "../../src/db/repos/deals";
import * as activities from "../../src/db/repos/activities";
import * as pipelines from "../../src/db/repos/pipelines";
import * as stages from "../../src/db/repos/stages";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const [stage] = await stages.list(pipeline.id);
  return stage.id;
}

describe("search: contacts findable on every field", () => {
  it("finds a contact by first name, last name, company name, email and phone", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Widgets Incorporated" });
    const contact = await contacts.create({
      firstName: "Jonathan",
      lastName: "Steelworth",
      companyId: company.id,
      emails: [{ email: "jonathan.steel@example.com" }],
      phones: [{ raw: "(415) 555-0177" }],
    });

    const byFirst = await search.search("Jonathan");
    expect(byFirst.map((hit) => hit.entityId)).toContain(contact.id);

    const byLast = await search.search("Steelworth");
    expect(byLast.map((hit) => hit.entityId)).toContain(contact.id);

    const byCompany = await search.search("Widgets");
    expect(byCompany.map((hit) => hit.entityId)).toContain(contact.id);

    const byEmail = await search.search("jonathan.steel");
    expect(byEmail.map((hit) => hit.entityId)).toContain(contact.id);

    // The unicode61 tokenizer splits on punctuation, so the raw phone is
    // indexed as separate tokens ("415", "555", "0177"); the E.164 form is
    // indexed as one token without the leading "+".
    const byRawPhone = await search.search("0177");
    expect(byRawPhone.map((hit) => hit.entityId)).toContain(contact.id);

    const byE164 = await search.search("14155550177");
    expect(byE164.map((hit) => hit.entityId)).toContain(contact.id);
  });
});

describe("search: soft delete and restore", () => {
  it("removes a soft-deleted contact from results and brings it back on restore", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Findable", lastName: "Person" });

    expect((await search.search("Findable")).map((hit) => hit.entityId)).toContain(
      contact.id,
    );

    await contacts.softDelete(contact.id);
    expect((await search.search("Findable")).map((hit) => hit.entityId)).not.toContain(
      contact.id,
    );

    await contacts.restore(contact.id);
    expect((await search.search("Findable")).map((hit) => hit.entityId)).toContain(
      contact.id,
    );
  });
});

describe("search: phone change rebuilds the contact document", () => {
  it("stops matching the old number and starts matching the new one", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({
      firstName: "Phone",
      lastName: "Changer",
      phones: [{ raw: "(415) 555-0188", isPrimary: true }],
    });
    const [phone] = contact.phones;

    expect((await search.search("0188")).map((hit) => hit.entityId)).toContain(
      contact.id,
    );

    await contacts.updatePhone(phone.id, { raw: "(212) 555-0199" });

    expect((await search.search("0188")).map((hit) => hit.entityId)).not.toContain(
      contact.id,
    );
    expect((await search.search("0199")).map((hit) => hit.entityId)).toContain(
      contact.id,
    );
  });
});

describe("search: company, deal and activity are each findable", () => {
  it("finds a company", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Distinctive Company Name" });
    const hits = await search.search("Distinctive");
    expect(hits.some((hit) => hit.entityType === "company" && hit.entityId === company.id)).toBe(
      true,
    );
  });

  it("finds a deal", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Uniquely Named Deal", stageId });
    const hits = await search.search("Uniquely");
    expect(hits.some((hit) => hit.entityType === "deal" && hit.entityId === deal.id)).toBe(
      true,
    );
  });

  it("finds an activity", async () => {
    h = await createSeededHarness();
    const activity = await activities.create({
      kind: "note",
      body: "A distinctively worded note about the roof inspection.",
    });
    const hits = await search.search("distinctively");
    expect(
      hits.some((hit) => hit.entityType === "activity" && hit.entityId === activity.id),
    ).toBe(true);
  });
});

describe("search: searchGrouped groups by entity type", () => {
  it("returns hits grouped by entity type", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    await contacts.create({ firstName: "Groupable", lastName: "Contact" });
    await companies.create({ name: "Groupable Company" });
    await deals.create({ title: "Groupable Deal", stageId });

    const groups = await search.searchGrouped("Groupable");
    const types = groups.map((g) => g.entityType);
    expect(types).toContain("contact");
    expect(types).toContain("company");
    expect(types).toContain("deal");
    for (const group of groups) {
      for (const hit of group.hits) {
        expect(hit.entityType).toBe(group.entityType);
      }
    }
  });
});

describe("search: diacritics", () => {
  it("finds 'José' when searching 'Jose'", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "José", lastName: "García" });
    const hits = await search.search("Jose");
    expect(hits.map((hit) => hit.entityId)).toContain(contact.id);
  });
});

describe("search: query sanitisation", () => {
  it("does not throw on a query containing a double quote or a hyphen", async () => {
    h = await createSeededHarness();
    await contacts.create({ firstName: "Anne", lastName: "O'Brien-Smith" });

    const withQuote = await search.search(`o"brien`);
    expect(Array.isArray(withQuote)).toBe(true);

    const withHyphen = await search.search("anne-marie");
    expect(Array.isArray(withHyphen)).toBe(true);

    const withBoth = await search.search('"quoted" -text');
    expect(Array.isArray(withBoth)).toBe(true);
  });
});
