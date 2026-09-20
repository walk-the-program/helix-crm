/**
 * The type-ahead searches behind every contact, company and service picker.
 *
 * These run against the real migrations, so the FTS triggers are live and the
 * tests cover the union of the index pass and the LIKE pass.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as products from "../../../src/db/repos/products";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function seedPeople() {
  h = await createHarness();
  const acme = await companies.create({
    name: "Acme Roofing",
    website: "acmeroofing.example",
    phone: "(415) 555-0199",
  });
  const priyaCo = await companies.create({ name: "Priority Gutters" });
  const priya = await contacts.create({
    firstName: "Priya",
    lastName: "Raman",
    companyId: acme.id,
    emails: [{ email: "Priya@Acme.example", label: "work", isPrimary: true }],
    phones: [{ raw: "(415) 555-0132", label: "mobile", isPrimary: true }],
  });
  const raman = await contacts.create({
    firstName: "Tom",
    lastName: "Ramanathan",
    emails: [{ email: "tom@elsewhere.example", label: "work", isPrimary: true }],
  });
  const other = await contacts.create({
    firstName: "Dale",
    lastName: "Winters",
    companyId: priyaCo.id,
  });
  return { acme, priyaCo, priya, raman, other };
}

describe("contacts.search", () => {
  it("finds a contact from a name prefix and ranks the prefix first", async () => {
    const { priya } = await seedPeople();
    const rows = await contacts.search("Pri");
    expect(rows[0].id).toBe(priya.id);
    expect(rows[0].label).toBe("Priya Raman");
  });

  it("carries the contact's company so the picker can fill it", async () => {
    const { priya, acme } = await seedPeople();
    const rows = await contacts.search("Priya");
    const hit = rows.find((r) => r.id === priya.id);
    expect(hit?.companyId).toBe(acme.id);
    expect(hit?.companyName).toBe("Acme Roofing");
    expect(hit?.detail).toBe("Acme Roofing");
  });

  it("ranks a name prefix above a match inside a word above a company match", async () => {
    const { priya, raman, other } = await seedPeople();
    const rows = await contacts.search("Ram");
    const order = rows.map((r) => r.id);
    // "Raman" starts the last name (word prefix); "Ramanathan" likewise, so
    // both beat Dale Winters, who only matches through Priority Gutters.
    expect(order.slice(0, 2).sort()).toEqual([priya.id, raman.id].sort());
    expect(order).not.toContain(other.id);
  });

  it("matches an email", async () => {
    const { priya } = await seedPeople();
    const rows = await contacts.search("priya@acme");
    expect(rows.map((r) => r.id)).toContain(priya.id);
  });

  it("matches a phone however it is typed", async () => {
    const { priya } = await seedPeople();
    for (const typed of ["555-0132", "4155550132", "(415) 555-0132"]) {
      const rows = await contacts.search(typed);
      expect(rows.map((r) => r.id), typed).toContain(priya.id);
    }
  });

  it("matches the company name", async () => {
    const { priya } = await seedPeople();
    const rows = await contacts.search("Acme");
    expect(rows.map((r) => r.id)).toContain(priya.id);
  });

  it("answers an empty query with the most recently touched contacts", async () => {
    const { other } = await seedPeople();
    await contacts.update(other.id, { notes: "touched last" });
    const rows = await contacts.search("");
    expect(rows[0].id).toBe(other.id);
  });

  it("honours the limit and never returns a deleted contact", async () => {
    const { priya } = await seedPeople();
    await contacts.softDelete(priya.id);
    expect((await contacts.search("Priya")).map((r) => r.id)).not.toContain(
      priya.id,
    );
    expect(await contacts.search("", 1)).toHaveLength(1);
  });

  it("treats LIKE wildcards as literal characters", async () => {
    await seedPeople();
    expect(await contacts.search("%")).toEqual([]);
    expect(await contacts.search("_")).toEqual([]);
  });

  it("labels a contact with no name rather than returning a blank row", async () => {
    h = await createHarness();
    const nameless = await contacts.create({
      firstName: "",
      lastName: "",
      emails: [{ email: "billing@nowhere.example", label: "work", isPrimary: true }],
    });
    const rows = await contacts.search("billing@nowhere");
    expect(rows.map((r) => r.id)).toContain(nameless.id);
    expect(rows[0].label).toBe("(no name)");
    expect(rows[0].detail).toBe("billing@nowhere.example");
  });
});

describe("companies.search", () => {
  it("finds a company by name prefix, with the website as the detail", async () => {
    const { acme } = await seedPeople();
    const rows = await companies.search("Acme");
    expect(rows[0].id).toBe(acme.id);
    expect(rows[0].label).toBe("Acme Roofing");
    expect(rows[0].detail).toBe("acmeroofing.example");
  });

  it("matches the website and the phone", async () => {
    const { acme } = await seedPeople();
    expect((await companies.search("acmeroofing")).map((r) => r.id)).toContain(
      acme.id,
    );
    expect((await companies.search("555-0199")).map((r) => r.id)).toContain(
      acme.id,
    );
  });

  it("answers an empty query with the most recently touched companies", async () => {
    const { priyaCo } = await seedPeople();
    await companies.update(priyaCo.id, { notes: "touched last" });
    const rows = await companies.search("");
    expect(rows[0].id).toBe(priyaCo.id);
  });

  it("never returns a deleted company", async () => {
    const { acme } = await seedPeople();
    await companies.softDelete(acme.id);
    expect((await companies.search("Acme")).map((r) => r.id)).not.toContain(
      acme.id,
    );
  });
});

describe("products.search", () => {
  async function seedCatalog() {
    h = await createHarness();
    const gutters = await products.create({
      name: "Gutter clean",
      description: "Clear and flush the gutters",
      unitPriceCents: 18000,
      taxable: true,
    });
    const roof = await products.create({
      name: "Roof inspection",
      unitPriceCents: 9500,
    });
    const plan = await products.create({
      name: "Maintenance plan",
      kind: "recurring",
      interval: "month",
      unitPriceCents: 4900,
    });
    return { gutters, roof, plan };
  }

  it("finds a service by name prefix and carries its price and shape", async () => {
    const { plan } = await seedCatalog();
    const rows = await products.search("Main");
    expect(rows[0].id).toBe(plan.id);
    expect(rows[0].unitPriceCents).toBe(4900);
    expect(rows[0].kind).toBe("recurring");
    expect(rows[0].interval).toBe("month");
  });

  it("matches the description and shows it as the detail", async () => {
    const { gutters } = await seedCatalog();
    const rows = await products.search("flush");
    expect(rows[0].id).toBe(gutters.id);
    expect(rows[0].detail).toBe("Clear and flush the gutters");
    expect(rows[0].taxable).toBe(true);
  });

  it("ranks a name match above a description-only match", async () => {
    await seedCatalog();
    const rows = await products.search("gutter");
    expect(rows[0].label).toBe("Gutter clean");
  });

  it("answers an empty query with the catalog in its own order", async () => {
    const { gutters, roof, plan } = await seedCatalog();
    const rows = await products.search("");
    expect(rows.map((r) => r.id)).toEqual([gutters.id, roof.id, plan.id]);
  });

  it("leaves out inactive and deleted services", async () => {
    const { roof, plan } = await seedCatalog();
    await products.update(roof.id, { active: false });
    await products.softDelete(plan.id);
    const rows = await products.search("");
    expect(rows.map((r) => r.id)).not.toContain(roof.id);
    expect(rows.map((r) => r.id)).not.toContain(plan.id);
  });
});
