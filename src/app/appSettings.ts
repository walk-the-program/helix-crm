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

/**
 * The sidebar's width and collapsed state (round 3, criterion 7).
 *
 * APP-LEVEL, not workspace-level, and that is a decision rather than an
 * accident: how wide the nav should be is a fact about this screen and this
 * pair of eyes, not about the business whose file happens to be open. An owner
 * who switches between "My business" and a second workspace does not want the
 * furniture to move.
 *
 * The width is clamped on the way in as well as on the way out, so a
 * hand-edited helix.json cannot produce a 4px sidebar that nothing can grab.
 */
export const sidebarSchema = z.object({
  width: z.number().min(200).max(360).catch(240).default(240),
  collapsed: z.boolean().catch(false).default(false),
});

export type SidebarSettings = z.infer<typeof sidebarSchema>;

export const registrySchema = z.object({
  workspaces: z.array(workspaceEntrySchema).default([]),
  lastOpened: z.string().nullable().default(null),
  theme: themeSchema.default("auto"),
  density: densitySchema.default("comfortable"),
  sidebar: sidebarSchema.catch({ width: 240, collapsed: false }).default({
    width: 240,
    collapsed: false,
  }),
});

export type HelixRegistry = z.infer<typeof registrySchema>;

export const REGISTRY_FILE = "helix.json";

export const EMPTY_REGISTRY: HelixRegistry = {
  workspaces: [],
  lastOpened: null,
  theme: "auto",
  density: "comfortable",
  sidebar: { width: 240, collapsed: false },
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
  publishRegistry(next);
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

/**
 * Every update runs to completion before the next one starts.
 *
 * Without this, two updates that overlap both read the same cached registry,
 * each writes its own whole-file copy, and whichever `writeTextFile` happens
 * to land second wins — so the first change is silently lost. It is not a
 * theoretical race: pressing End then Home on the sidebar's drag handle, or
 * flipping the theme while a resize is still being written, issues two writes
 * inside a frame, and the round-3 e2e caught the file holding the older width.
 *
 * A promise chain is the whole mechanism. `readRegistry` is inside the queued
 * section deliberately: a change function must see what the previous one
 * wrote, not what was there before it.
 */
let registryWrites: Promise<unknown> = Promise.resolve();

export async function updateRegistry(
  change: (current: HelixRegistry) => HelixRegistry,
): Promise<HelixRegistry> {
  const queued = registryWrites.then(async () => {
    const next = change(await readRegistry());
    await writeRegistry(next);
    return next;
  });
  // The queue must keep moving even when this update throws, or one failed
  // write would wedge every setting in the app for the rest of the session.
  registryWrites = queued.catch(() => undefined);
  return queued;
}

/** Forget the cache, so the next read hits disk (used after a restore). */
export function resetRegistryCache(): void {
  cached = null;
  cachedPaths = null;
}

/** Resolve once every queued write has finished. Tests and a quit path use it. */
export async function flushRegistryWrites(): Promise<void> {
  await registryWrites;
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

/**
 * What the theme toggle does next: the opposite of what is on screen.
 *
 * ROUND 3, criterion 6. This used to cycle Auto → Light → Dark → Auto, which
 * was defensible on paper — Auto stays one press away — and wrong in the hand.
 * Walker's Mac is on dark; Helix was on Auto and therefore dark; making the
 * app light took two presses, because Auto's "next" was Light and Dark's was
 * Auto. A control that sometimes needs one press and sometimes two is broken.
 *
 * So it is a toggle. From Light it goes Dark, from Dark it goes Light, and
 * from Auto it goes to the opposite of the RESOLVED appearance — which is the
 * only reading of "toggle" that matches what the eye expects to happen.
 *
 * Auto has not gone anywhere; it moved to the one place a preference belongs,
 * Settings > Appearance, where it is a named choice rather than a stop on a
 * carousel nobody can see.
 *
 * One function, so the toolbar button, the View menu's "Toggle theme" and the
 * palette cannot disagree.
 */
export function nextTheme(current: Theme): Theme {
  return resolveTheme(current) === "dark" ? "light" : "dark";
}

/** The shell sets both attributes on <html> from these values. */
export function applyAppearance(theme: Theme, density: Density): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(theme));
  root.setAttribute("data-density", density);
}

