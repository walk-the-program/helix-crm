import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as contacts from "../../src/db/repos/contacts";
import * as companies from "../../src/db/repos/companies";
import {
  __resetWriteLockForTests,
  isWriteBusy,
  withTransaction,
  withWrite,
  writeState,
} from "../../src/db/writeLock";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
  __resetWriteLockForTests();
});

describe("driver semantics: aliasing a join with duplicate column names", () => {
  it("maps a hand-aliased join of contacts.id and companies.id correctly", async () => {
    h = await createHarness();
    const company = await companies.create({ name: "Aliased Co" });
    const contact = await contacts.create({
      firstName: "Aliased",
      lastName: "Contact",
      companyId: company.id,
    });

    // Both tables have a column named "id"; aliasing keeps them distinct.
    const rows = await raw.query(
      `SELECT c.id AS c_id, co.id AS co_id, co.name AS co_name
       FROM contacts c JOIN companies co ON co.id = c.company_id
       WHERE c.id = ?`,
      [contact.id],
    );
    expect(rows).toHaveLength(1);
    const [cId, coId, coName] = rows[0];
    expect(String(cId)).toBe(contact.id);
    expect(String(coId)).toBe(company.id);
    expect(String(coName)).toBe("Aliased Co");
  });

  it("returns the right contact id and company name through the repository function", async () => {
    h = await createHarness();
    const company = await companies.create({ name: "Repo Join Co" });
    const contact = await contacts.create({
      firstName: "Repo",
      lastName: "Join",
      companyId: company.id,
    });

    const { rows } = await contacts.list({ search: "Repo Join" });
    const found = rows.find((c) => c.id === contact.id);
    expect(found).toBeDefined();
    expect(found?.companyId).toBe(company.id);
    expect(found?.companyName).toBe("Repo Join Co");
  });

  it("negative control: an UNALIASED duplicate column name collapses in object mode", async () => {
    h = await createHarness();
    const company = await companies.create({ name: "Collision Co" });
    const contact = await contacts.create({
      firstName: "Collision",
      lastName: "Contact",
      companyId: company.id,
    });

    // Bypass the app's raw.query (which always reads rows positionally) to
    // show what the aliasing convention protects against: object-mode access
    // to a query that names two columns "id" only keeps the last one.
    const stmt = h.driver
      .handle()
      .prepare(
        `SELECT c.id AS id, co.id AS id FROM contacts c
         JOIN companies co ON co.id = c.company_id WHERE c.id = ?`,
      );
    const row = stmt.get(contact.id) as Record<string, unknown>;
    expect(Object.keys(row)).toEqual(["id"]);
    // The second "id" (the company's) silently wins over the contact's own id.
    expect(row.id).toBe(company.id);
    expect(row.id).not.toBe(contact.id);
  });
});

describe("driver semantics: raw.batch rollback, standalone", () => {
  it("leaves zero rows behind when a statement mid-batch fails", async () => {
    h = await createHarness();
    await expect(
      raw.batch([
        { sql: `INSERT INTO sources (id, name) VALUES (?, ?)`, params: ["src-1", "Good"] },
        { sql: `THIS IS NOT VALID SQL`, params: [] },
      ]),
    ).rejects.toThrow();

    const rows = await raw.query(`SELECT count(*) AS n FROM sources`);
    expect(Number(rows[0][0])).toBe(0);
  });
});

describe("driver semantics: raw.batch rollback inside an open transaction", () => {
  it("rolls back only the failed batch's savepoint; the earlier insert survives and commit keeps it", async () => {
    h = await createHarness();
    await raw.begin();
    await raw.execute(`INSERT INTO sources (id, name) VALUES (?, ?)`, ["src-keep", "Keep"]);

    await expect(
      raw.batch([
        { sql: `INSERT INTO sources (id, name) VALUES (?, ?)`, params: ["src-nope", "Nope"] },
        { sql: `THIS IS NOT VALID SQL`, params: [] },
      ]),
    ).rejects.toThrow();

    await raw.commit();

    const rows = await raw.query(`SELECT name AS name FROM sources ORDER BY name`);
    expect(rows.map((r) => String(r[0]))).toEqual(["Keep"]);
  });
});

describe("driver semantics: raw.rollback with no open transaction", () => {
  it("throws a TX_STATE error, matching the Rust pipe", async () => {
    h = await createHarness();
    await expect(raw.rollback()).rejects.toMatchObject({ code: "TX_STATE" });
  });
});

describe("driver semantics: the write lock queues a second write", () => {
  it("queues the second write until the first releases, and runs both in order", async () => {
    h = await createHarness();
    const order: string[] = [];
    // Definite assignment: the executor runs synchronously, but TypeScript
    // cannot see that, so it would otherwise narrow this to null.
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withWrite(async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
    }, "First write");

    // Let acquire() run so the lock state settles before we assert on it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isWriteBusy()).toBe(true);
    expect(writeState.busy).toBe(true);

    let secondRan = false;
    const second = withWrite(async () => {
      secondRan = true;
      order.push("second-start");
    }, "Second write");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondRan).toBe(false);
    expect(writeState.queued).toBeGreaterThanOrEqual(1);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    expect(isWriteBusy()).toBe(false);
  });
});

describe("driver semantics: withTransaction", () => {
  it("commits on success", async () => {
    h = await createHarness();
    await withTransaction(async () => {
      await raw.execute(`INSERT INTO sources (id, name) VALUES (?, ?)`, [
        "tx-commit",
        "Committed",
      ]);
    });
    const rows = await raw.query(`SELECT count(*) AS n FROM sources WHERE id = ?`, [
      "tx-commit",
    ]);
    expect(Number(rows[0][0])).toBe(1);
  });

  it("rolls back on a thrown error, leaving no rows behind", async () => {
    h = await createHarness();
    await expect(
      withTransaction(async () => {
        await raw.execute(`INSERT INTO sources (id, name) VALUES (?, ?)`, [
          "tx-rollback",
          "Rolled back",
        ]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await raw.query(`SELECT count(*) AS n FROM sources WHERE id = ?`, [
      "tx-rollback",
    ]);
    expect(Number(rows[0][0])).toBe(0);
  });
});
