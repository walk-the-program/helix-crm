import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as contacts from "../../src/db/repos/contacts";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("contacts: create with phones and emails", () => {
  it("normalises a parseable phone to E.164 and keeps the raw string", async () => {
    h = await createHarness();
    const contact = await contacts.create({
      firstName: "Ada",
      lastName: "Lovelace",
      phones: [{ raw: "(415) 555-0132", label: "mobile", isPrimary: true }],
    });
    expect(contact.phones).toHaveLength(1);
    expect(contact.phones[0].raw).toBe("(415) 555-0132");
    expect(contact.phones[0].e164).toBe("+14155550132");
  });

  it("stores e164 = NULL for an unparseable phone without rejecting it", async () => {
    h = await createHarness();
    const contact = await contacts.create({
      firstName: "Grace",
      lastName: "Hopper",
      phones: [{ raw: "call the office", label: "mobile", isPrimary: true }],
    });
    expect(contact.phones).toHaveLength(1);
    expect(contact.phones[0].raw).toBe("call the office");
    expect(contact.phones[0].e164).toBeNull();
  });

  it("stores emails lowercased with the raw email kept as typed", async () => {
    h = await createHarness();
    const contact = await contacts.create({
      firstName: "Margaret",
      lastName: "Hamilton",
      emails: [{ email: "Margaret.H@Example.COM", label: "work", isPrimary: true }],
    });
    expect(contact.emails).toHaveLength(1);
    expect(contact.emails[0].emailLower).toBe("margaret.h@example.com");
  });
});

describe("contacts: update, softDelete, restore, purge", () => {
  it("round trips through update", async () => {
    h = await createHarness();
    const created = await contacts.create({ firstName: "Alan", lastName: "Turing" });
    const updated = await contacts.update(created.id, { lastName: "Turing-Updated" });
    expect(updated.lastName).toBe("Turing-Updated");
    expect(updated.firstName).toBe("Alan");
  });

  it("round trips through softDelete, restore and purge", async () => {
    h = await createHarness();
    const created = await contacts.create({ firstName: "Katherine", lastName: "Johnson" });

    await contacts.softDelete(created.id);
    const afterDelete = await contacts.get(created.id);
    expect(afterDelete?.deletedAt).not.toBeNull();

    await contacts.restore(created.id);
    const afterRestore = await contacts.get(created.id);
    expect(afterRestore?.deletedAt).toBeNull();

    await contacts.purge(created.id);
    const afterPurge = await contacts.get(created.id);
    expect(afterPurge).toBeNull();
  });

  it("excludes soft-deleted rows from list by default, and onlyDeleted shows only them", async () => {
    h = await createHarness();
    const live = await contacts.create({ firstName: "Live", lastName: "One" });
    const gone = await contacts.create({ firstName: "Gone", lastName: "Two" });
    await contacts.softDelete(gone.id);

    const defaultList = await contacts.list();
    expect(defaultList.rows.map((c) => c.id)).toContain(live.id);
    expect(defaultList.rows.map((c) => c.id)).not.toContain(gone.id);

    const onlyDeleted = await contacts.list({ onlyDeleted: true });
    expect(onlyDeleted.rows.map((c) => c.id)).toEqual([gone.id]);
  });
});

describe("contacts: hasName filter", () => {
  it("excludes a contact whose first and last name are both blank", async () => {
    h = await createHarness();
    const named = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const companyOnly = await contacts.create({ firstName: "", lastName: "" });

    const all = await contacts.list();
    expect(all.rows.map((c) => c.id).sort()).toEqual([companyOnly.id, named.id].sort());

    const named_ = await contacts.list({ hasName: true });
    expect(named_.rows.map((c) => c.id)).toEqual([named.id]);
    expect(named_.total).toBe(1);
  });

  it("treats a name of only whitespace as no name", async () => {
    h = await createHarness();
    const named = await contacts.create({ firstName: "Grace", lastName: "Hopper" });
    // create() trims on save, so write the blank-but-whitespace row directly.
    await raw.execute(
      `UPDATE contacts SET first_name = '   ', last_name = '  ' WHERE id <> ?`,
      [named.id],
    );
    const whitespaceOnly = await contacts.create({ firstName: "", lastName: "" });
    await raw.execute(`UPDATE contacts SET first_name = '  ', last_name = ' ' WHERE id = ?`, [
      whitespaceOnly.id,
    ]);

    const result = await contacts.list({ hasName: true });
    expect(result.rows.map((c) => c.id)).toEqual([named.id]);
  });

  it("keeps the count and the rows in agreement (not filtered in JS)", async () => {
    h = await createHarness();
    await contacts.create({ firstName: "", lastName: "" });
    await contacts.create({ firstName: "", lastName: "" });
    const named = await contacts.create({ firstName: "One", lastName: "Named" });

    const result = await contacts.list({ hasName: true }, { limit: 1 });
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(named.id);
  });
});