/* -------------------------------------------------------------------------- */
/* platform                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `data-platform="macos"` on <html>, so CSS can pay for the integrated title
 * bar without any component knowing which machine it is on.
 *
 * The macOS window runs `titleBarStyle: "Overlay"` with the title hidden, so
 * the web view starts at the very top of the window and the traffic lights
 * float over our own first 38 pixels. The sidebar pads itself out of their way
 * (globals.css), and the top bar and the sidebar header carry
 * `data-tauri-drag-region` so the window still moves and still zooms on a
 * double-click. Windows keeps its native bar and needs none of it.
 *
 * The e2e harness runs Chromium on a Mac with a Macintosh user agent and no
 * Tauri under it, so it would pick up the padding and shift every screenshot
 * by 38px against a title bar that is not there. The VITE_E2E guard keeps the
 * harness on the plain layout; it is only ever set in the e2e build.
 *
 * That guard had a cost the HIG review named: every shipped screenshot was an
 * accurate record of the *web* layout and of nothing a Mac owner ever sees, so
 * the one place the traffic lights could land on the lockup was the one place
 * the suite could not photograph (design/apple-hig-review.md, the note above
 * finding 1). `window.__helixPlatform = "macos"`, set before the app boots, is
 * the way back in: one spec opts into the macOS layout deliberately and every
 * other spec keeps the plain one. It is read only under VITE_E2E, so nothing a
 * page could set can change the layout of the shipped app.
 */
declare global {
  interface Window {
    /** e2e only: forces the platform layout. See `isMacOS`. */
    __helixPlatform?: "macos" | "other";
  }
}

export function isMacOS(): boolean {
  if (import.meta.env.VITE_E2E) {
    return typeof window !== "undefined" && window.__helixPlatform === "macos";
  }
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes("Macintosh");
}

/** Called once during boot, before the shell mounts. */
export function applyPlatform(): void {
  if (typeof document === "undefined") return;
  if (!isMacOS()) return;
  document.documentElement.setAttribute("data-platform", "macos");
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

/* -------------------------------------------------------------------------- */
/* the sidebar                                                                */
/* -------------------------------------------------------------------------- */

/** Write one or both sidebar values. Called on drag-end, not on every frame. */
export async function setSidebar(
  patch: Partial<SidebarSettings>,
): Promise<HelixRegistry> {
  return updateRegistry((current) => ({
    ...current,
    sidebar: sidebarSchema.parse({ ...current.sidebar, ...patch }),
  }));
}

/* -------------------------------------------------------------------------- */
/* live registry updates                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Anything that wants to know when helix.json changes (round 3, criterion 8).
 *
 * The sidebar footer used to print the workspace name from the boot result — a
 * value captured once, at launch, and never looked at again. Renaming the
 * workspace in Settings wrote the file, redrew the settings screen, and left
 * the footer saying the old name until the next relaunch. Walker found that in
 * about a minute.
 *
 * Rather than thread a setter from App.tsx down through the shell, every write
 * that goes through `writeRegistry` publishes the new registry here and anyone
 * can subscribe. It is a two-line event bus on purpose: TanStack Query owns
 * the workspace database, and helix.json is not that — it is one small file
 * this module already serialises every access to.
 */
type RegistryListener = (registry: HelixRegistry) => void;

const registryListeners = new Set<RegistryListener>();

export function subscribeToRegistry(listener: RegistryListener): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

function publishRegistry(next: HelixRegistry): void {
  for (const listener of [...registryListeners]) {
    try {
      listener(next);
    } catch (err) {
      // A listener that throws must never break the write that told it.
      console.error("[helix] a registry listener failed", err);
    }
  }
}
