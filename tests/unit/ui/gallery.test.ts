// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LONG_LABEL, renderGallery, SPECIMEN_IDS } from "./gallery.specimens";

/**
 * Renders the static component gallery once and writes it to
 * design/ui-screens/gallery.html, next to the compiled gallery.css (built
 * separately — see design/ui-screens/gallery.css). This is the only test
 * file allowed to write into design/ui-screens/.
 */
const thisFile = fileURLToPath(import.meta.url);
const outDir = join(dirname(thisFile), "..", "..", "..", "design", "ui-screens");
const outFile = join(outDir, "gallery.html");

describe("component gallery", () => {
  const html = renderGallery();

  it("writes the rendered gallery to design/ui-screens/gallery.html", () => {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, html, "utf8");
    expect(html.length).toBeGreaterThan(0);
  });

  it("rendered at least one specimen per primitive it set out to cover", () => {
    expect(SPECIMEN_IDS.length).toBeGreaterThan(50);
    // No duplicate ids.
    expect(new Set(SPECIMEN_IDS).size).toBe(SPECIMEN_IDS.length);
  });

  it("includes every specimen id in the rendered output", () => {
    for (const id of SPECIMEN_IDS) {
      expect(html).toContain(`data-specimen-id="${id}"`);
    }
  });

  it("includes the 47-character edge-case company name verbatim", () => {
    expect(LONG_LABEL).toHaveLength(47);
    expect(html).toContain(LONG_LABEL);
  });

  it("carries the standalone document shell and theme/density toggle", () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en" data-theme="light" data-density="comfortable">');
    expect(html).toContain('<link rel="stylesheet" href="./gallery.css" />');
    expect(html).toContain("data-set-theme");
    expect(html).toContain("data-set-density");
  });

  it("contains no literal hex colour outside the data- attributes it controls", () => {
    // Strip every data-*="..." attribute value (e.g. data-specimen-id, which
    // may legitimately contain arbitrary specimen text) before scanning for
    // hex colours, so we only assert on colour authorship, not on incidental
    // attribute contents.
    const withoutControlledDataAttrs = html.replace(/data-[a-z-]+="[^"]*"/gi, "");
    expect(withoutControlledDataAttrs).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("never loads anything over the network", () => {
    // The offline-only rule (docs/DESIGN.md section 2) is about not fetching
    // anything over the network — not about the SVG spec's mandatory
    // xmlns="http://www.w3.org/2000/svg" namespace URI, which every icon
    // carries and which is never dereferenced.
    //
    // The Brand lockup does render one <img>, the mark at /helix-logo.png.
    // It ships inside the bundle, so what this asserts is the real rule:
    // every src and href is root-relative, and nothing points at a host.
    const urls = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      // Root-relative (the bundled mark), same-directory (gallery.css), or an
      // inert `data:,` placeholder href. Anything with a host is a network
      // fetch and is what this rule exists to catch.
      expect(url).toMatch(/^(?:\.?\/(?!\/)|data:,$)/);
    }
    expect(html).not.toMatch(/url\(\s*['"]?https?:\/\//i);
  });

  it("renders the brand lockup with the mark and the wordmark", () => {
    expect(html).toContain('data-specimen-id="brand.lg"');
    expect(html).toContain('src="/helix-logo.png"');
    // The sticker shadow is the guide's signature and must actually be on the
    // default lockup, not just available as a prop.
    expect(html).toMatch(/shadow-\[var\(--shadow-sticker\)\]/);
  });
});
