/**
 * The boot sequence (docs/PLAN.md "Launch order").
 *
 *   app_paths  ->  read <appData>/helix.json
 *        |               |
 *        |               +-- no workspace yet? create the first one
 *        v
 *   raw.open(<workspace>/helix.db)
 *        |
 *        +-- db_info().fts5 false -> Fts5MissingError (full-screen)
 *        +-- migrate()            -> MigrationError   (full-screen)
 *        +-- seedWorkspace()
 *        +-- clear the TanStack Query cache
 *        v
 *   paint Today, then in the background: backup, duplicate scan, lead poll
 *
 * Migration blocks the first paint; nothing else does. Every db_open - launch,
 * restore, workspace switch - runs this same sequence again.
 */
import { Fts5MissingError, DbOpenError, raw, setDriver } from "@/db/client";
import { e2eDriver, hasE2eBridge } from "@/db/drivers/e2e";
import { migrate, type MigrateResult } from "@/db/migrator";
import { seedWorkspace } from "@/db/repos/seed";
import { resetQueryCache } from "@/app/queryClient";
import {
  applyAppearance,
  ensureFirstWorkspace,
  readRegistry,
  setLastOpened,
  type HelixRegistry,
  type WorkspaceEntry,
} from "@/app/appSettings";
import { registry as featureRegistry } from "@/app/registry";

export type BootResult = {
  registry: HelixRegistry;
  workspace: WorkspaceEntry;
  dbPath: string;
  migration: MigrateResult;
  sqliteVersion: string;
  sizeBytes: number;
};

/**
 * In the e2e build the Playwright harness binds window.__helixDb before the
 * app boots, so the same code runs in a plain browser.
 */
function installDriver(): void {
  if (hasE2eBridge()) setDriver(e2eDriver);
}

/** Open a workspace file and bring it up to date. Used by boot and by switch. */
export async function openWorkspace(
  workspace: WorkspaceEntry,
): Promise<Omit<BootResult, "registry" | "workspace">> {
  try {
    await raw.open(workspace.path);
  } catch (err) {
    if (err instanceof DbOpenError) throw err;
    throw new DbOpenError(
      err instanceof Error ? err.message : `Could not open ${workspace.path}.`,
    );
  }

  const info = await raw.info();
  if (!info.fts5) throw new Fts5MissingError();

  const migration = await migrate();
  await seedWorkspace();

  // The rows behind the cache belong to a different file from here on.
  resetQueryCache();

  return {
    dbPath: info.path,
    migration,
    sqliteVersion: info.sqliteVersion,
    sizeBytes: info.sizeBytes,
  };
}

/** Run the whole sequence. Throws DbOpenError, Fts5MissingError or MigrationError. */
export async function boot(): Promise<BootResult> {
  installDriver();

  const registryBefore = await readRegistry();
  applyAppearance(registryBefore.theme, registryBefore.density);

  const { registry, workspace } = await ensureFirstWorkspace();
  const opened = await openWorkspace(workspace);
  if (registry.lastOpened !== workspace.id) {
    await setLastOpened(workspace.id);
  }

  return { registry, workspace, ...opened };
}

/**
 * Feature onBoot hooks, started after the first paint. Each one is
 * idempotent and its failure never takes the app down: a broken lead poller
 * must not stop the owner reading his contacts.
 */
export async function runFeatureBoot(): Promise<void> {
  for (const feature of featureRegistry) {
    if (!feature.onBoot) continue;
    try {
      await feature.onBoot();
    } catch (err) {
      console.error(`[helix] feature "${feature.id}" failed to start`, err);
    }
  }
}

/** Switch to another workspace: close, open, migrate, seed, clear the cache. */
export async function switchWorkspace(
  workspace: WorkspaceEntry,
): Promise<Omit<BootResult, "registry" | "workspace">> {
  await raw.close();
  const opened = await openWorkspace(workspace);
  await setLastOpened(workspace.id);
  return opened;
}
