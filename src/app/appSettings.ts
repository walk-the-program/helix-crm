/**
 * App-level settings: <appData>/helix.json.
 *
 * Workspace-level settings live in the workspace's own SQLite file. This file
 * holds what must be readable while no database is open: the workspace list
 * (with each one's last poll and last backup, mirrored here because a closed
 * workspace cannot be queried), which one was open last, the theme and the
 * density.
 */
import { z } from "zod";
import { newId } from "@/lib/ids";

export const workspaceEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  lastPolledAt: z.string().nullable().default(null),
  lastBackupAt: z.string().nullable().default(null),
  archived: z.boolean().default(false),
});

export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;

export const themeSchema = z.enum(["light", "dark", "auto"]);
export const densitySchema = z.enum(["comfortable", "compact"]);

export type Theme = z.infer<typeof themeSchema>;
export type Density = z.infer<typeof densitySchema>;

export const registrySchema = z.object({
  workspaces: z.array(workspaceEntrySchema).default([]),
  lastOpened: z.string().nullable().default(null),
  theme: themeSchema.default("auto"),
  density: densitySchema.default("comfortable"),
});

export type HelixRegistry = z.infer<typeof registrySchema>;

export const REGISTRY_FILE = "helix.json";

export const EMPTY_REGISTRY: HelixRegistry = {
  workspaces: [],
  lastOpened: null,
  theme: "auto",
  density: "comfortable",
};

/** True when the app is running inside Tauri rather than a plain browser. */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/* -------------------------------------------------------------------------- */
/* reading and writing helix.json                                             */
/* -------------------------------------------------------------------------- */

type Paths = { appData: string; workspacesDir: string };

let cached: HelixRegistry | null = null;
let cachedPaths: Paths | null = null;

/** In a plain browser (the e2e build) helix.json is kept in memory. */
const memoryStore: { json: string | null } = { json: null };

export async function appPaths(): Promise<Paths> {
  if (cachedPaths) return cachedPaths;
  if (!isTauri()) {
    cachedPaths = { appData: "/helix", workspacesDir: "/helix/workspaces" };
    return cachedPaths;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  cachedPaths = await invoke<Paths>("app_paths");
  return cachedPaths;
}

function parseRegistry(text: string | null): HelixRegistry {
  if (!text) return { ...EMPTY_REGISTRY };
  try {
    const parsed = registrySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : { ...EMPTY_REGISTRY };
  } catch {
    return { ...EMPTY_REGISTRY };
  }
}

export async function readRegistry(): Promise<HelixRegistry> {
  if (cached) return cached;
  if (!isTauri()) {
    cached = parseRegistry(memoryStore.json);
    return cached;
  }
  const fs = await import("@tauri-apps/plugin-fs");
  const paths = await appPaths();
  const file = `${paths.appData}/${REGISTRY_FILE}`;
  try {
    const exists = await fs.exists(file);
    if (!exists) {
      cached = { ...EMPTY_REGISTRY };
      return cached;
    }
    cached = parseRegistry(await fs.readTextFile(file));
  } catch {
    cached = { ...EMPTY_REGISTRY };
  }
  return cached;
}

export async function writeRegistry(next: HelixRegistry): Promise<void> {
  cached = next;
  const text = JSON.stringify(next, null, 2);
  if (!isTauri()) {
    memoryStore.json = text;
    return;
  }
  const fs = await import("@tauri-apps/plugin-fs");
  const paths = await appPaths();
  try {
    if (!(await fs.exists(paths.appData))) {
      await fs.mkdir(paths.appData, { recursive: true });
    }
  } catch {
    // mkdir races are fine: the write below reports the real problem.
  }
  await fs.writeTextFile(`${paths.appData}/${REGISTRY_FILE}`, text);
}

export async function updateRegistry(
  change: (current: HelixRegistry) => HelixRegistry,
): Promise<HelixRegistry> {
  const next = change(await readRegistry());
  await writeRegistry(next);
  return next;
}

/** Forget the cache, so the next read hits disk (used after a restore). */
export function resetRegistryCache(): void {
  cached = null;
  cachedPaths = null;
}

/* -------------------------------------------------------------------------- */
/* workspaces                                                                 */
/* -------------------------------------------------------------------------- */

export function workspaceDbPath(workspacesDir: string, id: string): string {
  return `${workspacesDir}/${id}/helix.db`;
}

/**
 * The workspace to open: the last one opened, or the first that is not
 * archived. Creates the first workspace when the registry is empty.
 */
export async function ensureFirstWorkspace(
  name = "My business",
): Promise<{ registry: HelixRegistry; workspace: WorkspaceEntry }> {
  const paths = await appPaths();
  const registry = await readRegistry();
  const live = registry.workspaces.filter((w) => !w.archived);

  if (live.length > 0) {
    const chosen =
      live.find((w) => w.id === registry.lastOpened) ?? live[0];
    return { registry, workspace: chosen };
  }

  const id = newId();
  const workspace: WorkspaceEntry = {
    id,
    name,
    path: workspaceDbPath(paths.workspacesDir, id),
    lastPolledAt: null,
    lastBackupAt: null,
    archived: false,
  };
  const next = await updateRegistry((current) => ({
    ...current,
    workspaces: [...current.workspaces, workspace],
    lastOpened: id,
  }));
  return { registry: next, workspace };
}

export async function setLastOpened(workspaceId: string): Promise<void> {
  await updateRegistry((current) => ({ ...current, lastOpened: workspaceId }));
}

export async function touchWorkspace(
  workspaceId: string,
  patch: { lastPolledAt?: string; lastBackupAt?: string },
): Promise<void> {
  await updateRegistry((current) => ({
    ...current,
    workspaces: current.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, ...patch } : w,
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* theme and density                                                          */
/* -------------------------------------------------------------------------- */

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "auto") return prefersDark() ? "dark" : "light";
  return theme;
}

/** The shell sets both attributes on <html> from these values. */
export function applyAppearance(theme: Theme, density: Density): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(theme));
  root.setAttribute("data-density", density);
}

export async function setTheme(theme: Theme): Promise<HelixRegistry> {
  const next = await updateRegistry((current) => ({ ...current, theme }));
  applyAppearance(next.theme, next.density);
  return next;
}

export async function setDensity(density: Density): Promise<HelixRegistry> {
  const next = await updateRegistry((current) => ({ ...current, density }));
  applyAppearance(next.theme, next.density);
  return next;
}
