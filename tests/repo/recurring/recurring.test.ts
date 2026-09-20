/**
 * The recurring_rules repository against a real SQLite file.
 *
 * What this proves that a unit test cannot: the table and its indexes exist
 * after the real migration, the SQL picks the right rows for Today, "Done" and
 * "Skip" differ in exactly one column, and the change log records every write.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as recurring from "../../../src/db/repos/recurring";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

/** "YYYY-MM-DD" a number of days from today, in the local calendar. */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("recurring: create", () => {
  it("stores the interval, the first date and an active flag", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Spring cleanup",
      everyN: 1,
      unit: "year",
      nextDueOn: "2027-04-12",
    });

    expect(rule.title).toBe("Spring cleanup");
    expect(rule.everyN).toBe(1);
    expect(rule.unit).toBe("year");
    expect(rule.nextDueOn).toBe("2027-04-12");
    expect(rule.lastCompletedOn).toBeNull();
    expect(rule.active).toBe(true);
    expect(rule.deletedAt).toBeNull();
  });

  it("attaches to a contact", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Nella", lastName: "Okonkwo" });
    const rule = await recurring.create({
      title: "Filter change",
      everyN: 3,
      unit: "month",
      nextDueOn: day(10),
      contactId: contact.id,
    });
    expect(rule.contactId).toBe(contact.id);
    expect(rule.companyId).toBeNull();
  });

  it("refuses a rule with no title, an interval below one, or a bad date", async () => {
    h = await createSeededHarness();
    await expect(
      recurring.create({ title: "  ", everyN: 1, unit: "year", nextDueOn: day(1) }),
    ).rejects.toThrow();
    await expect(
      recurring.create({ title: "Zero", everyN: 0, unit: "week", nextDueOn: day(1) }),
    ).rejects.toThrow();
    await expect(
      recurring.create({ title: "Bad date", everyN: 1, unit: "year", nextDueOn: "12/04/2027" }),
    ).rejects.toThrow();
    await expect(
      recurring.create({ title: "Not a day", everyN: 1, unit: "month", nextDueOn: "2026-02-31" }),
    ).rejects.toThrow();
  });

  it("writes one change_log entry per create", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Gutter clean",
      everyN: 6,
      unit: "month",
      nextDueOn: day(3),
    });
    const rows = await raw.query(
      `SELECT op FROM change_log WHERE entity_type = 'recurring_rule' AND entity_id = ?`,
      [rule.id],
    );
    expect(rows.map((r) => String(r[0]))).toEqual(["create"]);
  });
});

describe("recurring: list", () => {
  it("sorts live rules by their next date and puts paused ones last", async () => {
    h = await createSeededHarness();
    await recurring.create({ title: "Later", everyN: 1, unit: "year", nextDueOn: day(200) });
    await recurring.create({ title: "Sooner", everyN: 1, unit: "month", nextDueOn: day(4) });
    const paused = await recurring.create({
      title: "Paused but soon",
      everyN: 2,
      unit: "week",
      nextDueOn: day(1),
    });
    await recurring.setActive(paused.id, false);

    const { rows, total } = await recurring.list();
    expect(total).toBe(3);
    expect(rows.map((r) => r.title)).toEqual(["Sooner", "Later", "Paused but soon"]);
  });

  it("filters to one record", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Mountain Shadows Assisted Living" });
    await recurring.create({
      title: "Grounds contract review",
      everyN: 1,
      unit: "year",
      nextDueOn: day(30),
      companyId: company.id,
    });
    await recurring.create({ title: "Unattached", everyN: 1, unit: "year", nextDueOn: day(30) });

    const forCompany = await recurring.list({ companyId: company.id });
    expect(forCompany.rows.map((r) => r.title)).toEqual(["Grounds contract review"]);
  });

  it("hides a deleted rule and shows it again after a restore", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Hedge trim",
      everyN: 4,
      unit: "month",
      nextDueOn: day(5),
    });

    await recurring.softDelete(rule.id);
    expect((await recurring.list()).total).toBe(0);
    expect((await recurring.list({ onlyDeleted: true })).total).toBe(1);

    await recurring.restore(rule.id);
    expect((await recurring.list()).total).toBe(1);
  });
});

