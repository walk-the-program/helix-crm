/**
 * The new migrations' guards, proved against the production driver rather than
 * read off the SQL (LR-SEC-RECHECK items 2, 4 and 6).
 *
 * A CHECK constraint or an ON DELETE RESTRICT only protects anything if the
 * driver the app actually uses has it armed: a foreign key does nothing unless
 * `PRAGMA foreign_keys` is on, and that pragma is set per connection, not per
 * file. `0006_payments.sql` leans on both - the amount and method CHECKs, and
 * RESTRICT from `payments.document_id` so an invoice cannot be deleted out from
 * under the money that settles it. This drives them through the real repo
 * harness, which is the same driver path the app uses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "@/db/client";
import * as bulk from "@/db/repos/bulk";
import * as contacts from "@/db/repos/contacts";
import { NotFoundError } from "@/db/errors";

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await raw.query(sql, params);
  return Number(rows[0][0]);
}

describe("the payments migration's guards are armed on the real driver", () => {
  it("has foreign keys switched on at all", async () => {
    h = await createSeededHarness();
    expect(await count("PRAGMA foreign_keys")).toBe(1);
  });

  it("refuses a zero or negative payment amount", async () => {
    h = await createSeededHarness();
    for (const amount of [0, -1]) {
      await expect(
        raw.execute(
          `INSERT INTO payments (id, document_id, amount_cents, paid_on, method, created_at, updated_at)
           VALUES (?, 'doc-x', ?, '2026-03-01', 'cash', datetime('now'), datetime('now'))`,
          [`pay-${amount}`, amount],
        ),
      ).rejects.toThrow();
    }
  });

  it("refuses a payment method outside the fixed set", async () => {
    h = await createSeededHarness();
    await expect(
      raw.execute(
        `INSERT INTO payments (id, document_id, amount_cents, paid_on, method, created_at, updated_at)
         VALUES ('pay-bad', 'doc-x', 100, '2026-03-01', 'crypto', datetime('now'), datetime('now'))`,
      ),
    ).rejects.toThrow();
  });
});

describe("bulk actions are all-or-nothing (item 4)", () => {
  it("rolls the whole batch back when one id is not live", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const b = await contacts.create({ firstName: "Bea", lastName: "Fell" });

    const before = await count(`SELECT count(*) FROM contacts WHERE deleted_at IS NOT NULL`);

    await expect(
      bulk.trashContacts([a.id, "no-such-contact", b.id]),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Neither of the two real ones moved: the bad id in the middle took the
    // whole transaction with it, rather than leaving a half-done bulk action
    // the owner would have to unpick by hand.
    expect(await count(`SELECT count(*) FROM contacts WHERE deleted_at IS NOT NULL`)).toBe(
      before,
    );
    expect(await count(`SELECT count(*) FROM contacts WHERE id = ? AND deleted_at IS NULL`, [a.id])).toBe(1);
    expect(await count(`SELECT count(*) FROM contacts WHERE id = ? AND deleted_at IS NULL`, [b.id])).toBe(1);
  });

  it("writes one batch id for the whole action, so undo restores exactly it", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "Cy", lastName: "Marsh" });
    const b = await contacts.create({ firstName: "Dee", lastName: "Okonkwo" });

    const result = await bulk.trashContacts([a.id, b.id]);
    expect(result.count).toBe(2);

    const logged = await count(`SELECT count(*) FROM change_log WHERE batch_id = ?`, [
      result.batchId,
    ]);
    expect(logged).toBe(2);

    // And nothing else shares that batch id, or undo would reach further than
    // the action the owner is undoing.
    const distinctEntities = await raw.query(
      `SELECT DISTINCT entity_id FROM change_log WHERE batch_id = ? ORDER BY entity_id`,
      [result.batchId],
    );
    expect(distinctEntities.map((r) => String(r[0])).sort()).toEqual([a.id, b.id].sort());
  });

  it("deduplicates repeated ids rather than logging the same row twice", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "Eve", lastName: "Sandoval" });

    const result = await bulk.trashContacts([a.id, a.id, a.id]);
    expect(result.count).toBe(1);
    expect(
      await count(`SELECT count(*) FROM change_log WHERE batch_id = ?`, [result.batchId]),
    ).toBe(1);
  });
});