describe("contacts: findDuplicates", () => {
  it("matches on email_lower and allows the duplicate to be created", async () => {
    h = await createHarness();
    const first = await contacts.create({
      firstName: "Original",
      lastName: "Owner",
      emails: [{ email: "shared@example.com" }],
    });

    const dupWarnings = await contacts.findDuplicates({ emails: ["shared@example.com"] });
    expect(dupWarnings).toHaveLength(1);
    expect(dupWarnings[0].matchedOn).toBe("email");
    expect(dupWarnings[0].entityId).toBe(first.id);

    // Creating the second contact with the same email succeeds: no unique constraint.
    const second = await contacts.create({
      firstName: "Second",
      lastName: "Owner",
      emails: [{ email: "SHARED@example.com" }],
    });
    expect(second.id).not.toBe(first.id);

    const all = await contacts.list();
    expect(all.total).toBe(2);
  });

  it("matches on e164 when no email matched", async () => {
    h = await createHarness();
    const first = await contacts.create({
      firstName: "Phone",
      lastName: "Owner",
      phones: [{ raw: "+1 415 555 0100" }],
    });

    const warnings = await contacts.findDuplicates({ phones: ["415-555-0100"] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].matchedOn).toBe("phone");
    expect(warnings[0].entityId).toBe(first.id);
  });

  it("never matches on name alone", async () => {
    h = await createHarness();
    await contacts.create({ firstName: "Same", lastName: "Name" });
    await contacts.create({ firstName: "Same", lastName: "Name" });

    const warnings = await contacts.findDuplicates({});
    expect(warnings).toEqual([]);
  });

  it("excludes the contact itself when excludeContactId is passed", async () => {
    h = await createHarness();
    const contact = await contacts.create({
      firstName: "Self",
      lastName: "Check",
      emails: [{ email: "self@example.com" }],
    });

    const withoutExclude = await contacts.findDuplicates({ emails: ["self@example.com"] });
    expect(withoutExclude).toHaveLength(1);

    const withExclude = await contacts.findDuplicates(
      { emails: ["self@example.com"] },
      contact.id,
    );
    expect(withExclude).toEqual([]);
  });
});

describe("contacts: findByEmailOrPhone", () => {
  it("prefers an email match over a phone match", async () => {
    h = await createHarness();
    const emailOwner = await contacts.create({
      firstName: "Email",
      lastName: "Owner",
      emails: [{ email: "priority@example.com" }],
      phones: [{ raw: "+1 415 555 0111" }],
    });
    const phoneOwner = await contacts.create({
      firstName: "Phone",
      lastName: "Owner",
      phones: [{ raw: "+1 415 555 0122" }],
    });

    const found = await contacts.findByEmailOrPhone(
      "priority@example.com",
      "+1 415 555 0122",
    );
    expect(found).toBe(emailOwner.id);
    expect(found).not.toBe(phoneOwner.id);
  });

  it("falls back to phone when no email is given", async () => {
    h = await createHarness();
    const phoneOwner = await contacts.create({
      firstName: "Phone",
      lastName: "Only",
      phones: [{ raw: "+1 415 555 0199" }],
    });

    const found = await contacts.findByEmailOrPhone(null, "+1 415 555 0199");
    expect(found).toBe(phoneOwner.id);
  });

  it("returns null when nothing matches", async () => {
    h = await createHarness();
    const found = await contacts.findByEmailOrPhone("nobody@example.com", null);
    expect(found).toBeNull();
  });
});

describe("contacts: change_log", () => {
  it("appends a change_log row with actor_id owner on create", async () => {
    h = await createHarness();
    const created = await contacts.create({ firstName: "Logged", lastName: "Write" });

    const rows = await raw.query(
      `SELECT cl.entity_type AS cl_entity_type, cl.entity_id AS cl_entity_id,
              cl.op AS cl_op, cl.actor_id AS cl_actor_id
       FROM change_log cl WHERE cl.entity_type = 'contact' AND cl.entity_id = ?`,
      [created.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe("create");
    expect(rows[0][3]).toBe("owner");
  });

  it("appends a change_log row on update, softDelete, restore and purge", async () => {
    h = await createHarness();
    const created = await contacts.create({ firstName: "Multi", lastName: "Write" });
    await contacts.update(created.id, { lastName: "Write-2" });
    await contacts.softDelete(created.id);
    await contacts.restore(created.id);
    await contacts.purge(created.id);

    const rows = await raw.query(
      `SELECT cl.op AS cl_op, cl.actor_id AS cl_actor_id FROM change_log cl
       WHERE cl.entity_type = 'contact' AND cl.entity_id = ? ORDER BY cl.at ASC`,
      [created.id],
    );
    expect(rows.map((r) => String(r[0]))).toEqual([
      "create",
      "update",
      "delete",
      "restore",
      "delete",
    ]);
    for (const row of rows) {
      expect(row[1]).toBe("owner");
    }
  });
});
