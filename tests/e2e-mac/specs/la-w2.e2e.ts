/**
 * LA-W2 — independent adversarial verification of the LR-PX round's money,
 * calendar, bulk and reporting surfaces, through the built UI in Chromium
 * (tests/e2e-mac/fixtures.ts). This file does not re-run px-a/px-b/px-c's
 * own specs (those were re-run unmodified for this packet, see the LA-W2
 * return); it covers what they left unproven:
 *
 *   J4 — the Today outstanding line and a customer's own Balance figure,
 *        which px-a-payments.e2e.ts never opens.
 *   J6 — five contacts (not three) through add-tag/undo; a bulk stage move
 *        that fires a follow-up rule EXACTLY once per job, through the real
 *        "Move to stage" bulk-bar control (px-c-bulk.e2e.ts never exercises
 *        the deals list at all); trashing two contacts through the bulk bar
 *        and restoring them from the Trash screen (not the Undo toast); and
 *        the "Export selected" CSV button on Contacts with hostile leading
 *        characters actually reaching a saved file through the real button.
 *
 * J5 (the DST move) and the rest of J4 (deposit/balance/paid/delete/
 * statement/export/Revenue reconciliation) are proved at the repository
 * layer in tests/repo/la-w2/ against real SQLite, which is the more honest
 * surface for exact-instant and exact-cents arithmetic; see the LA-W2 return
 * for why.
 *
 * Run it on this packet's own port and build folder:
 *   E2E_PORT=4332 E2E_OUT=dist-la2 npm run e2e:mac -- la-w2.e2e.ts
 */
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

function quickAddDialog(page: Page) {
  return page.getByRole("dialog", { name: "Quick add" });
}

async function openQuickAdd(page: Page): Promise<void> {
  await expect(page.getByRole("navigation")).toBeVisible();
  const dialog = quickAddDialog(page);
  await page.keyboard.press("Meta+n");
  try {
    await dialog.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    await page.keyboard.press("Meta+Shift+k");
    await page.getByPlaceholder("Search, or type a command").fill("Quick add");
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
  }
}

async function quickAddContact(page: Page, name: string): Promise<void> {
  await openQuickAdd(page);
  const dialog = quickAddDialog(page);
  const nameField = dialog.getByLabel("Name");
  await nameField.fill(name);
  await nameField.press("Enter");
  await expect(dialog).toBeHidden();
}

function stageIdByName(bridge: HelixHarness["bridge"], name: string): string {
  const rows = bridge.query("SELECT id FROM stages WHERE name = ?", [name]);
  if (rows.length === 0) throw new Error(`the seed did not create a "${name}" stage`);
  return String(rows[0][0]);
}

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

async function queueSavePath(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    (window as unknown as { __helixE2E: { dialogQueue: (string | null)[] } }).__helixE2E.dialogQueue.push(p);
  }, path);
}

async function fileText(page: Page, path: string): Promise<string | null> {
  return page.evaluate(
    (p) => (window as unknown as { __helixE2E: { files: Record<string, string> } }).__helixE2E.files[p] ?? null,
    path,
  );
}

