/**
 * Reading a message out of whatever a failure turns out to be.
 *
 * Tauri rejects a command with a plain `{ code, message }` object rather than
 * an `Error`, so the reflexive `err instanceof Error ? err.message :
 * String(err)` shows the owner the literal text "[object Object]" on exactly
 * the failures that matter most — a refused keychain, a disk with no room, a
 * website that would not answer. That trap has been found and fixed one screen
 * at a time (F-LB-6 in the poller, F-OPS-3 in the backup banner, and again in
 * the site connection, the attachment list and Diagnostics during the
 * customer-success pass), and each fix left behind its own private copy of the
 * same six lines.
 *
 * This is that function, once. Five call sites now import it instead of
 * carrying a twin, so the next screen that needs it inherits the fix rather
 * than rediscovering the bug.
 *
 * `fallback` is what the owner reads when the failure carries no message of
 * its own. Pass one whenever the screen can say something more useful than the
 * raw value — "Helix could not open that workspace." beats a stringified
 * object every time. Leaving it out keeps the older behaviour, `String(err)`.
 */
export function messageFrom(err: unknown, fallback?: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  if (typeof err === "string" && err.length > 0) return err;
  return fallback ?? String(err);
}
