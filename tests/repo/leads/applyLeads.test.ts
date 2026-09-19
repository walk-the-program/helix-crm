/**
 * Applying a page of website leads.
 *
 * The three properties that matter: re-polling the same page changes nothing,
 * a lead whose email or phone already belongs to a contact reuses that
 * contact, and every deal carries the external_id that makes the first two
 * possible.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as contacts from "../../../src/db/repos/contacts";
import * as deals from "../../../src/db/repos/deals";
import * as activities from "../../../src/db/repos/activities";
import * as sources from "../../../src/db/repos/sources";
import {
  applyLeadPage,
  firstStageId,
  prepareApply,
} from "../../../src/features/leads/lib/applyLeads";
import { externalIdFor } from "../../../src/features/leads/lib/leadMapping";
import type { Lead } from "../../../src/features/leads/lib/types";

const SITE = "https://sorensenlandscaping.com";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createSeededHarness();
});

afterEach(() => {
  h?.dispose();
  h = null;
});

function lead(overrides: Partial<Lead> & { id: string }): Lead {
  return {
    createdAt: "2026-03-01T15:04:05.000Z",
    name: "Dana Whitcomb",
    email: "dana@example.com",
    phone: "(801) 555-0142",
    service: "Sprinkler repair",
    message: "Zone 3 will not shut off.",
    pageUrl: "https://sorensenlandscaping.com/contact",
    ...overrides,
  };
}

async function apply(leads: Lead[]) {
  const context = await prepareApply();
  expect(context).not.toBeNull();
  return applyLeadPage(leads, SITE, context!);
}

describe("applyLeadPage", () => {
  it("turns a lead into a contact, a deal in the first stage, and a system entry", async () => {
    const result = await apply([lead({ id: "101" })]);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.contactsReused).toBe(0);

    const deal = await deals.findByExternalId(externalIdFor(SITE, "101"));
    expect(deal).not.toBeNull();
    expect(deal!.title).toBe("Sprinkler repair - Dana Whitcomb");
    expect(deal!.stageId).toBe(await firstStageId());
    expect(deal!.stageName).toBe("New");
    expect(deal!.closedAt).toBeNull();

    // Source is Website, resolved (or created) before the transaction opened.
    const website = await sources.findByName("Website");
    expect(website).not.toBeNull();
    expect(deal!.sourceId).toBe(website!.id);

    // The contact carries the lead's name, email and phone.
    expect(deal!.contactId).not.toBeNull();
    const contact = await contacts.getOrThrow(deal!.contactId!);
    expect(contact.firstName).toBe("Dana");
    expect(contact.lastName).toBe("Whitcomb");
    expect(contact.emails.map((e) => e.emailLower)).toEqual(["dana@example.com"]);
    expect(contact.phones[0].e164).toBe("+18015550142");

    // One immutable system entry holding the message, the service and the page.
    const timeline = await activities.list({ dealId: deal!.id });
    expect(timeline.rows).toHaveLength(1);
    const entry = timeline.rows[0];
    expect(entry.isSystem).toBe(true);
    expect(entry.kind).toBe("system");
    expect(entry.body).toContain("Zone 3 will not shut off.");
    expect(entry.body).toContain("Sprinkler repair");
    expect(entry.body).toContain("https://sorensenlandscaping.com/contact");
    // The site's own timestamp, not the moment the poll ran.
    expect(entry.occurredAt).toBe("2026-03-01T15:04:05.000Z");

    // The opening stage event exists, so days-in-stage has something to read.
    const events = await deals.listStageEvents(deal!.id);
    expect(events).toHaveLength(1);
    expect(events[0].fromStageId).toBeNull();
  });

  it("is idempotent: the same page applied twice creates nothing the second time", async () => {
    const page = [lead({ id: "201" }), lead({ id: "202", email: "kip@example.com", phone: "8015550199", name: "Kip Ord" })];

    const first = await apply(page);
    expect(first.created).toBe(2);
    expect(first.skipped).toBe(0);

    const second = await apply(page);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(2);
    const contactCount = await raw.query(
      "SELECT count(*) FROM contacts WHERE deleted_at IS NULL",
    );
    expect(Number(contactCount[0][0])).toBe(2);
  });

  it("dedupes on email first", async () => {
    const existing = await contacts.create({
      firstName: "Dana",
      lastName: "W",
      emails: [{ email: "DANA@example.com" }],
    });

    const result = await apply([lead({ id: "301", phone: null })]);
    expect(result.created).toBe(1);
    expect(result.contactsReused).toBe(1);

    const deal = await deals.findByExternalId(externalIdFor(SITE, "301"));
    expect(deal!.contactId).toBe(existing.id);

    const count = await raw.query(
      "SELECT count(*) FROM contacts WHERE deleted_at IS NULL",
    );
    expect(Number(count[0][0])).toBe(1);
  });

  it("falls back to the phone when the email does not match", async () => {
    const existing = await contacts.create({
      firstName: "Dana",
      lastName: "W",
      emails: [{ email: "someone.else@example.com" }],
      phones: [{ raw: "801-555-0142" }],
    });

    // Same number, written the way a website form would send it.
    const result = await apply([
      lead({ id: "401", email: "brand-new@example.com", phone: "+1 (801) 555-0142" }),
    ]);
    expect(result.contactsReused).toBe(1);

    const deal = await deals.findByExternalId(externalIdFor(SITE, "401"));
    expect(deal!.contactId).toBe(existing.id);
  });

  it("creates a contact when neither the email nor the phone is known", async () => {
    await contacts.create({
      firstName: "Someone",
      lastName: "Else",
      emails: [{ email: "other@example.com" }],
      phones: [{ raw: "801-555-0000" }],
    });

    const result = await apply([lead({ id: "501" })]);
    expect(result.created).toBe(1);
    expect(result.contactsReused).toBe(0);

    const count = await raw.query(
      "SELECT count(*) FROM contacts WHERE deleted_at IS NULL",
    );
    expect(Number(count[0][0])).toBe(2);
  });

  it("copes with a lead that has no name, no email and no phone", async () => {
    const result = await apply([
      lead({ id: "601", name: null, email: null, phone: null, service: null, message: "  " }),
    ]);
    expect(result.created).toBe(1);

    const deal = await deals.findByExternalId(externalIdFor(SITE, "601"));
    expect(deal!.title).toBe("Website lead");
    const contact = await contacts.getOrThrow(deal!.contactId!);
    expect(contact.firstName).toBe("Website lead");
    expect(contact.emails).toHaveLength(0);
    expect(contact.phones).toHaveLength(0);
  });

  it("gives every deal on a page its own position in the stage", async () => {
    const result = await apply([
      lead({ id: "701", email: "a@example.com", phone: null }),
      lead({ id: "702", email: "b@example.com", phone: null }),
      lead({ id: "703", email: "c@example.com", phone: null }),
    ]);
    expect(result.created).toBe(3);

    const rows = await raw.query(
      `SELECT d.position FROM deals d WHERE d.deleted_at IS NULL ORDER BY d.position ASC`,
    );
    expect(rows.map((r) => Number(r[0]))).toEqual([0, 1, 2]);
  });

  it("treats the same site written with a trailing slash as the same site", async () => {
    const context = await prepareApply();
    await applyLeadPage([lead({ id: "801" })], SITE, context!);
    const again = await applyLeadPage([lead({ id: "801" })], `${SITE}/`, context!);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it("writes nothing at all when one lead in the page fails", async () => {
    const context = await prepareApply();
    // A stage id that does not exist trips the deals foreign key on the batch,
    // and the whole page has to roll back with it.
    const broken = { ...context!, stageId: "no-such-stage" };
    await expect(
      applyLeadPage([lead({ id: "901" }), lead({ id: "902" })], SITE, broken),
    ).rejects.toThrow();

    const count = await raw.query(
      "SELECT count(*) FROM deals WHERE deleted_at IS NULL",
    );
    expect(Number(count[0][0])).toBe(0);
    const contactCount = await raw.query(
      "SELECT count(*) FROM contacts WHERE deleted_at IS NULL",
    );
    expect(Number(contactCount[0][0])).toBe(0);
  });

  it("records one change_log row per created entity", async () => {
    await apply([lead({ id: "1001" })]);
    const rows = await raw.query(
      `SELECT cl.entity_type, cl.op FROM change_log cl ORDER BY cl.at ASC, cl.id ASC`,
    );
    const pairs = rows.map((r) => `${String(r[0])}:${String(r[1])}`);
    expect(pairs).toContain("contact:create");
    expect(pairs).toContain("deal:create");
    expect(pairs).toContain("activity:create");
  });

  it("applies an empty page without opening a transaction", async () => {
    const result = await apply([]);
    expect(result).toEqual({
      created: 0,
      skipped: 0,
      contactsReused: 0,
      dealIds: [],
    });
  });
});
