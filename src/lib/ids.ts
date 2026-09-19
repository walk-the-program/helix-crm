/**
 * Identifiers.
 *
 * Every row id is a UUID v7 string: time-ordered, so inserts stay local in the
 * b-tree and a future sync layer can order rows without a clock. Never
 * crypto.randomUUID() (v4 only) - see docs/PLAN.md "Temporal interrogation".
 */
import { v7 as uuidv7 } from "uuid";

/** A new time-ordered row id. */
export function newId(): string {
  return uuidv7();
}

/** A new batch id, used to group change_log entries for undo and merge reversal. */
export function newBatchId(): string {
  return uuidv7();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when the string looks like a UUID this app could have produced. */
export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
