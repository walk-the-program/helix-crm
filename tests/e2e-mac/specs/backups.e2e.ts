/**
 * LR-OPS-W1b: the three panels LR-OPS added below the Backups table
 * (docs/CONTRACTS.md "Recovery and the second backup copy") - the recovery
 * key, opening a backup from another machine, and the second-copy folder.
 *
 * Split out of data.e2e.ts rather than added to it: that spec is already 770+
 * lines and already owns the backups TABLE (list/run/restore); this is a
 * separate, self-contained slice of the same screen.
 *
 * What this harness can prove: the three panels render, the key is not in the
 * DOM until asked for and leaves again on "Hide", a refused adopt shows the
 * real message Rust gave rather than "[object Object]", and choosing a
 * second-copy folder persists `backupCopyDir` and calls `backup_mirror` with
 * that folder.
 *
 * What it cannot prove: that the key Rust actually returns opens anything, or
 * that `backup_mirror` actually copies a file — both are exercised for real in
 * `src-tauri/tests/recovery_tests.rs` and `src-tauris/src/backups.rs`'s own
 * unit tests. The stubs here (tests/e2e-mac/fixtures.ts) answer with
 * spec-supplied values; they do not run Rust.
 *
 * Run it on its own port and build folder:
 *   E2E_PORT=4271 E2E_OUT=dist-ops-w1 npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/backups.e2e.ts
 */
import { dirname, join } from "node:path";
import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

type E2EState = {
  dialogQueue: (string | string[] | null)[];
  calls: { cmd: string; args: unknown }[];
  recoveryKey: { key: string; fileText: string };
  adoptBackupError: { code: string; message: string } | null;
  adoptBackupResult: { workspaceId: string; path: string };
  mirrorResult: { path: string; copied: number; removed: number; failed: string[] };
};

/** Queue a path for the next open/save/directory dialog. */
async function queueDialog(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
    state.dialogQueue.push(p);
  }, path);
}

async function calls(page: Page): Promise<{ cmd: string; args: unknown }[]> {
  return page.evaluate(
    () => (window as unknown as { __helixE2E: E2EState }).__helixE2E.calls,
  );
}

