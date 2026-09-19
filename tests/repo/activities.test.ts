import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import * as activities from "../../src/db/repos/activities";
import * as contacts from "../../src/db/repos/contacts";
import * as companies from "../../src/db/repos/companies";
import * as deals from "../../src/db/repos/deals";
import * as pipelines from "../../src/db/repos/pipelines";
import * as stages from "../../src/db/repos/stages";
import { ValidationError } from "../../src/db/errors";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("activities: user entries", () => {
  it("creates, updates and deletes a user entry", async () => {
    h = await createSeededHarness();
    const created = await activities.create({ kind: "note", body: "Hello" });
    expect(created.isSystem).toBe(false);
    expect(created.actorId).toBe("owner");

    const updated = await activities.update(created.id, { body: "Hello again" });
    expect(updated.body).toBe("Hello again");

    await activities.softDelete(created.id);
    const afterDelete = await activities.get(created.id);
    expect(afterDelete?.deletedAt).not.toBeNull();

    await activities.restore(created.id);
    const afterRestore = await activities.get(created.id);
    expect(afterRestore?.deletedAt).toBeNull();

    await activities.purge(created.id);
    expect(await activities.get(created.id)).toBeNull();
  });
});

describe("activities: system entries are immutable", () => {
  it("cannot be updated", async () => {
    h = await createSeededHarness();
    const system = await activities.createSystem({ body: "Stage changed." });
    expect(system.isSystem).toBe(true);

    await expect(
      activities.update(system.id, { body: "Edited" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cannot be soft-deleted", async () => {
    h = await createSeededHarness();
    const system = await activities.createSystem({ body: "Import ran." });

    await expect(activities.softDelete(system.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("activities: list with mergedForCompanyId", () => {
  it("returns the company's own entries plus its contacts' and deals'", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Merged Co" });
    const contact = await contacts.create({
      firstName: "Contact",
      lastName: "Of Company",
      companyId: company.id,
    });
    const pipeline = await pipelines.getDefaultOrThrow();
    const [stage] = await stages.list(pipeline.id);
    const deal = await deals.create({
      title: "Deal of company",
      stageId: stage.id,
      companyId: company.id,
    });
    const otherContact = await contacts.create({ firstName: "Unrelated", lastName: "Person" });

    const onCompany = await activities.create({ kind: "note", body: "On company", companyId: company.id });
    const onContact = await activities.create({ kind: "note", body: "On contact", contactId: contact.id });
    const onDeal = await activities.create({ kind: "note", body: "On deal", dealId: deal.id });
    const unrelated = await activities.create({ kind: "note", body: "Unrelated", contactId: otherContact.id });

    const { rows } = await activities.list({ mergedForCompanyId: company.id }, { limit: 100 });
    const ids = rows.map((a) => a.id);
    expect(ids).toContain(onCompany.id);
    expect(ids).toContain(onContact.id);
    expect(ids).toContain(onDeal.id);
    expect(ids).not.toContain(unrelated.id);
  });
});

describe("activities: recent", () => {
  it("orders by occurred_at descending", async () => {
    h = await createSeededHarness();
    await activities.create({ kind: "note", body: "First", occurredAt: "2024-01-01T00:00:00.000Z" });
    await activities.create({ kind: "note", body: "Second", occurredAt: "2024-01-03T00:00:00.000Z" });
    await activities.create({ kind: "note", body: "Third", occurredAt: "2024-01-02T00:00:00.000Z" });

    const recent = await activities.recent(10);
    expect(recent.map((a) => a.body)).toEqual(["Second", "Third", "First"]);
  });
});
