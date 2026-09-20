/**
 * The templates repository against a real SQLite file, including the first-use
 * seed.
 *
 * The seed is the part worth testing hardest: it has to run exactly once per
 * workspace, and an owner who throws all four starters away must not find them
 * back on his next visit.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as templates from "../../../src/db/repos/templates";
import * as trash from "../../../src/db/repos/trash";
import {
  MERGE_FIELDS,
  unknownFieldsIn,
} from "../../../src/features/templates/lib/merge";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("templates: create", () => {
  it("stores a text template without a subject", async () => {
    h = await createSeededHarness();
    const template = await templates.create({
      kind: "text",
      name: "Running late",
      subject: "ignored for a text",
      body: "Running about 20 minutes behind.",
    });

    expect(template.kind).toBe("text");
    expect(template.name).toBe("Running late");
    expect(template.subject).toBeNull();
    expect(template.position).toBe(0);
  });

  it("keeps the subject on an email template", async () => {
    h = await createSeededHarness();
    const template = await templates.create({
      kind: "email",
      name: "Quote sent",
      subject: "Your quote from {{business_name}}",
      body: "Hi {{first_name}},",
    });
    expect(template.subject).toBe("Your quote from {{business_name}}");
  });

  it("appends to the end of the list", async () => {
    h = await createSeededHarness();
    const first = await templates.create({ kind: "text", name: "One", body: "a" });
    const second = await templates.create({ kind: "email", name: "Two", body: "b" });
    const third = await templates.create({ kind: "text", name: "Three", body: "c" });
    expect([first.position, second.position, third.position]).toEqual([0, 1, 2]);
  });

  it("refuses an empty name or an empty body", async () => {
    h = await createSeededHarness();
    await expect(
      templates.create({ kind: "text", name: "   ", body: "something" }),
    ).rejects.toThrow();
    await expect(templates.create({ kind: "text", name: "Named", body: "  " })).rejects.toThrow();
  });

  it("logs the create", async () => {
    h = await createSeededHarness();
    const template = await templates.create({ kind: "text", name: "One", body: "a" });
    const rows = await raw.query(
      `SELECT op FROM change_log WHERE entity_type = 'template' AND entity_id = ?`,
      [template.id],
    );
    expect(rows.map((r) => String(r[0]))).toEqual(["create"]);
  });
});

describe("templates: list", () => {
  it("returns position order and filters by kind", async () => {
    h = await createSeededHarness();
    await templates.create({ kind: "email", name: "Email one", body: "a", position: 1 });
    await templates.create({ kind: "text", name: "Text one", body: "b", position: 0 });
    await templates.create({ kind: "text", name: "Text two", body: "c", position: 2 });

    expect((await templates.list()).map((t) => t.name)).toEqual([
      "Text one",
      "Email one",
      "Text two",
    ]);
    expect((await templates.list({ kind: "text" })).map((t) => t.name)).toEqual([
      "Text one",
      "Text two",
    ]);
  });

  it("hides a deleted template until it is restored", async () => {
    h = await createSeededHarness();
    const template = await templates.create({ kind: "text", name: "Gone", body: "a" });

    await templates.softDelete(template.id);
    expect(await templates.list()).toHaveLength(0);
    expect(await templates.list({ includeDeleted: true })).toHaveLength(1);

    await templates.restore(template.id);
    expect(await templates.list()).toHaveLength(1);
  });
});

describe("templates: update", () => {
  it("edits the wording and trims the name", async () => {
    h = await createSeededHarness();
    const template = await templates.create({ kind: "text", name: "Old", body: "a" });
    const updated = await templates.update(template.id, {
      name: "  New name  ",
      body: "Hi {{first_name}}",
    });
    expect(updated.name).toBe("New name");
    expect(updated.body).toBe("Hi {{first_name}}");
  });

  it("drops the subject when an email becomes a text", async () => {
    h = await createSeededHarness();
    const template = await templates.create({
      kind: "email",
      name: "Quote sent",
      subject: "Your quote",
      body: "Hi",
    });
    const updated = await templates.update(template.id, { kind: "text" });
    expect(updated.kind).toBe("text");
    expect(updated.subject).toBeNull();
  });

  it("keeps the subject when only the body changes", async () => {
    h = await createSeededHarness();
    const template = await templates.create({
      kind: "email",
      name: "Quote sent",
      subject: "Your quote",
      body: "Hi",
    });
    const updated = await templates.update(template.id, { body: "Hi there" });
    expect(updated.subject).toBe("Your quote");
  });
});

describe("templates: reorder", () => {
  it("rewrites positions in the order given", async () => {
    h = await createSeededHarness();
    const a = await templates.create({ kind: "text", name: "A", body: "a" });
    const b = await templates.create({ kind: "text", name: "B", body: "b" });
    const c = await templates.create({ kind: "text", name: "C", body: "c" });

    await templates.reorder([c.id, a.id, b.id]);
    expect((await templates.list({ kind: "text" })).map((t) => t.name)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("leaves the other kind alone", async () => {
    h = await createSeededHarness();
    const text1 = await templates.create({ kind: "text", name: "T1", body: "a" });
    const text2 = await templates.create({ kind: "text", name: "T2", body: "b" });
    const email = await templates.create({ kind: "email", name: "E1", body: "c" });
    const before = email.position;

    await templates.reorder([text2.id, text1.id]);
    const after = await templates.get(email.id);
    expect(after?.position).toBe(before);
  });
});

describe("templates: the first-use seed", () => {
  it("creates four starters, two texts and two emails", async () => {
    h = await createSeededHarness();
    const created = await templates.ensureStarters();
    expect(created).toBe(4);

    const rows = await templates.list();
    expect(rows).toHaveLength(4);
    expect(rows.filter((t) => t.kind === "text")).toHaveLength(2);
    expect(rows.filter((t) => t.kind === "email")).toHaveLength(2);
    expect(rows.map((t) => t.name)).toEqual([
      "Quote follow-up",
      "Running late",
      "Quote sent",
      "Thank you",
    ]);
  });

  it("gives every email starter a subject and no text starter one", async () => {
    h = await createSeededHarness();
    await templates.ensureStarters();
    for (const row of await templates.list()) {
      if (row.kind === "email") expect(row.subject).toBeTruthy();
      else expect(row.subject).toBeNull();
    }
  });

  it("is idempotent: a second call creates nothing", async () => {
    h = await createSeededHarness();
    expect(await templates.ensureStarters()).toBe(4);
    expect(await templates.ensureStarters()).toBe(0);
    expect(await templates.list()).toHaveLength(4);
  });

  it("does not double-seed when two readers ask at the same time", async () => {
    h = await createSeededHarness();
    // A contact page mounts the text picker and the email picker together, and
    // both of them read templates. The count and the inserts are inside one
    // withWrite, so exactly one of these two calls does the work.
    const [first, second] = await Promise.all([
      templates.ensureStarters(),
      templates.ensureStarters(),
    ]);
    expect(first + second).toBe(4);
    expect(await templates.list()).toHaveLength(4);
  });

  it("does not come back after the owner deletes all four", async () => {
    h = await createSeededHarness();
    await templates.ensureStarters();
    for (const row of await templates.list()) {
      await templates.softDelete(row.id);
    }
    expect(await templates.list()).toHaveLength(0);

    expect(await templates.ensureStarters()).toBe(0);
    expect(await templates.list()).toHaveLength(0);
  });

  it("does not come back after a starter is purged through Trash (regression)", async () => {
    h = await createSeededHarness();
    await templates.ensureStarters();
    const rows = await templates.list();
    expect(rows).toHaveLength(4);

    for (const row of rows) {
      await templates.softDelete(row.id);
      await trash.purge("template", row.id);
    }
    const remaining = await raw.query(`SELECT count(*) AS n FROM templates`);
    expect(Number(remaining[0][0])).toBe(0);

    // With the old row-count guard this would see an empty table and seed
    // four more. The templates.seededAt key must stop that.
    expect(await templates.ensureStarters()).toBe(0);
    expect(await templates.list()).toHaveLength(0);
  });

  it("writes exactly one templates.seededAt settings row under concurrent callers", async () => {
    h = await createSeededHarness();
    const [first, second] = await Promise.all([
      templates.ensureStarters(),
      templates.ensureStarters(),
    ]);
    expect(first + second).toBe(4);

    const rows = await raw.query(
      `SELECT count(*) AS n FROM settings WHERE key = 'templates.seededAt'`,
    );
    expect(Number(rows[0][0])).toBe(1);
  });

  it("uses only merge fields the renderer knows", async () => {
    h = await createSeededHarness();
    await templates.ensureStarters();
    for (const row of await templates.list()) {
      expect(unknownFieldsIn(row.body)).toEqual([]);
      if (row.subject) expect(unknownFieldsIn(row.subject)).toEqual([]);
    }
  });

  it("says who is writing in every starter", async () => {
    h = await createSeededHarness();
    await templates.ensureStarters();
    for (const row of await templates.list()) {
      const text = `${row.subject ?? ""} ${row.body}`;
      // Either the owner's name or the business's - a text from a number the
      // customer already has does not need the letterhead, and "Running late"
      // deliberately signs off with the name alone.
      expect(
        text.includes("{{owner_name}}") || text.includes("{{business_name}}"),
        `${row.name} does not say who it is from`,
      ).toBe(true);
    }
    // And between them the starters exercise most of the field list, which is
    // the point of shipping them: they are the documentation.
    const all = (await templates.list())
      .map((t) => `${t.subject ?? ""} ${t.body}`)
      .join(" ");
    const used = MERGE_FIELDS.filter((field) => all.includes(`{{${field}}}`));
    expect(used.length).toBeGreaterThanOrEqual(5);
  });

  it("writes no exclamation marks and nothing but ASCII", async () => {
    h = await createSeededHarness();
    await templates.ensureStarters();
    const all = (await templates.list())
      .map((t) => `${t.name} ${t.subject ?? ""} ${t.body}`)
      .join(" ");
    expect(all).not.toContain("!");
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(all)).toBe(true);
  });
});

describe("templates: purge", () => {
  it("removes the row for good", async () => {
    h = await createSeededHarness();
    const template = await templates.create({ kind: "text", name: "Gone", body: "a" });
    await templates.purge(template.id);
    expect(await templates.get(template.id)).toBeNull();
  });
});

describe("templates: migrating to the seededAt key", () => {
  it("treats a workspace that already has templates as already seeded, and records the key", async () => {
    h = await createSeededHarness();
    // A legacy workspace: a row exists (as the old row-count guard would have
    // left it) but the templates.seededAt key was never written, because it
    // did not exist yet.
    await templates.create({ kind: "text", name: "Legacy starter", body: "Hi" });

    expect(await templates.ensureStarters()).toBe(0);
    expect(await templates.list()).toHaveLength(1);

    const settingsRow = await raw.query(
      `SELECT value_json FROM settings WHERE key = 'templates.seededAt'`,
    );
    expect(settingsRow).toHaveLength(1);
  });

  it("does not reseed a legacy workspace even after its only template is purged", async () => {
    h = await createSeededHarness();
    const legacy = await templates.create({ kind: "text", name: "Legacy", body: "Hi" });
    // First call finds the pre-existing row and marks the workspace seeded
    // without inserting anything.
    expect(await templates.ensureStarters()).toBe(0);

    await templates.softDelete(legacy.id);
    await trash.purge("template", legacy.id);
    expect(await templates.list()).toHaveLength(0);

    expect(await templates.ensureStarters()).toBe(0);
    expect(await templates.list()).toHaveLength(0);
  });
});