test.describe("Backups: recovery key, adopt, and the second copy", () => {
  test("the screen renders all three panels", async ({ page, helix: _helix }) => {
    await page.goto("/settings/backups");
    await expect(page.getByRole("heading", { name: "Backups", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "A second copy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recovery key" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Open a backup from another machine" }),
    ).toBeVisible();
  });

  test("the recovery key is not in the DOM until shown, and leaves again on Hide", async ({
    page,
    helix: _helix,
  }) => {
    await page.goto("/settings/backups");

    // Not rendered at all before the owner asks - not just hidden with CSS -
    // so a screen-share or a shoulder-surf of this screen shows nothing.
    await expect(page.getByTestId("recovery-key")).toHaveCount(0);

    await page.getByRole("button", { name: "Show recovery key" }).click();
    const keyEl = page.getByTestId("recovery-key");
    await expect(keyEl).toBeVisible();
    await expect(keyEl).toHaveText("HLX1-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12");
    await expect(page.getByRole("button", { name: "Save to a file" })).toBeVisible();

    // exact: the sidebar's own "Hide sidebar" toggle otherwise also matches a
    // substring name of "Hide".
    await page.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(page.getByTestId("recovery-key")).toHaveCount(0);
    // Hiding is a full reset, not a re-fetch waiting to happen: showing it
    // again still works from a clean state.
    await page.getByRole("button", { name: "Show recovery key" }).click();
    await expect(page.getByTestId("recovery-key")).toBeVisible();
  });

  test("a refused adopt shows the message Rust gave, not \"[object Object]\"", async ({
    page,
    helix: _helix,
  }) => {
    const REFUSAL =
      "That recovery key does not open this file. Check the key, and check " +
      "that the file came from the workspace the key belongs to. Nothing " +
      "has been changed.";
    await page.goto("/settings/backups");
    await page.evaluate((message) => {
      const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
      state.adoptBackupError = { code: "DB_OPEN_FAILED", message };
    }, REFUSAL);

    await queueDialog(page, "/e2e/backups/2026-09-01T06-00-00Z-scheduled.db");
    await page.getByRole("button", { name: "Choose a backup file" }).click();
    await expect(page.getByText("2026-09-01T06-00-00Z-scheduled.db")).toBeVisible();

    await page.getByLabel("Recovery key").fill("HLX1-0000-0000-0000-0000-0000-0000-0000-0000");
    await page.getByRole("button", { name: "Open this backup" }).click();

    const alert = page.getByRole("alert").filter({ hasText: "recovery key" });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(REFUSAL);
    await expect(page.getByText("[object Object]")).toHaveCount(0);

    // The panel is still usable, not stuck mid-mutation.
    await expect(page.getByRole("button", { name: "Open this backup" })).toBeEnabled();
  });

  test("a successful adopt switches to the new workspace", async ({ page, helix }) => {
    await page.goto("/settings/backups");
    // The real Rust command copies the backup into a brand-new folder under
    // this machine's workspaces directory; the stub cannot copy anything, so
    // it points switchWorkspace at a fresh, writable path under the SAME
    // mkdtemp'd root the `helix` fixture already owns (and cleans up), rather
    // than an arbitrary absolute path this test runner cannot create.
    const adoptedPath = join(dirname(helix.workspaceDir), "e2e-adopted-workspace", "helix.db");
    await page.evaluate((path) => {
      const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
      state.adoptBackupError = null;
      state.adoptBackupResult = { workspaceId: "e2e-adopted-workspace", path };
    }, adoptedPath);

    await queueDialog(page, "/e2e/backups/2026-09-01T06-00-00Z-scheduled.db");
    await page.getByRole("button", { name: "Choose a backup file" }).click();
    await page.getByLabel("Recovery key").fill("HLX1-AB12-AB12-AB12-AB12-AB12-AB12-AB12-AB12");
    await page.getByLabel("Name this workspace").fill("Old laptop");
    await page.getByRole("button", { name: "Open this backup" }).click();

    await expect(page.getByText("Opened Old laptop.")).toBeVisible();

    const made = await calls(page);
    const adopt = made.find((c) => c.cmd === "workspace_adopt_backup");
    expect(adopt).toBeTruthy();
    expect((adopt?.args as { sourcePath: string }).sourcePath).toBe(
      "/e2e/backups/2026-09-01T06-00-00Z-scheduled.db",
    );
  });

  test("choosing a second-copy folder persists backupCopyDir and calls backup_mirror with it", async ({
    page,
    helix,
  }) => {
    await page.goto("/settings/backups");

    // Nothing chosen yet: only the "Choose a folder" entry point shows.
    await expect(page.getByRole("button", { name: "Choose a folder" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change folder" })).toHaveCount(0);

    const chosen = "/Volumes/Backup Drive";
    await queueDialog(page, chosen);
    await page.getByRole("button", { name: "Choose a folder" }).click();

    await expect(page.getByText("Second copy folder set.")).toBeVisible();
    await expect(page.getByText(chosen)).toBeVisible();

    // Persisted to the settings table, not just to the query cache — a reload
    // (or another screen reading the same setting) would see it too.
    const row = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = 'backupCopyDir'",
      [],
    );
    expect(row).toHaveLength(1);
    expect(JSON.parse(String(row[0][0]))).toBe(chosen);

    // backup_mirror ran once, with exactly the folder the owner picked - this
    // is what "Nothing is uploaded by Helix" on the panel actually rests on:
    // the one write that happens is this one call, to this one path.
    const made = await calls(page);
    const mirrorCalls = made.filter((c) => c.cmd === "backup_mirror");
    expect(mirrorCalls).toHaveLength(1);
    expect((mirrorCalls[0].args as { destDir: string }).destDir).toBe(chosen);

    // "Copy now" calls it again, still with the same folder.
    await page.getByRole("button", { name: "Copy now" }).click();
    await expect(page.getByText("Backups copied.")).toBeVisible();
    const madeAgain = await calls(page);
    expect(madeAgain.filter((c) => c.cmd === "backup_mirror")).toHaveLength(2);

    // Turning it off clears the setting.
    await page.getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByText("Second copy turned off.")).toBeVisible();
    const cleared = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = 'backupCopyDir'",
      [],
    );
    expect(JSON.parse(String(cleared[0][0]))).toBeNull();
    await expect(page.getByRole("button", { name: "Choose a folder" })).toBeVisible();
  });

  test("a folder mirror that fails on some files still reports success, with the failure named separately", async ({
    page,
    helix: _helix,
  }) => {
    await page.goto("/settings/backups");
    await page.evaluate(() => {
      const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
      state.mirrorResult = {
        path: "",
        copied: 2,
        removed: 0,
        failed: ["2026-09-01T06-00-00Z-scheduled.db: permission denied"],
      };
    });

    await queueDialog(page, "/Volumes/Backup Drive");
    await page.getByRole("button", { name: "Choose a folder" }).click();
    // The folder pick itself still reads as success - a partial mirror is not
    // a failed backup (F-OPS-2's whole point).
    await expect(page.getByText("Second copy folder set.")).toBeVisible();
    await expect(
      page.getByText("1 file(s) could not be copied to /Volumes/Backup Drive."),
    ).toBeVisible();
  });
});
