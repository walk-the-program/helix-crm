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
import { externalIdFor, LEAD_UPDATE_INTRO } from "../../../src/features/leads/lib/leadMapping";
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
      invalid: 0,
      dealIds: [],
    });
  });
});

/* -------------------------------------------------------------------------- */
/* F-LB-1 / F-LB-8: a lead with no usable id                                   */
/* -------------------------------------------------------------------------- */

describe("applyLeadPage - leads with no usable id (defense in depth)", () => {
  // In production `leadsFetch.assertValidLeadPage` rejects a page like this
  // before it ever reaches applyLeadPage. These tests exercise the guard
  // applyLeadPage keeps for itself, as a caller that bypasses that validator
  // (or a future one) would still hit it.

  it("drops a lead with a blank id, counts it invalid, and creates nothing for it", async () => {
    const result = await apply([lead({ id: "   " })]);
    expect(result.invalid).toBe(1);
    expect(result.created).toBe(0);
    expect(result.dealIds).toEqual([]);

    const dealCount = await raw.query("SELECT count(*) FROM deals");
    expect(Number(dealCount[0][0])).toBe(0);
    const contactCount = await raw.query("SELECT count(*) FROM contacts");
    expect(Number(contactCount[0][0])).toBe(0);
  });

  it("does not let two id-less leads merge into a shared bucket", async () => {
    const result = await apply([
      lead({ id: "", email: "noid1@example.com" }),
      lead({ id: "", email: "noid2@example.com" }),
    ]);
    expect(result.invalid).toBe(2);
    expect(result.created).toBe(0);

    const contactCount = await raw.query("SELECT count(*) FROM contacts");
    expect(Number(contactCount[0][0])).toBe(0);
  });

  it("still applies the rest of the page around one invalid lead", async () => {
    const result = await apply([
      lead({ id: "  " }),
      lead({ id: "999", email: "good@example.com" }),
    ]);
    expect(result.invalid).toBe(1);
    expect(result.created).toBe(1);

    const deal = await deals.findByExternalId(externalIdFor(SITE, "999"));
    expect(deal).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* F-LB-8: two leads in one page sharing the same real external id            */
/* -------------------------------------------------------------------------- */

describe("applyLeadPage - a duplicate id within one page", () => {
  it("creates exactly one deal when two leads in the same page share a real id", async () => {
    const result = await apply([
      lead({ id: "dup-1", email: "first@example.com", name: "First Person" }),
      lead({ id: "dup-1", email: "second@example.com", name: "Second Person" }),
    ]);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);

    const deal = await deals.list({}, { limit: 100 });
    expect(deal.total).toBe(1);
    const externalIds = new Set(
      (await raw.query("SELECT external_id FROM deals")).map((r) => String(r[0])),
    );
    expect(externalIds.size).toBe(1);
    expect([...externalIds][0]).toBe(externalIdFor(SITE, "dup-1"));

    // The first lead's own details won: nothing from the second overwrote it.
    const contactCount = await raw.query("SELECT count(*) FROM contacts");
    expect(Number(contactCount[0][0])).toBe(1);
    const contact = await contacts.getOrThrow(deal.rows[0].contactId!);
    expect(contact.firstName).toBe("First");
  });

  it("still recognises a duplicate id already committed from an earlier page", async () => {
    await apply([lead({ id: "dup-2" })]);
    const result = await apply([
      lead({ id: "dup-2", email: "different@example.com" }),
      lead({ id: "dup-2", email: "another@example.com" }),
    ]);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(2);

    const total = await deals.list({}, { limit: 100 });
    expect(total.total).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* F-LB-16: a dedupe merge never drops a new phone or email on the floor      */
/* -------------------------------------------------------------------------- */

describe("applyLeadPage - a dedupe merge adds a new phone/email as secondary", () => {
  it("adds a new phone as a secondary entry without touching the existing one", async () => {
    const existing = await contacts.create({
      firstName: "Priya",
      lastName: "Existing",
      emails: [{ email: "priya@example.com", isPrimary: true }],
      phones: [{ raw: "801-555-9999", isPrimary: true }],
    });

    const result = await apply([
      lead({
        id: "dedupe-1",
        email: "priya@example.com", // matches the existing contact
        phone: "+18015551234", // a different phone than the one on file
      }),
    ]);
    expect(result.contactsReused).toBe(1);
    expect(result.created).toBe(1);

    const contact = await contacts.getOrThrow(existing.id);
    const rawNumbers = contact.phones.map((p) => p.raw);
    expect(rawNumbers).toContain("801-555-9999");
    expect(rawNumbers).toContain("+18015551234");

    // The original stays primary; the new one is secondary.
    const original = contact.phones.find((p) => p.raw === "801-555-9999")!;
    const added = contact.phones.find((p) => p.raw === "+18015551234")!;
    expect(original.isPrimary).toBe(true);
    expect(added.isPrimary).toBe(false);

    // The new deal's own activity is exactly what mapLead produced - the
    // merge logic did not touch it.
    const deal = await deals.findByExternalId(externalIdFor(SITE, "dedupe-1"));
    const timeline = await activities.list({ dealId: deal!.id });
    expect(timeline.rows).toHaveLength(1);
    expect(timeline.rows[0].body).toContain("Sprinkler repair");
  });

  it("adds a new email as a secondary entry without touching the existing one", async () => {
    const existing = await contacts.create({
      firstName: "Dana",
      lastName: "Existing",
      phones: [{ raw: "801-555-0142", isPrimary: true }],
      emails: [{ email: "dana.old@example.com", isPrimary: true }],
    });

    await apply([
      lead({
        id: "dedupe-2",
        email: "dana.new@example.com",
        phone: "801-555-0142", // matches on phone
      }),
    ]);

    const contact = await contacts.getOrThrow(existing.id);
    const emails = contact.emails.map((e) => e.emailLower);
    expect(emails).toContain("dana.old@example.com");
    expect(emails).toContain("dana.new@example.com");
    const original = contact.emails.find((e) => e.emailLower === "dana.old@example.com")!;
    const added = contact.emails.find((e) => e.emailLower === "dana.new@example.com")!;
    expect(original.isPrimary).toBe(true);
    expect(added.isPrimary).toBe(false);
  });

  it("adds nothing when the lead's phone and email are already on file", async () => {
    const existing = await contacts.create({
      firstName: "Dana",
      lastName: "Existing",
      emails: [{ email: "dana@example.com", isPrimary: true }],
      phones: [{ raw: "(801) 555-0142", isPrimary: true }],
    });

    await apply([lead({ id: "dedupe-3", email: "dana@example.com", phone: "8015550142" })]);

    const contact = await contacts.getOrThrow(existing.id);
    expect(contact.phones).toHaveLength(1);
    expect(contact.emails).toHaveLength(1);
  });

  it("adds nothing extra for a contact match with no phone or email on the lead", async () => {
    const existing = await contacts.create({
      firstName: "Dana",
      lastName: "Existing",
      emails: [{ email: "dana@example.com", isPrimary: true }],
    });

    await apply([lead({ id: "dedupe-4", email: "dana@example.com", phone: null })]);

    const contact = await contacts.getOrThrow(existing.id);
    expect(contact.phones).toHaveLength(0);
    expect(contact.emails).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* F-LB-17: a re-poll that carries a genuine site-side correction             */
/* -------------------------------------------------------------------------- */

describe("applyLeadPage - a re-poll with changed field values", () => {
  async function systemActivitiesFor(dealId: string) {
    const rows = await activities.list({ dealId, kind: "system" });
    return rows.rows;
  }

  it("writes exactly one update activity when Service/Message/Page changed, and leaves the deal alone", async () => {
    await apply([lead({ id: "repoll-1" })]);
    const deal = (await deals.findByExternalId(externalIdFor(SITE, "repoll-1")))!;
    const titleBefore = deal.title;

    const result = await apply([
      lead({
        id: "repoll-1",
        service: "Full landscape overhaul",
        message: "Completely different message.",
        pageUrl: "https://sorensenlandscaping.com/overhaul",
      }),
    ]);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);

    const dealAfter = await deals.getOrThrow(deal.id);
    expect(dealAfter.title).toBe(titleBefore); // untouched

    const timeline = await systemActivitiesFor(deal.id);
    expect(timeline).toHaveLength(2);
    const update = timeline.find((a) => a.body.startsWith(LEAD_UPDATE_INTRO))!;
    expect(update).toBeTruthy();
    expect(update.body).toContain("Full landscape overhaul");
    expect(update.body).toContain("Completely different message.");
    expect(update.dealId).toBe(deal.id);
    expect(update.contactId).toBe(deal.contactId);

    // The original activity is untouched.
    const original = timeline.find((a) => a.body.startsWith("Lead from the website."))!;
    expect(original.body).toContain("Sprinkler repair");
  });

  it("writes nothing at all when the re-poll repeats exactly what is on file", async () => {
    await apply([lead({ id: "repoll-2" })]);
    const deal = (await deals.findByExternalId(externalIdFor(SITE, "repoll-2")))!;
    const before = await systemActivitiesFor(deal.id);

    const result = await apply([lead({ id: "repoll-2" })]);
    expect(result.skipped).toBe(1);

    const after = await systemActivitiesFor(deal.id);
    expect(after).toHaveLength(before.length);
  });

  it("does not write a second update activity once the correction is already on file", async () => {
    await apply([lead({ id: "repoll-3" })]);
    const deal = (await deals.findByExternalId(externalIdFor(SITE, "repoll-3")))!;

    const corrected = lead({ id: "repoll-3", service: "Tree removal" });
    await apply([corrected]);
    const afterFirstUpdate = await systemActivitiesFor(deal.id);
    expect(afterFirstUpdate).toHaveLength(2);

    // Same corrected values again: nothing new to say.
    await apply([corrected]);
    const afterSecondPoll = await systemActivitiesFor(deal.id);
    expect(afterSecondPoll).toHaveLength(2);
  });

  it("never advances past 'nothing changed' just because the name or contact info differs from the deal's own edits", async () => {
    // The deal's own fields (title) are never read back for comparison - only
    // the lead's Service/Message/Page detail is. A poller re-poll with the
    // exact same lead payload must be silent even though nothing here checks
    // the deal's current title.
    await apply([lead({ id: "repoll-4" })]);
    const deal = (await deals.findByExternalId(externalIdFor(SITE, "repoll-4")))!;
    await deals.update(deal.id, { title: "Renamed by the owner" });

    const before = await systemActivitiesFor(deal.id);
    await apply([lead({ id: "repoll-4" })]);
    const after = await systemActivitiesFor(deal.id);

    expect(after).toHaveLength(before.length);
    const dealAfter = await deals.getOrThrow(deal.id);
    expect(dealAfter.title).toBe("Renamed by the owner");
  });
});