test.describe("LA-W2 J4: money surfaces px-a-payments.e2e.ts does not open", () => {
  test("Today's outstanding line and a customer's own Balance move with a partial payment", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;
    await page.goto("/");
    await quickAddContact(page, "Owed Money");
    const [[contactId]] = db.query("SELECT id FROM contacts WHERE deleted_at IS NULL", []) as [
      string,
    ][];

    const dealId = "deal-la-w2-today";
    const now = iso(0);
    db.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, NULL, ?, ?)`,
      [dealId, "Fence repair", 100000, stageIdByName(db, "New"), now, contactId, now, now],
    );
    db.execute(
      `INSERT INTO deal_items (id, deal_id, product_id, name, description, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES (?, ?, NULL, ?, NULL, 'one_time', NULL, 1, ?, ?, 0, 0)`,
      ["item-la-w2-fence", dealId, "Fence repair", 100000, 100000],
    );

    await page.goto(`/deals/${dealId}`);
    const panel = page.getByTestId("deal-invoices-panel");
    await panel.getByRole("button", { name: "Create invoice" }).click();
    await panel.getByRole("link", { name: /^INV-/ }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await queueSavePath(page, "/tmp/e2e/la-w2/invoice.pdf");
    await page.getByRole("button", { name: "Send" }).click();

    // Before any payment: Today names the full amount outstanding.
    await page.getByRole("link", { name: "Today" }).click();
    const outstandingBefore = page.getByTestId("today-outstanding");
    await expect(outstandingBefore).toContainText("$1,000.00");

    // Take a partial payment.
    await page.goBack();
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog", { name: /payment/i });
    await dialog.getByLabel("Amount").fill("400");
    await dialog.getByRole("combobox", { name: "How it was paid" }).click();
    await page.getByRole("option", { name: "Cash" }).click();
    await dialog.getByRole("button", { name: /^(Record payment|Save payment)$/ }).click();
    await expect(dialog).toBeHidden();

    // Today now names the BALANCE ($600), not the original total, and counts
    // it as "part paid" rather than plain "unpaid".
    await page.getByRole("link", { name: "Today" }).click();
    const outstandingAfter = page.getByTestId("today-outstanding");
    await expect(outstandingAfter).toContainText("$600.00");
    await expect(outstandingAfter).toContainText(/part paid/);

    // The customer's own page adds up the same balance.
    await page.goto(`/contacts/${contactId}`);
    await expect(page.getByText("Balance")).toBeVisible();
    await expect(page.getByText("$600.00")).toBeVisible();

    // And it agrees with the database's own figure, independently queried.
    const [[balanceRow]] = db.query(
      `SELECT d.total_cents - coalesce((SELECT sum(p.amount_cents) FROM payments p WHERE p.document_id = d.id AND p.deleted_at IS NULL), 0)
       FROM documents d WHERE d.deal_id = ? AND d.kind = 'invoice'`,
      [dealId],
    ) as [number][];
    expect(Number(balanceRow)).toBe(60000);
  });
});

test.describe("LA-W2 J6: bulk actions, through the real controls", () => {
  test("five contacts, add a tag, undo restores the exact prior state", async ({ page, helix }) => {
    await page.goto("/");
    for (const name of ["Alpha One", "Bravo Two", "Charlie Three", "Delta Four", "Echo Five"]) {
      await quickAddContact(page, name);
    }
    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["e2e-tag-la-w2", "Priority", "var(--stage-1)", now, now],
    );

    await page.goto("/contacts");
    await expect(page.getByRole("list", { name: "Contacts" })).toBeVisible();
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Select Alpha One" }).click();
    await page.getByRole("checkbox", { name: "Select Echo Five" }).click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("bulk-bar-count")).toHaveText("5 people selected");

    await page.getByRole("button", { name: "Add tag" }).click();
    await page.getByRole("menuitem", { name: "Priority" }).click();
    await expect(page.getByText("Added the tag Priority to 5 people")).toBeVisible();

    const linksAfterAdd = helix.bridge.query(
      `SELECT count(*) FROM tag_links WHERE tag_id = ? AND entity_type = 'contact' AND deleted_at IS NULL`,
      ["e2e-tag-la-w2"],
    ) as [number][];
    expect(linksAfterAdd[0][0]).toBe(5);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Undone: added the tag Priority to 5 people")).toBeVisible();
    const linksAfterUndo = helix.bridge.query(
      `SELECT count(*) FROM tag_links WHERE tag_id = ? AND entity_type = 'contact' AND deleted_at IS NULL`,
      ["e2e-tag-la-w2"],
    ) as [number][];
    expect(linksAfterUndo[0][0]).toBe(0);
  });

  test("three jobs moved to a stage with a follow-up rule create EXACTLY three tasks, through the bulk-bar's own Move to stage control", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    const quotedStageId = stageIdByName(db, "Quoted");
    db.execute(
      `UPDATE stages SET follow_up_days = 2, follow_up_title = 'Follow up with {name}' WHERE id = ?`,
      [quotedStageId],
    );

    const newStageId = stageIdByName(db, "New");
    const now = iso(0);
    const dealIds = ["deal-la-w2-a", "deal-la-w2-b", "deal-la-w2-c"];
    for (const [i, id] of dealIds.entries()) {
      db.execute(
        `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?)`,
        [id, `Bulk job ${i + 1}`, 10000, newStageId, now, i, now, now],
      );
    }

    await page.goto("/pipeline");
    await page.getByRole("button", { name: "List view" }).click();

    for (let i = 0; i < dealIds.length; i++) {
      const checkbox = page.getByRole("checkbox", { name: `Select Bulk job ${i + 1}` });
      if (i === 0) await checkbox.click();
      else await checkbox.click({ modifiers: i === dealIds.length - 1 ? ["Shift"] : [] });
    }
    await expect(page.getByTestId("bulk-bar-count")).toContainText("3");

    await page.getByRole("button", { name: "Move to stage" }).click();
    await page.getByTestId("bulk-move-stage-menu").getByRole("menuitem", { name: "Quoted" }).click();
    await expect(page.getByText(/Moved 3 .+ to Quoted/)).toBeVisible();

    for (const id of dealIds) {
      const rows = db.query(`SELECT stage_id FROM deals WHERE id = ?`, [id]) as [string][];
      expect(rows[0][0]).toBe(quotedStageId);
    }

    // Not 0, not 3×N: exactly one automation task per job.
    const tasks = db.query(
      `SELECT deal_id FROM tasks WHERE source = 'automation' AND deal_id IN (?, ?, ?)`,
      dealIds,
    ) as [string][];
    expect(tasks).toHaveLength(3);
    expect(new Set(tasks.map((r) => r[0])).size).toBe(3);
  });

  test("two contacts trashed through the bulk bar, and restored from the Trash screen", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await quickAddContact(page, "Trash Bulk One");
    await quickAddContact(page, "Trash Bulk Two");
    await quickAddContact(page, "Keep Me");

    await page.goto("/contacts");
    await page.getByRole("checkbox", { name: "Select Trash Bulk One" }).click();
    await page.getByRole("checkbox", { name: "Select Trash Bulk Two" }).click({ modifiers: ["Meta"] });
    await expect(page.getByTestId("bulk-bar-count")).toHaveText("2 people selected");

    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Move to trash", exact: true }).last().click();
    await expect(page.getByText("Moved 2 contacts to trash")).toBeVisible();

    const trashedCount = helix.bridge.query(
      `SELECT count(*) FROM contacts WHERE deleted_at IS NOT NULL`,
      [],
    ) as [number][];
    expect(trashedCount[0][0]).toBe(2);

    await page.getByRole("navigation").getByRole("link", { name: "Trash" }).click();
    for (const name of ["Trash Bulk One", "Trash Bulk Two"]) {
      const row = page.getByRole("row", { name: new RegExp(name) });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Restore" }).click();
    }

    const remainingTrashed = helix.bridge.query(
      `SELECT count(*) FROM contacts WHERE deleted_at IS NOT NULL`,
      [],
    ) as [number][];
    expect(remainingTrashed[0][0]).toBe(0);
    const liveCount = helix.bridge.query(
      `SELECT count(*) FROM contacts WHERE deleted_at IS NULL`,
      [],
    ) as [number][];
    expect(liveCount[0][0]).toBe(3);
  });

  test("Export selected applies the formula guard to every hostile leading character", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    // Seven contacts, one per hostile case the packet names: leading
    // =, +, -, @, TAB, CR, LF. The phone field carries the hostile value
    // raw (untrimmed by any UI code path), because the display name IS
    // trimmed before export (contactName() trims the whole string), which
    // would silently eat a leading TAB/CR/LF before it ever reached a cell -
    // proving nothing about the guard itself.
    const cases: { name: string; phone: string }[] = [
      { name: "Hostile Eq", phone: "=1+1" },
      { name: "Hostile Plus", phone: "+1" },
      { name: "Hostile Minus", phone: "-1" },
      { name: "Hostile At", phone: "@home" },
      { name: "Hostile Tab", phone: "\t" },
      { name: "Hostile Cr", phone: "\r" },
      { name: "Hostile Lf", phone: "\n" },
    ];
    const now = new Date().toISOString();
    for (const [i, c] of cases.entries()) {
      const contactId = `la-w2-hostile-${i}`;
      const [first, ...rest] = c.name.split(" ");
      db.execute(
        `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [contactId, first, rest.join(" "), now, now],
      );
      db.execute(
        `INSERT INTO contact_phones (id, contact_id, raw, e164, label, is_primary, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'mobile', 1, ?, ?)`,
        [`${contactId}-phone`, contactId, c.phone, now, now],
      );
    }

    await page.goto("/contacts");
    await expect(page.getByRole("list", { name: "Contacts" })).toBeVisible();
    await page.getByLabel("Select every contact in this filter").click();
    await expect(page.getByTestId("bulk-bar-count")).toHaveText("7 people selected");

    await queueSavePath(page, "/tmp/e2e/la-w2/hostile-export.csv");
    await page.getByRole("button", { name: "Export selected" }).click();
    await expect(page.getByText("Exported 7 contacts")).toBeVisible();

    const csv = await fileText(page, "/tmp/e2e/la-w2/hostile-export.csv");
    expect(csv).not.toBeNull();
    const body = csv as string;

    // Every leading trigger character is guarded with a leading apostrophe
    // and quoted, exactly as escapeCell()/guardCell() specify.
    expect(body).toContain(`"'=1+1"`);
    expect(body).toContain(`"'+1"`);
    expect(body).toContain(`"'-1"`);
    expect(body).toContain(`"'@home"`);
    expect(body).toContain(`"'\t"`);
    expect(body).toContain(`"'\r"`);
    expect(body).toContain(`"'\n"`);

    // And none of the raw, unguarded triggers made it through unescaped
    // (a naive ",=1+1," with no leading quote would be a live formula cell
    // in Excel/Sheets).
    expect(body).not.toContain(",=1+1,");
    expect(body).not.toContain(",+1,");
    expect(body).not.toContain(",-1,");
    expect(body).not.toContain(",@home,");
  });
});
