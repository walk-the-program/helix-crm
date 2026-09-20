/**
 * Font and logo loading for the invoice/quote PDF renderer.
 *
 * This module is the one seam between "where bytes come from" and the
 * renderer, so the exact same renderDocument() works two ways:
 *  - in the app (Vite/browser/Tauri), loadAssets() fetches the font and
 *    logo files that Vite serves as URLs;
 *  - in a Node vitest run, the test reads the same files off disk with
 *    node:fs and passes the bytes in directly, bypassing loadAssets().
 *
 * Every individual load is wrapped in try/catch and resolves to null on
 * failure. A missing font or logo must never throw -- the renderer falls
 * back to pdf-lib's built-in Helvetica/Helvetica-Bold when a font is null,
 * and simply omits the mark when the logo is null.
 */

// Vite's `?url` suffix resolves each import to the file's served URL rather
// than inlining it, which is what lets us `fetch()` the raw bytes below.
// vite/client's ambient `declare module '*?url'` covers this pattern, so no
// project-specific module declaration is required.
import zillaSlabBoldUrl from "./fonts/ZillaSlab-Bold.ttf?url";
import zillaSlabSemiBoldUrl from "./fonts/ZillaSlab-SemiBold.ttf?url";
import latoRegularUrl from "./fonts/Lato-Regular.ttf?url";
import latoBoldUrl from "./fonts/Lato-Bold.ttf?url";
// The canonical logo lives at assets/brand/helix-logo-square.png, outside
// both src/ and public/. Vite's dev-server file-system allowlist and its
// asset pipeline are both keyed off directories under src/ (or public/) in
// this project's existing usage, and this feature cannot verify a
// cross-root `?url` import without starting a dev server (forbidden for
// this task), so a single copy of the logo is kept alongside this module
// instead. See this feature's PR notes for the source file.
import logoUrl from "./helix-logo-square.png?url";

export type FontBytes = {
  heading: Uint8Array | null;
  headingBold: Uint8Array | null;
  body: Uint8Array | null;
  bodyBold: Uint8Array | null;
};

export type DocumentAssets = {
  fonts: FontBytes;
  logoPng: Uint8Array | null;
};

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Loads fonts and the logo the browser way, via Vite-served URLs. Only used
 * when renderDocument() is not given assets explicitly (i.e. not in tests).
 */
export async function loadAssets(): Promise<DocumentAssets> {
  // Zilla Slab only ships Bold and SemiBold here (docs/DESIGN.md's heading
  // face is always used at weight, never at a light body-text weight), so
  // SemiBold stands in as the "heading" cut and Bold as "headingBold".
  const [heading, headingBold, body, bodyBold, logoPng] = await Promise.all([
    fetchBytes(zillaSlabSemiBoldUrl),
    fetchBytes(zillaSlabBoldUrl),
    fetchBytes(latoRegularUrl),
    fetchBytes(latoBoldUrl),
    fetchBytes(logoUrl),
  ]);

  return {
    fonts: { heading, headingBold, body, bodyBold },
    logoPng,
  };
}
