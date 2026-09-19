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

function underE2eHarness(): boolean {
  return (
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
