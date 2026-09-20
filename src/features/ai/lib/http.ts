/**
 * Which fetch the provider uses.
 *
 * In the app: `fetch` from @tauri-apps/plugin-http, which performs the request
 * in Rust. That is what lets the CSP stay `connect-src 'self'` and what gets
 * around the browser CORS block on api.anthropic.com (PLAN.md, E1). The
 * capability file scopes the plugin to https://api.anthropic.com/* only.
 *
 * Under the e2e harness there is no Rust side at all - `plugin:http|fetch` has
 * no stub in tests/e2e-mac/fixtures.ts - so the browser's own fetch stands in,
 * exactly as src/app/boot.ts swaps the database driver for the e2e bridge. The
 * suite points `aiBaseUrl` at a local fake, which answers with CORS headers.
 *
 * Tests inject their own function instead: every provider entry point takes one.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * `import.meta.env.VITE_E2E` is only defined in the e2e build (Vite replaces
 * it at build time), so in a shipped build this whole branch is dead code and
 * no global can reach it - the same guarantee `src/app/appSettings.ts` and
 * `src/features/onboarding/gate.ts` give their own harness gates. Before this
 * fix, this was the one gate in the product that checked only the runtime
 * flag: a shipped Helix would still evaluate `window.__HELIX_E2E__ === true`
 * and, if it were ever true, hand back the browser's own `fetch` instead of
 * `@tauri-apps/plugin-http`'s - bypassing the capability file's scoping of
 * that plugin to `https://api.anthropic.com/*`. Not currently reachable
 * (nothing in the app sets that global, and the CSP's `connect-src 'self'`
 * would block the browser fetch outright even if it were), but it should not
 * have been the only such gate in the codebase that a release build still
 * carries.
 */
function underE2eHarness(): boolean {
  // `import.meta.env.VITE_E2E` is a Vite-injected env string ("1" in the e2e
  // build's own command, see tests/e2e-mac/playwright.config.ts), not a
  // boolean - a truthy check, matching src/features/onboarding/gate.ts's
  // `!import.meta.env.VITE_E2E`, not `=== true`.
  return (
    Boolean(import.meta.env.VITE_E2E) &&
    typeof window !== "undefined" &&
    (window as unknown as { __HELIX_E2E__?: boolean }).__HELIX_E2E__ === true
  );
}

/** The default transport, resolved once per call so tests can swap the window flag. */
export async function resolveFetch(): Promise<FetchLike> {
  if (underE2eHarness() || typeof window === "undefined") {
    return globalThis.fetch.bind(globalThis) as unknown as FetchLike;
  }
  try {
    const mod = await import("@tauri-apps/plugin-http");
    return mod.fetch as unknown as FetchLike;
  } catch {
    // A plain browser (vite dev with no Tauri): the request will fail on CORS,
    // which is the honest answer rather than a silent stub.
    return globalThis.fetch.bind(globalThis) as unknown as FetchLike;
  }
}
