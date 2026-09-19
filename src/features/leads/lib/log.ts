/**
 * Logging for the lead poller (docs/PLAN.md, "Observability": every service
 * logs start, end, counts and named errors).
 *
 * `@tauri-apps/plugin-log` is imported lazily and every call is swallowed on
 * failure: in a plain browser - the e2e build, a unit test - there is no log
 * plugin, and a missing logger must never be the reason a poll dies.
 */

type Level = "info" | "warn" | "error";

async function write(level: Level, message: string): Promise<void> {
  try {
    const log = await import("@tauri-apps/plugin-log");
    await log[level](message);
  } catch {
    // No Tauri runtime, or the plugin is not registered. The console line
    // below is all a browser-only run gets, and that is enough.
    if (level === "error") console.error(message);
  }
}

export const pollLog = {
  info(message: string): void {
    void write("info", `[leads] ${message}`);
  },
  warn(message: string): void {
    void write("warn", `[leads] ${message}`);
  },
  error(message: string): void {
    void write("error", `[leads] ${message}`);
  },
};
