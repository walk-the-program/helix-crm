/**
 * The one test that proves the harness itself works: the built app boots in a
 * plain Chromium page, talks to better-sqlite3 through `window.__helixDb`, and
 * renders its shell.
 *
 * Everything else in PLAN.md's e2e list (quick add, import a HubSpot export,
 * drag a deal, complete a task from Today, AI off and on against a local fake)
 * belongs in its own spec beside this one, once those screens exist. Restore
 * and workspace switch stay on the Windows suite and the manual checklist:
 * they are Rust, and this harness cannot prove them.
 */
import { test, expect } from "../fixtures";

test.describe("boot", () => {
  test("the app boots and the sidebar shows Today", async ({ page, helix }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // The shell, not a blank page or an error boundary.
    const sidebar = page.getByRole("navigation");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Today" })).toBeVisible();

    // Today is the landing screen.
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);

    // The bridge is real: the app's own boot created its schema in the file
    // this test owns.
    const tables = helix.bridge.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    expect(tables.length, "boot should have run the migrations").toBeGreaterThan(0);
  });

  test("the database bridge answers the contract's methods", async ({ page, helix }) => {
    await page.goto("/");

    const info = await page.evaluate(() => window.__helixDb!.info());
    expect(info.sqliteVersion).toMatch(/^\d+\.\d+/);
    expect(info.path).toBe(helix.dbPath);
    expect(info.fts5, "search needs FTS5 in the test build of SQLite").toBe(true);

    // A batch rolls back as one unit when a statement in the middle fails.
    helix.bridge.execute("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)", []);
    await expect(
      page.evaluate(() =>
        window.__helixDb!.batch([
          { sql: "INSERT INTO probe (id) VALUES (?)", params: [1] },
          { sql: "INSERT INTO nope (id) VALUES (?)", params: [2] },
        ]),
      ),
    ).rejects.toThrow(/no such table/i);
    expect(helix.bridge.query("SELECT count(*) FROM probe", [])[0][0]).toBe(0);
  });
});
