/**
 * The 0006-0009 chain, from the operations side (LR-OPS-RECHECK).
 *
 * Lead A already proves the payments backfill produces the right numbers
 * (`tests/repo/payments/backfill.test.ts`) and Lead B proves 0007 backfills
 * `tasks.source` on a populated workspace (`tests/repo/tasks/visitColumns.test.ts`).
 * This file covers the three things neither of them is about, all of which are
 * about the UPGRADE rather than the feature:
 *
 *   1. the upgrade runs exactly once, so a backfill that inserts a row per
 *      already-paid invoice cannot double it on a later launch;
 *   2. the newer-schema refusal added in LR-OPS still reads correctly for the
 *      real scenario it was written for - a v0.1.0 installer put back over a
 *      workspace a v0.2 build has already migrated - using the actual 0006-0009
 *      tags rather than a fabricated future one;
 *   3. the transaction-safety check in `migrations.test.ts` really did see the
 *      four new files. It reads the journal dynamically, which is the right
 *      design and also means its coverage is invisible: nothing fails if the
 *      journal is ever trimmed. This names the four tags out loud.
 */
import { afterEach, describe, expect, it } from "vitest";
import { raw, setDriver } from "../../src/db/client";
import {
  migrate,
  newerSchemaMessage,
  NewerSchemaError,
  splitStatements,
  type MigrationSource,
} from "../../src/db/migrator";
import { __resetWriteLockForTests } from "../../src/db/writeLock";
import { createTestDriver, type TestDriver } from "./driver";
import { diskMigrationSource } from "./harness";
import * as documents from "../../src/db/repos/documents";
import { newId } from "../../src/lib/ids";
import { nowIso } from "../../src/lib/dates";

/** The chain this recheck is about. */
const PX_TAGS = ["0006_payments", "0007_visits", "0008_automations", "0009_visit_note"];

let driver: TestDriver | null = null;
afterEach(() => {
  __resetWriteLockForTests();
  driver?.dispose();
  driver = null;
});

async function sourceThroughTag(tag: string): Promise<MigrationSource> {
  const all = await diskMigrationSource.list();
  const index = all.findIndex((f) => f.tag === tag);
  if (index === -1) throw new Error(`No migration is tagged ${tag}.`);
  const files = all.slice(0, index + 1);
  return {
    async list() {
      return files;
    },
  };
}

/** A fresh in-memory workspace stopped at `tag`, seeded the way a real one is. */
async function bootAt(tag: string): Promise<void> {
  __resetWriteLockForTests();
  driver = createTestDriver(":memory:");
  setDriver(driver);
  await migrate({ source: await sourceThroughTag(tag), backup: false });
  const { seedWorkspace } = await import("../../src/db/repos/seed");
  await seedWorkspace();
}

async function count(sql: string): Promise<number> {
  const rows = await raw.query(sql, []);
  return Number(rows[0][0]);
}

/**
 * One invoice, sent and then marked paid the pre-0006 way (a status and a
 * `paid_on` on the document itself), which is exactly the shape the backfill
 * looks for.
 */
