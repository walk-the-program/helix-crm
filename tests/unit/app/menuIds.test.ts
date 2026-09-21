/**
 * Every id in the native menu still means something.
 *
 * `src-tauri/src/menu.rs` is Rust and `src/app/registry.ts` is TypeScript, so
 * nothing else in the build can notice when a command is renamed or a route
 * moves and a menu item quietly becomes a no-op. The web view logs the miss at
 * runtime (`src/app/menu.ts`), which is better than silence but only helps
 * someone who has the console open.
 *
 * This reads the two sides as text rather than importing them. Importing
 * `@/app/registry` would pull in every feature area — that is exactly why
 * tests/unit/app/shellFooter.test.ts mocks it — and this test has to hold while
 * several agents are editing those features at once. A regex over the source is
 * blunt, but it catches the failure that actually happens: a command id that no
 * longer exists anywhere.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const menuRs = readFileSync(join(repoRoot, "src-tauri", "src", "menu.rs"), "utf8");

/** Ids `src-tauri/src/menu.rs` handles itself and never sends to the web view. */
const HANDLED_IN_RUST = new Set(["report-a-problem"]);

/** Every `item(app, "<id>", …)` call in the Rust menu. */
function menuIds(): string[] {
  return [...menuRs.matchAll(/item\(app,\s*"([^"]+)"/g)].map((match) => match[1]);
}

/** Every `("nav:/…", "Label", "Accel")` row in the View menu's table. */
function navIds(): string[] {
  return [...menuRs.matchAll(/\("(nav:[^"]+)"/g)].map((match) => match[1]);
}

function featureSources(): string {
  const dir = join(repoRoot, "src", "features");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readFileSync(join(dir, entry.name, "index.tsx"), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

describe("the native menu's ids", () => {
  const features = featureSources();
  // The shell's own commands live beside the registry, one module each.
  const appCommands = ["undo.ts", "sidebarCommand.ts", "refresh.ts"]
    .map((file) => readFileSync(join(repoRoot, "src", "app", file), "utf8"))
    .join("\n");
  const everywhere = `${features}\n${appCommands}`;

  it("finds at least the menu we think we built", () => {
    // A guard on the regexes themselves: if they silently stop matching, every
    // assertion below would pass on an empty list.
    expect(menuIds().length).toBeGreaterThanOrEqual(8);
    expect(navIds()).toHaveLength(8);
  });

  it("names a real command for every item the web view has to answer", () => {
    for (const id of menuIds()) {
      if (HANDLED_IN_RUST.has(id)) continue;
      if (id.startsWith("nav:")) continue;
      expect(everywhere, `the menu item "${id}" has no command`).toContain(`id: "${id}"`);
    }
  });

  it("names a real route for every View item", () => {
    for (const id of navIds()) {
      const path = id.slice("nav:".length);
      // Today is the root, which no feature spells as a `to:` string the way
      // the others do; the rest are sidebar destinations.
      if (path === "/") continue;
      expect(features, `the View menu points at "${path}", which nothing routes`).toContain(
        `"${path}"`,
      );
    }
  });

  it("keeps Undo and Redo as Helix's own items rather than the predefined ones", () => {
    // If someone "simplifies" these to `.undo()` and `.redo()`, Cmd+Z silently
    // stops reversing a pipeline move and only a text field keeps it.
    expect(menuIds()).toContain("undo");
    expect(menuIds()).toContain("redo");
    expect(menuRs).not.toMatch(/\.undo\(\)/);
    expect(menuRs).not.toMatch(/\.redo\(\)/);
  });

  it("keeps Cut, Copy, Paste and Select All as the system's", () => {
    // The opposite rule: these have to stay predefined or a text field loses
    // the behaviour macOS gives it for free.
    for (const predefined of [".cut()", ".copy()", ".paste()", ".select_all()"]) {
      expect(menuRs).toContain(predefined);
    }
  });
});