describe("recurring: listWithWho", () => {
  it("carries the customer's name so the screen never says 'the contact'", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Nella", lastName: "Okonkwo" });
    const company = await companies.create({ name: "Mountain Shadows Assisted Living" });
    await recurring.create({
      title: "Aeration",
      everyN: 1,
      unit: "year",
      nextDueOn: day(20),
      contactId: contact.id,
    });
    await recurring.create({
      title: "Snow contract",
      everyN: 1,
      unit: "year",
      nextDueOn: day(5),
      companyId: company.id,
    });
    await recurring.create({ title: "Order salt", everyN: 1, unit: "year", nextDueOn: day(60) });

    const rows = await recurring.listWithWho();
    expect(rows.map((r) => r.rule.title)).toEqual(["Snow contract", "Aeration", "Order salt"]);
    expect(rows[0].label).toBe("Mountain Shadows Assisted Living");
    expect(rows[0].href).toBe(`/companies/${company.id}`);
    expect(rows[1].label).toBe("Nella Okonkwo");
    expect(rows[2].label).toBeNull();
  });

  it("puts paused rules after the live ones, as the list does", async () => {
    h = await createSeededHarness();
    const paused = await recurring.create({
      title: "Paused but soon",
      everyN: 1,
      unit: "week",
      nextDueOn: day(1),
    });
    await recurring.setActive(paused.id, false);
    await recurring.create({ title: "Live", everyN: 1, unit: "year", nextDueOn: day(90) });

    const rows = await recurring.listWithWho();
    expect(rows.map((r) => r.rule.title)).toEqual(["Live", "Paused but soon"]);
  });
});

describe("recurring: dueSoon", () => {
  it("returns the rules inside the window, including the overdue ones", async () => {
    h = await createSeededHarness();
    await recurring.create({ title: "Overdue", everyN: 1, unit: "year", nextDueOn: day(-3) });
    await recurring.create({ title: "Today", everyN: 1, unit: "year", nextDueOn: day(0) });
    await recurring.create({ title: "In six days", everyN: 1, unit: "year", nextDueOn: day(6) });
    await recurring.create({ title: "In nine days", everyN: 1, unit: "year", nextDueOn: day(9) });

    const due = await recurring.dueSoon();
    expect(due.map((entry) => entry.rule.title)).toEqual(["Overdue", "Today", "In six days"]);
    expect(due[0].daysUntil).toBe(-3);
    expect(due[1].daysUntil).toBe(0);
    expect(due[2].daysUntil).toBe(6);
  });

  it("leaves out a paused rule and a deleted one", async () => {
    h = await createSeededHarness();
    const paused = await recurring.create({
      title: "Paused",
      everyN: 1,
      unit: "week",
      nextDueOn: day(1),
    });
    await recurring.setActive(paused.id, false);
    const deleted = await recurring.create({
      title: "Deleted",
      everyN: 1,
      unit: "week",
      nextDueOn: day(1),
    });
    await recurring.softDelete(deleted.id);

    expect(await recurring.dueSoon()).toEqual([]);
  });

  it("carries the customer's name, route and primary phone", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Brent", lastName: "Hendrickson" });
    await contacts.addPhone(contact.id, {
      raw: "(801) 555-0147",
      label: "mobile",
      isPrimary: true,
    });
    await recurring.create({
      title: "Aeration",
      everyN: 1,
      unit: "year",
      nextDueOn: day(2),
      contactId: contact.id,
    });

    const [entry] = await recurring.dueSoon();
    expect(entry.label).toBe("Brent Hendrickson");
    expect(entry.href).toBe(`/contacts/${contact.id}`);
    expect(entry.phone).toBe("(801) 555-0147");
  });

  it("names the company when the rule is about one", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Mountain Shadows Assisted Living" });
    await recurring.create({
      title: "Snow contract",
      everyN: 1,
      unit: "year",
      nextDueOn: day(1),
      companyId: company.id,
    });

    const [entry] = await recurring.dueSoon();
    expect(entry.label).toBe("Mountain Shadows Assisted Living");
    expect(entry.href).toBe(`/companies/${company.id}`);
    expect(entry.phone).toBeNull();
  });

  it("has no label when the rule is attached to nothing", async () => {
    h = await createSeededHarness();
    await recurring.create({ title: "Order salt", everyN: 1, unit: "year", nextDueOn: day(1) });
    const [entry] = await recurring.dueSoon();
    expect(entry.label).toBeNull();
    expect(entry.href).toBeNull();
  });
});