async function seedPaidInvoice(): Promise<void> {
  // Raw SQL rather than the repositories, for the reason Lead A's backfill
  // test spells out at length: today's `stages.ts` and `deals.ts` select
  // columns that 0008 added, and SQLite refuses a statement naming a missing
  // column at PREPARE time, so those repos cannot run against a workspace
  // still sitting on 0005 whatever the data is.
  const stageRows = await raw.query(
    `SELECT s.id FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
      ORDER BY s.position ASC LIMIT 1`,
    [],
  );
  const stageId = String(stageRows[0][0]);
  const dealId = newId();
  const at = nowIso();
  // A deal belongs to a pipeline through its stage; there is no pipeline_id
  // column on `deals`.
  await raw.execute(
    `INSERT INTO deals (id, title, stage_id, stage_entered_at, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [dealId, "Spring cleanup", stageId, at, at, at],
  );
  const created = await documents.create({
    kind: "invoice",
    dealId,
    prefix: "INV",
    taxRateBp: 0,
    issuedOn: "2026-08-01",
    dueOn: "2026-08-15",
    items: [{ name: "Service", qty: 1, unitCents: 42_000, taxable: false }],
  });
  await documents.send(created.id, { at: "2026-08-01T09:00:00.000Z" });
  await raw.execute(
    `UPDATE documents SET status = 'paid', paid_on = ?, paid_method = 'card', updated_at = ? WHERE id = ?`,
    ["2026-08-10", at, created.id],
  );
}

/* -------------------------------------------------------------------------- */
/* 1. the upgrade runs once                                                   */
/* -------------------------------------------------------------------------- */

describe("0005 -> 0009 on a populated workspace, applied twice", () => {
  /**
   * The backfill in 0006 is an `INSERT ... SELECT` over every already-paid
   * invoice. Run twice, it would give the owner two payments for one invoice
   * and double their Collected figure - so the thing that has to hold is not
   * that the INSERT is self-guarding (it is not, and does not need to be) but
   * that `schema_migrations` means it can never be offered a second time.
   */
  it("applies the four migrations once, and a second migrate() applies nothing and doubles nothing", async () => {
    await bootAt("0005_lead_dedup");
    await seedPaidInvoice();
    expect(await count("SELECT count(*) FROM documents WHERE status = 'paid'")).toBe(1);

    const first = await migrate({ source: diskMigrationSource, backup: false });
    expect(first.applied).toEqual(expect.arrayContaining(PX_TAGS));

    const paymentsAfterFirst = await count("SELECT count(*) FROM payments");
    const automationsAfterFirst = await count("SELECT count(*) FROM automations");
    expect(paymentsAfterFirst, "one payment per already-paid invoice").toBe(1);
    expect(automationsAfterFirst, "the three seeded rules").toBe(3);

    // The second launch of the same build, which is what actually happens
    // every morning for the rest of the workspace's life.
    const second = await migrate({ source: diskMigrationSource, backup: false });
    expect(second.applied, "nothing is pending the second time").toEqual([]);
    expect(await count("SELECT count(*) FROM payments")).toBe(paymentsAfterFirst);
    expect(await count("SELECT count(*) FROM automations")).toBe(automationsAfterFirst);
  });

  /**
   * Belt and braces on the one file that seeds rows rather than only shaping
   * tables. `schema_migrations` above is the real guard; this asserts 0008's
   * own `WHERE NOT EXISTS` would hold even if a future hand ever replayed it,
   * which is the kind of thing that gets done during a support call.
   */
  it("0008's three seeded rules survive a deliberate replay of just that file", async () => {
    await bootAt("0009_visit_note");
    expect(await count("SELECT count(*) FROM automations")).toBe(3);

    const all = await diskMigrationSource.list();
    const file = all.find((f) => f.tag === "0008_automations");
    expect(file, "0008 is in the journal").toBeTruthy();
    // Only the INSERTs: replaying the CREATE TABLEs would fail for an
    // unrelated reason and prove nothing about the seed rows.
    for (const statement of splitStatements(file!.sql)) {
      if (!/^\s*INSERT\s+INTO/i.test(statement.replace(/^\s*--.*$/gm, "").trim())) continue;
      await raw.execute(statement, []);
    }
    expect(await count("SELECT count(*) FROM automations"), "still three, not six").toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. the v0.1.0 installer put back over a v0.2 workspace                     */
/* -------------------------------------------------------------------------- */

describe("a v0.1.0 build opening a v0.2 workspace (LR-OPS F-OPS-8, rechecked)", () => {
  /**
   * The scenario the refusal was written for, now that the future versions it
   * has to recognise are real ones rather than a fabricated tag: the owner
   * reinstalls the installer they still have in Downloads, which knows the
   * journal up to 0005, over a workspace this build already took to 0009.
   */
  it("refuses, names all four versions it does not know, and changes nothing", async () => {
    await bootAt("0009_visit_note");
    await seedPaidInvoice();
    const paymentsBefore = await count("SELECT count(*) FROM payments");

    const oldBuild = await sourceThroughTag("0005_lead_dedup");
    const error = await migrate({ source: oldBuild, backup: false }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(NewerSchemaError);
    const refusal = error as NewerSchemaError;
    expect(refusal.message).toBe(newerSchemaMessage());
    expect(refusal.unknownVersions.sort()).toEqual([...PX_TAGS].sort());

    // "Your data has not been changed" has to be true, not just reassuring.
    expect(await count("SELECT count(*) FROM payments")).toBe(paymentsBefore);
    expect(await count("SELECT count(*) FROM automations")).toBe(3);
    const applied = await raw.query(
      "SELECT version FROM schema_migrations ORDER BY version",
      [],
    );
    expect(applied.map((r) => String(r[0]))).toEqual(
      (await diskMigrationSource.list()).map((f) => f.tag),
    );
  });

  /**
   * The message is what a non-technical owner acts on, so it is pinned
   * separately from the mechanism: it names the fix and offers nothing it
   * cannot do.
   */
  it("still tells the owner to install the newer Helix, and offers no repair", () => {
    const message = newerSchemaMessage();
    expect(message).toContain("newer version of Helix");
    expect(message).toContain("Install the latest version");
    expect(message).toContain("has not been changed");
    for (const word of ["delete", "repair", "downgrade", "reset"]) {
      expect(message.toLowerCase()).not.toContain(word);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. the transaction-safety check covers the new chain                       */
/* -------------------------------------------------------------------------- */

describe("transaction safety reaches the four new migrations", () => {
  /**
   * `migrations.test.ts` walks whatever the journal holds, which is right and
   * also means it would silently pass on a journal that had lost these four.
   * This is the named half of that check.
   */
  it("the journal carries 0006-0009, and every statement in them is transaction-safe", async () => {
    const files = await diskMigrationSource.list();
    const tags = files.map((f) => f.tag);
    for (const tag of PX_TAGS) expect(tags).toContain(tag);

    const NON_TRANSACTIONAL =
      /\bVACUUM\b|\bPRAGMA\b|\bATTACH\s+DATABASE\b|\bDETACH\s+DATABASE\b|^\s*BEGIN\b|^\s*COMMIT\b|^\s*ROLLBACK\b/im;
    const ALLOWED =
      /^(CREATE(\s+UNIQUE)?\s+(TABLE|INDEX|VIEW|TRIGGER|VIRTUAL TABLE)|ALTER TABLE|DROP\s+(VIEW|TABLE|INDEX|TRIGGER)(\s+IF\s+EXISTS)?|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i;

    let checked = 0;
    for (const file of files.filter((f) => PX_TAGS.includes(f.tag))) {
      for (const statement of splitStatements(file.sql)) {
        const code = statement
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*--.*$/gm, "")
          .trim();
        expect(NON_TRANSACTIONAL.test(statement), `${file.tag}: ${code.slice(0, 60)}`).toBe(
          false,
        );
        expect(ALLOWED.test(code), `${file.tag}: ${code.slice(0, 60)}`).toBe(true);
        checked += 1;
      }
    }
    // A loop that checked nothing would pass every assertion above.
    expect(checked, "statements actually inspected across 0006-0009").toBeGreaterThan(10);
  });
});
