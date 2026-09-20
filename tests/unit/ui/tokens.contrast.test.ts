import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Guards the one contrast fact apple-hig-review.md finding 13 is about:
 * dark-mode hover used to measure 1.07:1 against the surface it sits on - a
 * six-value jump per channel that is not perceptible on a laptop in
 * daylight. This reads the real values out of tokens.css (never duplicates
 * them into a fixture that could drift) and recomputes WCAG 2.1 relative
 * luminance the same way design/contrast-audit.js does, so a future edit to
 * the dark theme's hover, selected or ink tokens fails here instead of
 * shipping invisible again.
 */

const thisFile = fileURLToPath(import.meta.url);
const tokensPath = join(thisFile, "..", "..", "..", "..", "src", "styles", "tokens.css");
const tokensSrc = readFileSync(tokensPath, "utf8");

// Isolate the [data-theme="dark"] block so a light-theme variable of the same
// name (--color-hover, --color-selected, ...) can never be picked up by
// accident.
function darkBlock(src: string): string {
  const start = src.indexOf('[data-theme="dark"] {');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("COMPACT DENSITY", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

function readVar(block: string, name: string): string {
  const re = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`);
  const match = block.match(re);
  expect(match, `--${name} not found in the dark theme block`).not.toBeNull();
  return match![1].toUpperCase();
}

// The same sRGB relative-luminance / WCAG contrast-ratio formula as
// design/contrast-audit.js and the ratios stated in tokens.css's own
// comments.
function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(hexToRgb(a));
  const l2 = relativeLuminance(hexToRgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("dark theme hover/selected contrast (tokens.css)", () => {
  const block = darkBlock(tokensSrc);
  const surface = readVar(block, "color-surface");
  const hover = readVar(block, "color-hover");
  const selected = readVar(block, "color-selected");
  const textFaint = readVar(block, "color-text-faint");

  it("hover clears 1.4:1 against the surface it sits on", () => {
    // Finding 13: #242424 on #1E1E1E measured 1.07:1, which is what this
    // guards against regressing to.
    expect(contrastRatio(hover, surface)).toBeGreaterThanOrEqual(1.4);
  });

  it("selected also clears 1.4:1 against the surface, and stays distinguishable from hover", () => {
    expect(contrastRatio(selected, surface)).toBeGreaterThanOrEqual(1.4);
    // Hover and selected must not converge to the same fill: a persistently
    // selected row still has to read as a different state from a row the
    // pointer merely happens to be over.
    expect(selected).not.toBe(hover);
    expect(contrastRatio(hover, selected)).toBeGreaterThan(1.0);
  });

  it("selected does not get so bright it breaks AA for the tertiary ink drawn on top of it", () => {
    // --color-text-faint on --color-selected is documented in tokens.css as
    // the worst text/background pair the dark theme produces. It is the
    // ceiling that limited how far --color-selected could move to stay clear
    // of the new --color-hover, so this is the regression that trade-off
    // could silently reintroduce.
    expect(contrastRatio(textFaint, selected)).toBeGreaterThanOrEqual(4.5);
  });
});