describe("recurring: complete and skip", () => {
  it("advances the date and stamps the completion", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Spring cleanup",
      everyN: 1,
      unit: "year",
      nextDueOn: "2026-04-12",
    });

    const done = await recurring.complete(rule.id, { reference: "2026-04-14" });
    expect(done.nextDueOn).toBe("2027-04-12");
    expect(done.lastCompletedOn).toBe("2026-04-14");
  });

  it("advances past today rather than one step at a time", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Fortnightly check-in",
      everyN: 2,
      unit: "week",
      nextDueOn: "2026-04-06",
    });

    const done = await recurring.complete(rule.id, { reference: "2026-09-19" });
    expect(done.nextDueOn > "2026-09-19").toBe(true);
    expect(done.nextDueOn).toBe("2026-09-21");
  });

  it("clamps a month-end date instead of rolling into the next month", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "End of month invoice",
      everyN: 1,
      unit: "month",
      nextDueOn: "2026-01-31",
    });
    const done = await recurring.complete(rule.id, { reference: "2026-01-31" });
    expect(done.nextDueOn).toBe("2026-02-28");
  });

  it("skip moves the date and leaves last_completed_on alone", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Spring cleanup",
      everyN: 1,
      unit: "year",
      nextDueOn: "2026-04-12",
    });
    const done = await recurring.complete(rule.id, { reference: "2026-04-12" });
    expect(done.lastCompletedOn).toBe("2026-04-12");

    const skipped = await recurring.skip(rule.id, { reference: "2027-04-13" });
    expect(skipped.nextDueOn).toBe("2028-04-12");
    // Still April 2026: nothing claimed the 2027 one was done.
    expect(skipped.lastCompletedOn).toBe("2026-04-12");
  });

  it("logs both as updates with the before and after", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Aeration",
      everyN: 1,
      unit: "year",
      nextDueOn: "2026-05-01",
    });
    await recurring.complete(rule.id, { reference: "2026-05-01" });

    const rows = await raw.query(
      `SELECT op, before_json, after_json FROM change_log
       WHERE entity_type = 'recurring_rule' AND entity_id = ? ORDER BY at ASC`,
      [rule.id],
    );
    expect(rows.map((r) => String(r[0]))).toEqual(["create", "update"]);
    const before = JSON.parse(String(rows[1][1])) as { nextDueOn: string };
    const after = JSON.parse(String(rows[1][2])) as { nextDueOn: string };
    expect(before.nextDueOn).toBe("2026-05-01");
    expect(after.nextDueOn).toBe("2027-05-01");
  });
});

describe("recurring: pause, update and purge", () => {
  it("pauses and resumes without touching the date", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Weekly mow",
      everyN: 1,
      unit: "week",
      nextDueOn: day(2),
    });

    const paused = await recurring.setActive(rule.id, false);
    expect(paused.active).toBe(false);
    expect(paused.nextDueOn).toBe(rule.nextDueOn);

    const resumed = await recurring.setActive(rule.id, true);
    expect(resumed.active).toBe(true);
    expect(resumed.nextDueOn).toBe(rule.nextDueOn);
  });

  it("edits the wording and the interval", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Cleanup",
      everyN: 1,
      unit: "year",
      nextDueOn: "2027-04-12",
    });
    const updated = await recurring.update(rule.id, {
      title: "  Spring cleanup  ",
      everyN: 6,
      unit: "month",
    });
    expect(updated.title).toBe("Spring cleanup");
    expect(updated.everyN).toBe(6);
    expect(updated.unit).toBe("month");
  });

  it("purges the row for good", async () => {
    h = await createSeededHarness();
    const rule = await recurring.create({
      title: "Gone",
      everyN: 1,
      unit: "year",
      nextDueOn: day(1),
    });
    await recurring.purge(rule.id);
    expect(await recurring.get(rule.id)).toBeNull();
  });

  it("keeps the rule when the contact it pointed at is purged", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Nella", lastName: "Okonkwo" });
    const rule = await recurring.create({
      title: "Aeration",
      everyN: 1,
      unit: "year",
      nextDueOn: day(1),
      contactId: contact.id,
    });

    await contacts.purge(contact.id);
    const after = await recurring.get(rule.id);
    // ON DELETE SET NULL: the reminder survives without a dangling id.
    expect(after).not.toBeNull();
    expect(after?.contactId).toBeNull();
  });
});
