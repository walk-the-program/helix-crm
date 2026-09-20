/**
 * The three-row automations switchboard: list/get read it, update patches it
 * and validates, and a bad patch never reaches the table.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "@/db/client";
import * as automations from "@/db/repos/automations";
import { ValidationError } from "@/db/errors";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("automations: list/get", () => {
  it("always returns the three rules, in AUTOMATION_KINDS order", async () => {
    h = await createSeededHarness();
    const rows = await automations.list();
    expect(rows.map((r) => r.kind)).toEqual([
      "lead_arrived",
      "quote_sent",
      "invoice_overdue",
    ]);
  });

  it("seeds lead_arrived and quote_sent enabled, invoice_overdue disabled", async () => {
    h = await createSeededHarness();
    expect((await automations.get("lead_arrived"))?.enabled).toBe(true);
    expect((await automations.get("quote_sent"))?.enabled).toBe(true);
    expect((await automations.get("invoice_overdue"))?.enabled).toBe(false);
  });

  it("seeds the delays from the contract: 60 / 4320 / 4320 minutes", async () => {
    h = await createSeededHarness();
    expect((await automations.get("lead_arrived"))?.delayMinutes).toBe(60);
    expect((await automations.get("quote_sent"))?.delayMinutes).toBe(4320);
    expect((await automations.get("invoice_overdue"))?.delayMinutes).toBe(4320);
  });
});

describe("automations: update", () => {
  it("persists a patch and logs one change_log row", async () => {
    h = await createSeededHarness();
    const updated = await automations.update("lead_arrived", {
      enabled: false,
      delayMinutes: 120,
      titleTemplate: "Ring {name} back",
    });
    expect(updated.enabled).toBe(false);
    expect(updated.delayMinutes).toBe(120);
    expect(updated.titleTemplate).toBe("Ring {name} back");

    const reread = await automations.get("lead_arrived");
    expect(reread?.enabled).toBe(false);
    expect(reread?.delayMinutes).toBe(120);

    const rows = await raw.query(
      `SELECT cl.op AS cl_op FROM change_log cl WHERE cl.entity_type = 'automation' AND cl.entity_id = ?`,
      [updated.id],
    );
    expect(rows.map((r) => String(r[0]))).toEqual(["update"]);
  });

  it("refuses a negative delay and changes nothing", async () => {
    h = await createSeededHarness();
    const before = await automations.get("quote_sent");
    await expect(
      automations.update("quote_sent", { delayMinutes: -1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await automations.get("quote_sent");
    expect(after?.delayMinutes).toBe(before?.delayMinutes);
  });

  it("refuses an empty title and changes nothing", async () => {
    h = await createSeededHarness();
    const before = await automations.get("lead_arrived");
    await expect(
      automations.update("lead_arrived", { titleTemplate: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await automations.get("lead_arrived");
    expect(after?.titleTemplate).toBe(before?.titleTemplate);
  });

  it("refuses a delay longer than a year", async () => {
    h = await createSeededHarness();
    await expect(
      automations.update("invoice_overdue", { delayMinutes: 525_601 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
