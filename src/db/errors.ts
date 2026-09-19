/**
 * Named errors from docs/PLAN.md's "Error and rescue map".
 *
 * Repositories throw these; screens match on the class, never on a message
 * string. The database-level errors (DbError, DbClosedError, DbOpenError,
 * Fts5MissingError) live in client.ts next to the driver that raises them and
 * are re-exported here so callers have one import.
 */
export {
  DbError,
  DbClosedError,
  DbOpenError,
  Fts5MissingError,
} from "@/db/client";

export class NotFoundError extends Error {
  readonly entityType: string;
  readonly entityId: string;
  constructor(entityType: string, entityId: string) {
    super(`No ${entityType} with id ${entityId}.`);
    this.name = "NotFoundError";
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

export class ValidationError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(message: string, issues: { path: string; message: string }[]) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** Deleting a stage that still holds deals: the UI must pick a target first. */
export class StageInUseError extends Error {
  readonly stageId: string;
  readonly dealCount: number;
  constructor(stageId: string, dealCount: number) {
    super(
      `That stage still holds ${dealCount} deal(s). Choose a stage to move them to first.`,
    );
    this.name = "StageInUseError";
    this.stageId = stageId;
    this.dealCount = dealCount;
  }
}

/** A merge reversal that is no longer safe (the survivor was merged again). */
export class MergeReversalRefusedError extends Error {
  readonly mergeId: string;
  readonly reason: string;
  constructor(mergeId: string, reason: string) {
    super(reason);
    this.name = "MergeReversalRefusedError";
    this.mergeId = mergeId;
    this.reason = reason;
  }
}

/** Any other SQLite failure on a write. */
export class WriteError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "WriteError";
    this.cause = cause;
  }
}

/**
 * Not an error: creating a contact whose email or phone already exists shows
 * an inline "already exists, open it?" warning with a Create anyway button.
 */
export type DuplicateWarning = {
  matchedOn: "email" | "phone";
  value: string;
  entityType: "contact" | "company";
  entityId: string;
  label: string;
};
