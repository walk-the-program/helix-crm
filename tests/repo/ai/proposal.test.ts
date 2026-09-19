/**
 * Confirming a pasted proposal: the contact and the deal land together, in the
 * first stage, with the change log tying them to one batch.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as deals from "../../../src/db/repos/deals";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as settingsRepo from "../../../src/db/repos/settings";
import {
  createFromProposal,
  findDuplicateContact,
} from "../../../src/features/ai/lib/proposal";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const PROPOSAL = {
  firstName: "Dana",
  lastName: "Whitaker",
  email: "dana@example.com",
  phone: "(801) 555-0147",
  notes: "Sprinklers flooding the driveway.",
  dealTitle: "Sprinkler repair",
  dealValueCents: 60000,
  dealExpectedOn: null,
};

describe("createFromProposal", () => {
  it("creates the contact and the deal in one go", async () => {
    h = await createSeededHarness();
    const result = await createFromProposal(PROPOSAL);

    const contact = await contacts.get(result.contactId);
    expect(contact).not.toBeNull();
    expect(contacts.contactName(contact!)).toBe("Dana Whitaker");
    expect(contact!.phones[0].e164).toBe("+18015550147");
    expect(contact!.emails[0].emailLower).toBe("dana@example.com");
    expect(contact!.notes).toContain("Sprinklers");

    const deal = await deals.get(result.dealId);
    expect(deal).not.toBeNull();
    expect(deal!.title).toBe("Sprinkler repair");
    expect(deal!.valueCents).toBe(60000);
    expect(deal!.contactId).toBe(result.contactId);
  });

  it("puts the deal in the first stage, with its stage event", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const first = await stages.firstStage(pipeline.id);
    const result = await createFromProposal(PROPOSAL);

    const deal = await deals.get(result.dealId);
    expect(deal!.stageId).toBe(first!.id);

    const events = await h.driver.query(
      `SELECT e.to_stage_id AS e_to FROM deal_stage_events e WHERE e.deal_id = ?`,
      [result.dealId],
    );
    expect(events).toHaveLength(1);
    expect(events[0][0]).toBe(first!.id);
  });

  it("logs both rows under one batch id, so one Undo covers the pair", async () => {
    h = await createSeededHarness();
    const result = await createFromProposal(PROPOSAL);

    const rows = await h.driver.query(
      `SELECT cl.entity_type AS cl_type FROM change_log cl WHERE cl.batch_id = ?
       ORDER BY cl.entity_type ASC`,
      [result.batchId],
    );
    expect(rows.map((r) => r[0])).toEqual(["contact", "deal"]);
  });

  it("positions the second deal after the first in the same stage", async () => {
    h = await createSeededHarness();
    const first = await createFromProposal(PROPOSAL);
    const second = await createFromProposal({
      ...PROPOSAL,
      firstName: "Marco",
      lastName: "Reyes",
      email: "marco@example.com",
      phone: "(801) 555-0188",
    });

    const a = await deals.get(first.dealId);
    const b = await deals.get(second.dealId);
    expect(b!.position).toBeGreaterThan(a!.position);
  });

  it("uses the workspace's currency", async () => {
    h = await createSeededHarness();
    await settingsRepo.set("currency", "CAD");
    const result = await createFromProposal(PROPOSAL);
    expect((await deals.get(result.dealId))!.currency).toBe("CAD");
  });

  it("writes nothing when the workspace has no stages", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    // Nothing has been created yet, so every stage is empty and removable.
    for (const stage of await stages.list(pipeline.id)) {
      await stages.remove(stage.id);
    }
    expect(await stages.list(pipeline.id)).toHaveLength(0);

    await expect(createFromProposal(PROPOSAL)).rejects.toThrow(/stages/i);
    expect((await contacts.list({})).total).toBe(0);
    expect((await deals.list({})).total).toBe(0);
  });
});

describe("findDuplicateContact", () => {
  it("finds an existing contact by email, then by phone", async () => {
    h = await createSeededHarness();
    await createFromProposal(PROPOSAL);

    const byEmail = await findDuplicateContact("dana@example.com", null);
    expect(byEmail?.name).toBe("Dana Whitaker");

    const byPhone = await findDuplicateContact(null, "801-555-0147");
    expect(byPhone?.name).toBe("Dana Whitaker");
  });

  it("says nothing when the customer is new", async () => {
    h = await createSeededHarness();
    expect(await findDuplicateContact("nobody@example.com", "8015550000")).toBeNull();
    expect(await findDuplicateContact(null, null)).toBeNull();
  });
});
