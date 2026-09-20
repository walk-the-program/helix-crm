/**
 * CPO-LA-IMPL-W3 (F-LC-2): duplicate detection must read the workspace's own
 * phone region instead of always falling back to US, or a GB/AU/NZ owner
 * accumulates duplicate contacts and companies that a differently-formatted
 * number would otherwise have caught.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import * as contacts from "../../src/db/repos/contacts";
import * as companies from "../../src/db/repos/companies";
import * as settings from "../../src/db/repos/settings";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("contacts: phone dedupe respects the workspace's defaultRegion", () => {
  it("findByEmailOrPhone matches a GB number written two ways", async () => {
    h = await createHarness();
    await settings.set("defaultRegion", "GB");

    const created = await contacts.create(
      { firstName: "Gareth", lastName: "Bale", phones: [{ raw: "07911 123456" }] },
      { region: "GB" },
    );
    expect(created.phones[0].e164).toBe("+447911123456");

    const found = await contacts.findByEmailOrPhone(null, "+44 7911 123456");
    expect(found).toBe(created.id);
  });

  it("findDuplicates pairs a GB number written two ways", async () => {
    h = await createHarness();
    await settings.set("defaultRegion", "GB");

    const created = await contacts.create(
      { firstName: "Ffion", lastName: "Jones", phones: [{ raw: "07911789456" }] },
      { region: "GB" },
    );

    const warnings = await contacts.findDuplicates({ phones: ["+44 7911 789456"] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].matchedOn).toBe("phone");
    expect(warnings[0].entityId).toBe(created.id);
  });

  it("a US workspace is unaffected (no defaultRegion set, default is US)", async () => {
    h = await createHarness();
    const created = await contacts.create({
      firstName: "Phone",
      lastName: "Owner",
      phones: [{ raw: "(415) 555-0132" }],
    });

    const found = await contacts.findByEmailOrPhone(null, "415-555-0132");
    expect(found).toBe(created.id);

    const warnings = await contacts.findDuplicates({ phones: ["+14155550132"] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].entityId).toBe(created.id);
  });

  it("an unparseable number does not throw and simply finds nothing", async () => {
    h = await createHarness();
    await settings.set("defaultRegion", "GB");

    await expect(
      contacts.findByEmailOrPhone(null, "not a phone number"),
    ).resolves.toBeNull();
    await expect(
      contacts.findDuplicates({ phones: ["not a phone number"] }),
    ).resolves.toEqual([]);
  });
});

describe("companies: phone dedupe respects the workspace's defaultRegion", () => {
  it("findDuplicates matches a GB number written two ways", async () => {
    h = await createHarness();
    await settings.set("defaultRegion", "GB");

    const created = await companies.create(
      { name: "Cardiff Roofing", phone: "07911123789" },
      { region: "GB" },
    );
    expect(created.phoneE164).toBe("+447911123789");

    const warnings = await companies.findDuplicates({ phone: "+44 7911 123789" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].entityId).toBe(created.id);
  });

  it("a US workspace is unaffected (no defaultRegion set, default is US)", async () => {
    h = await createHarness();
    const created = await companies.create({ name: "Bay Area Plumbing", phone: "(415) 555-0199" });

    const warnings = await companies.findDuplicates({ phone: "415-555-0199" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].entityId).toBe(created.id);
  });

  it("an unparseable number does not throw", async () => {
    h = await createHarness();
    await settings.set("defaultRegion", "GB");
    await expect(
      companies.findDuplicates({ phone: "not a phone number" }),
    ).resolves.toEqual([]);
  });
});
