import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import * as companies from "../../src/db/repos/companies";
import * as contacts from "../../src/db/repos/contacts";
import * as deals from "../../src/db/repos/deals";
import * as stages from "../../src/db/repos/stages";
import * as pipelines from "../../src/db/repos/pipelines";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("companies: CRUD", () => {
  it("creates, reads, updates and deletes a company", async () => {
    h = await createSeededHarness();
    const created = await companies.create({ name: "Acme Corp", website: "acme.test" });
    expect(created.name).toBe("Acme Corp");

    const updated = await companies.update(created.id, { name: "Acme Corporation" });
    expect(updated.name).toBe("Acme Corporation");

    await companies.softDelete(created.id);
    const afterDelete = await companies.get(created.id);
    expect(afterDelete?.deletedAt).not.toBeNull();

    await companies.restore(created.id);
    const afterRestore = await companies.get(created.id);
    expect(afterRestore?.deletedAt).toBeNull();

    await companies.purge(created.id);
    expect(await companies.get(created.id)).toBeNull();
  });
});

describe("companies: findByName", () => {
  it("matches the exact name on a live row", async () => {
    h = await createSeededHarness();
    const created = await companies.create({ name: "Exact Match Inc" });
    const found = await companies.findByName("Exact Match Inc");
    expect(found?.id).toBe(created.id);
  });

  it("does not match a soft-deleted company", async () => {
    h = await createSeededHarness();
    const created = await companies.create({ name: "Gone Co" });
    await companies.softDelete(created.id);
    const found = await companies.findByName("Gone Co");
    expect(found).toBeNull();
  });

  it("does not partially match", async () => {
    h = await createSeededHarness();
    await companies.create({ name: "Partial Match Company" });
    const found = await companies.findByName("Partial Match");
    expect(found).toBeNull();
  });
});

describe("companies: counts", () => {
  it("counts contacts, open deals and closed deals", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Counted Co" });
    await contacts.create({ firstName: "A", lastName: "B", companyId: company.id });
    await contacts.create({ firstName: "C", lastName: "D", companyId: company.id });

    const pipeline = await pipelines.getDefaultOrThrow();
    const allStages = await stages.list(pipeline.id);
    const newStage = allStages.find((s) => s.name === "New");
    const wonStage = allStages.find((s) => s.name === "Won");
    if (!newStage || !wonStage) throw new Error("Seeded stages missing.");

    await deals.create({
      title: "Open deal",
      stageId: newStage.id,
      companyId: company.id,
    });
    const wonDeal = await deals.create({
      title: "Will be won",
      stageId: newStage.id,
      companyId: company.id,
    });
    await deals.moveToStage(wonDeal.id, wonStage.id);

    const counts = await companies.counts(company.id);
    expect(counts.contacts).toBe(2);
    expect(counts.openDeals).toBe(1);
    expect(counts.closedDeals).toBe(1);
  });
});
