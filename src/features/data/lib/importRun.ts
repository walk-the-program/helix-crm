/**
 * The CSV import itself.
 *
 *   text + mapping
 *        |
 *        v  walkCsv (one row in memory at a time)
 *   MappedRow[]  -- only the mapped fields are kept, so 100k rows fit
 *        |
 *        v  pauseTimers() + withTransaction()
 *   prefetch existing emails / phones / companies / sources / tags
 *        |
 *        v  per row: decide (skip | update | create) then build statements
 *   every 500 rows: coalesce into multi-row inserts -> raw.batch
 *        |
 *        v  commit -> counts + the rows that were not imported
 *
 * One transaction for the whole file (docs/PLAN.md item 9): a failure part way
 * through leaves nothing behind, which is what ImportWriteError promises.
 */
import { raw } from "@/db/client";
import { pauseTimers, withTransaction } from "@/db/writeLock";
import { backupBeforeImport } from "@/features/data/lib/backupsFs";
import { changeLogStatement } from "@/db/changeLog";
import { newBatchId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import type { Delimiter } from "@/lib/csv";
import {
  addressJsonFor,
  applyMapping,
  dedupeKeyFor,
  type ColumnMapping,
  type MappedRow,
} from "@/features/data/lib/mapping";
import { planBatch, type Statement } from "@/db/repos/_base";
import {
  contactEmailStatement,
  contactPhoneStatement,
  contactUpdateStatement,
  importContactStatements,
} from "@/db/repos/contacts";
import { companyCreateStatement } from "@/db/repos/companies";
import { sourceCreateStatement } from "@/db/repos/sources";
import { tagCreateStatement, tagLinkStatement } from "@/db/repos/tags";
import {
  customFieldCreateStatement,
  customValueStatement,
} from "@/db/repos/customFields";

export type DedupePolicy = "skip" | "update" | "duplicate";

export const DEDUPE_POLICIES: { value: DedupePolicy; label: string; hint: string }[] = [
  {
    value: "skip",
    label: "Skip them",
    hint: "Leave what is already in Helix exactly as it is.",
  },
  {
    value: "update",
    label: "Fill in the blanks",
    hint: "Add missing emails, phones and details. Nothing already filled in is overwritten.",
  },
  {
    value: "duplicate",
    label: "Import anyway",
    hint: "Create a second record. You can merge them later on the Duplicates screen.",
  },
];

/** Rows are written in batches of this size (docs/PLAN.md item 9). */
export const BATCH_ROWS = 500;

/** How many skipped rows are kept for the "save skipped rows" CSV. */
export const MAX_SKIPPED_KEPT = 5_000;

/**
 * The read phase (`readMappedRows` below, and `readDraftRows` in
 * `typedImportRun.ts`) keeps every mapped row in memory before the write
 * transaction even opens - only the module doc's "100k rows fit" comment
 * enforced that, nothing in code did. A CSV with, say, a million rows (an
 * honest export from another CRM, or a hostile one) would build a
 * million-entry array with no ceiling and no warning, which is the kind of
 * file size that turns "the import screen is slow" into "the app ran out of
 * memory." LR-SEC packet item 4: this is the enforcement point, so this is
 * where the limit lives. 250,000 is comfortably above the stated working set
 * and comfortably below where a modest machine starts to hurt.
 */
export const MAX_IMPORT_ROWS = 250_000;

export class ImportWriteError extends Error {
  readonly cause: unknown;
  readonly rowNumber: number | null;
  constructor(message: string, cause: unknown, rowNumber: number | null = null) {
    super(message);
    this.name = "ImportWriteError";
    this.cause = cause;
    this.rowNumber = rowNumber;
  }
}

/** Thrown by the read phase when a file has more data rows than Helix will hold in memory at once. */
export class ImportRowLimitError extends Error {
  readonly rowLimit: number;
  constructor(rowLimit: number) {
    super(
      `This file has more than ${rowLimit.toLocaleString()} rows. Split it into smaller files and import them one at a time.`,
    );
    this.name = "ImportRowLimitError";
    this.rowLimit = rowLimit;
  }
}

export type SkippedRow = {
  rowNumber: number;
  reason: string;
  cells: string[];
};

/**
 * A row that imported - it is not in `skippedRows` - but that Helix had to
 * make a judgement call on: an email that does not look like one, a phone it
 * could not dial, a row with no name at all. `applyMapping` (mapping.ts)
 * raises these as warning-level `RowFlag`s; this is where they are kept
 * rather than dropped, so the result screen can say what happened to the row
 * instead of going quiet the moment it stops being an error.
 */
export type ImportWarning = {
  rowNumber: number;
  /** Groups the list on the result screen: "email", "phone", "name". */
  kind: string;
  message: string;
  column?: string;
};

/** How many warnings are kept for the "save warnings" CSV, same ceiling as skipped rows. */
export const MAX_WARNINGS_KEPT = 5_000;

export type ImportCounts = {
  created: number;
  updated: number;
  skipped: number;
  companiesCreated: number;
  tagsCreated: number;
  customFieldsCreated: number;
};

export type ImportResult = ImportCounts & {
  totalRows: number;
  batchId: string;
  durationMs: number;
  headers: string[];
  skippedRows: SkippedRow[];
  skippedTruncated: boolean;
  warnings: ImportWarning[];
  warningsTruncated: boolean;
  /**
   * The backup taken immediately before this import, which is what undoing it
   * means (see `backupBeforeImport`). Null on a dry run, and null when the
   * caller asked for no backup - only the tests do.
   */
  preImportBackupPath: string | null;
};

export type ImportProgress = {
  phase: "reading" | "writing" | "done";
  processed: number;
  total: number;
};

export type ImportOptions = {
  text: string;
  mapping: ColumnMapping[];
  delimiter?: Delimiter;
  policy: DedupePolicy;
  region?: string;
  onProgress?: (progress: ImportProgress) => void;
  /** Lets a test or a preview stop before the write phase. */
  dryRun?: boolean;
  /**
   * Off in the repo tests, which run against a better-sqlite3 file with no
   * Rust pipe behind `raw.backup`. The product never passes it.
   */
  backup?: boolean;
};

/* -------------------------------------------------------------------------- */
/* reading                                                                    */
/* -------------------------------------------------------------------------- */

export type ReadResult = {
  headers: string[];
  rows: MappedRow[];
  /** The original cells, kept only for rows that end up skipped. */
  cellsByRow: Map<number, string[]>;
};

/**
 * Read the file into mapped rows. Raw cells are dropped as soon as a row is
 * mapped, except for rows that already look unimportable - those are the ones
 * the result screen offers to save back out as a CSV.
 *
 * papaparse (behind @/lib/csv's walkCsv) is loaded here, at the point of use,
 * rather than at the top of the module: the import resolves once, before the
 * parse starts, so the row-by-row `step` streaming below it is unaffected.
 */
export async function readMappedRows(
  text: string,
  mapping: ColumnMapping[],
  options: { delimiter?: Delimiter; region?: string; onProgress?: (n: number) => void } = {},
): Promise<ReadResult> {
  const { walkCsv } = await import("@/lib/csv");
  const rows: MappedRow[] = [];
  const cellsByRow = new Map<number, string[]>();
  let seen = 0;

  const { headers } = walkCsv(
    text,
    { delimiter: options.delimiter },
    (cells, rowNumber) => {
      if (seen >= MAX_IMPORT_ROWS) throw new ImportRowLimitError(MAX_IMPORT_ROWS);
      const mapped = applyMapping(cells, mapping, rowNumber, { region: options.region });
      rows.push(mapped);
      if (!mapped.importable && cellsByRow.size < MAX_SKIPPED_KEPT) {
        cellsByRow.set(rowNumber, cells);
      }
      seen += 1;
      if (options.onProgress && seen % 1000 === 0) options.onProgress(seen);
    },
  );

  return { headers, rows, cellsByRow };
}

/* -------------------------------------------------------------------------- */
/* the lookups the write phase needs                                          */
/* -------------------------------------------------------------------------- */

type Lookups = {
  emailToContact: Map<string, string>;
  phoneToContact: Map<string, string>;
  emailsByContact: Map<string, Set<string>>;
  phonesByContact: Map<string, Set<string>>;
  companies: Map<string, string>;
  sources: Map<string, string>;
  tags: Map<string, string>;
  customFields: Map<string, string>;
  customFieldCount: number;
};

async function loadLookups(): Promise<Lookups> {
  const [emailRows, phoneRows, companyRows, sourceRows, tagRows, fieldRows] =
    await Promise.all([
      raw.query(
        `SELECT e.email_lower AS e_email_lower, e.contact_id AS e_contact_id
         FROM contact_emails e JOIN contacts c ON c.id = e.contact_id
         WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL`,
      ),
      raw.query(
        `SELECT p.e164 AS p_e164, p.contact_id AS p_contact_id
         FROM contact_phones p JOIN contacts c ON c.id = p.contact_id
         WHERE p.e164 IS NOT NULL AND p.deleted_at IS NULL AND c.deleted_at IS NULL`,
      ),
      raw.query(
        `SELECT co.name AS co_name, co.id AS co_id FROM companies co WHERE co.deleted_at IS NULL`,
      ),
      raw.query(
        `SELECT s.name AS s_name, s.id AS s_id FROM sources s WHERE s.deleted_at IS NULL`,
      ),
      raw.query(`SELECT t.name AS t_name, t.id AS t_id FROM tags t WHERE t.deleted_at IS NULL`),
      raw.query(
        `SELECT f.name AS f_name, f.id AS f_id FROM custom_fields f
         WHERE f.entity_type = 'contact' AND f.deleted_at IS NULL`,
      ),
    ]);

  const emailToContact = new Map<string, string>();
  const emailsByContact = new Map<string, Set<string>>();
  for (const r of emailRows) {
    const email = String(r[0]);
    const contactId = String(r[1]);
    if (!emailToContact.has(email)) emailToContact.set(email, contactId);
    const set = emailsByContact.get(contactId) ?? new Set<string>();
    set.add(email);
    emailsByContact.set(contactId, set);
  }

  const phoneToContact = new Map<string, string>();
  const phonesByContact = new Map<string, Set<string>>();
  for (const r of phoneRows) {
    const e164 = String(r[0]);
    const contactId = String(r[1]);
    if (!phoneToContact.has(e164)) phoneToContact.set(e164, contactId);
    const set = phonesByContact.get(contactId) ?? new Set<string>();
    set.add(e164);
    phonesByContact.set(contactId, set);
  }

  const asMap = (rows: unknown[][]) =>
    new Map(rows.map((r) => [String(r[0]).trim(), String(r[1])]));

  const customFields = asMap(fieldRows);

  return {
    emailToContact,
    phoneToContact,
    emailsByContact,
    phonesByContact,
    companies: asMap(companyRows),
    sources: asMap(sourceRows),
    tags: asMap(tagRows),
    customFields,
    customFieldCount: customFields.size,
  };
}

/* -------------------------------------------------------------------------- */
/* the duplicate preview                                                      */
/* -------------------------------------------------------------------------- */

export type DuplicateEstimate = {
  /**
   * Rows whose email or phone already belongs to a contact in this workspace,
   * OR to an earlier row in this same file (two rows of the same file can
   * name the same person without either matching anything already in Helix).
   */
  matched: number;
  /** Rows Helix could actually file (name, company, email or phone present). */
  importableRows: number;
  totalRows: number;
};

/**
 * How many rows in the WHOLE file - not just the 20-row preview - already
 * match someone in Helix, before the owner commits to a duplicate policy.
 *
 * Read-only: it re-reads the file and re-runs the same lookups `runImport`
 * would, registering each row's email/phone as it goes so a later row that
 * only matches an EARLIER row of this same file is counted too - exactly
 * what `runImport` itself does for "skip" and "update" (a within-file repeat
 * is still a duplicate; it just was not in the database yet when the file
 * started). It takes no write lock and touches no table. The preview
 * screen's three policy options ("Skip them" / "Fill in the blanks" /
 * "Import anyway") said what WOULD happen to a match; without this, the
 * owner had no way to know how many rows that even applied to until after
 * the import ran.
 */
export async function estimateDuplicateMatches(
  text: string,
  mapping: ColumnMapping[],
  options: { delimiter?: Delimiter; region?: string } = {},
): Promise<DuplicateEstimate> {
  const { rows } = await readMappedRows(text, mapping, {
    delimiter: options.delimiter,
    region: options.region,
  });
  const lookups = await loadLookups();

  let matched = 0;
  let importableRows = 0;
  for (const row of rows) {
    if (!row.importable) continue;
    importableRows += 1;
    const key = dedupeKeyFor(row);
    if (!key) continue;
    const map = key.kind === "email" ? lookups.emailToContact : lookups.phoneToContact;
    if (map.has(key.value)) {
      matched += 1;
    } else {
      // Not a real contact id - just a placeholder so the NEXT row with this
      // same key is recognised as a repeat, the way runImport's own
      // mid-loop registration works.
      map.set(key.value, "");
    }
  }

  return { matched, importableRows, totalRows: rows.length };
}

/* -------------------------------------------------------------------------- */
/* the run                                                                    */
/* -------------------------------------------------------------------------- */

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  const started = Date.now();
  const report = options.onProgress ?? (() => {});

  report({ phase: "reading", processed: 0, total: 0 });
  const { headers, rows, cellsByRow } = await readMappedRows(options.text, options.mapping, {
    delimiter: options.delimiter,
    region: options.region,
    onProgress: (n) => report({ phase: "reading", processed: n, total: 0 }),
  });

  const total = rows.length;
  const counts: ImportCounts = {
    created: 0,
    updated: 0,
    skipped: 0,
    companiesCreated: 0,
    tagsCreated: 0,
    customFieldsCreated: 0,
  };
  const skippedRows: SkippedRow[] = [];
  const warnings: ImportWarning[] = [];
  let skippedTruncated = false;
  let warningsTruncated = false;
  const batchId = newBatchId();

  const noteSkip = (row: MappedRow, reason: string) => {
    counts.skipped += 1;
    if (skippedRows.length >= MAX_SKIPPED_KEPT) {
      skippedTruncated = true;
      return;
    }
    skippedRows.push({
      rowNumber: row.rowNumber,
      reason,
      cells: cellsByRow.get(row.rowNumber) ?? [],
    });
  };

  // A row that DID import may still carry warning-level flags from
  // `applyMapping` (an email that does not look like one, a phone Helix
  // could not dial, a row with no name). Those used to be computed and then
  // thrown away the moment the row was not an outright skip - the owner had
  // no way to learn about them short of re-reading the whole file himself.
  const collectWarnings = (row: MappedRow) => {
    for (const flag of row.flags) {
      if (flag.level !== "warning") continue;
      if (warnings.length >= MAX_WARNINGS_KEPT) {
        warningsTruncated = true;
        continue;
      }
      warnings.push({
        rowNumber: row.rowNumber,
        kind: flag.kind,
        message: flag.message,
        column: flag.column,
      });
    }
  };

  if (options.dryRun) {
    for (const row of rows) {
      if (!row.importable) {
        noteSkip(row, row.flags[0]?.message ?? "Nothing to file this row under.");
      } else {
        collectWarnings(row);
      }
    }
    report({ phase: "done", processed: total, total });
    return {
      ...counts,
      totalRows: total,
      batchId,
      durationMs: Date.now() - started,
      headers,
      skippedRows,
      skippedTruncated,
      warnings,
      warningsTruncated,
      preImportBackupPath: null,
    };
  }

  // Before the write lock and before the transaction: an import that updates
  // existing rows is undone by restoring this file, and a backup taken after
  // the first statement would be a backup of the damage (F-OPS-4). A failure
  // here throws BackupWriteError and the import never starts.
  const preImportBackupPath = options.backup === false ? null : (await backupBeforeImport()).path;

  const resumeTimers = pauseTimers();
  try {
    await withTransaction(async () => {
      const lookups = await loadLookups();
      let pending: Statement[] = [];
      let processed = 0;
      let rowInFlight = 0;

      const flush = async () => {
        if (pending.length === 0) return;
        const batch = planBatch(pending);
        pending = [];
        try {
          await raw.batch(batch);
        } catch (err) {
          throw new ImportWriteError(
            `Helix stopped at row ${rowInFlight}. Nothing was imported.`,
            err,
            rowInFlight,
          );
        }
      };

      for (const row of rows) {
        rowInFlight = row.rowNumber;
        processed += 1;

        if (!row.importable) {
          noteSkip(row, row.flags[0]?.message ?? "Nothing to file this row under.");
        } else {
          collectWarnings(row);
          const key = dedupeKeyFor(row);
          const existingId =
            options.policy === "duplicate" || key === null
              ? null
              : key.kind === "email"
                ? (lookups.emailToContact.get(key.value) ?? null)
                : (lookups.phoneToContact.get(key.value) ?? null);

          if (existingId !== null && options.policy === "skip") {
            noteSkip(
              row,
              `Already in Helix (matched on ${key?.kind === "email" ? "email" : "phone"} ${key?.value}).`,
            );
          } else {
            // Company: link by exact name, create when it is new.
            let companyId: string | null = null;
            if (row.company.length > 0) {
              const name = row.company.trim();
              const found = lookups.companies.get(name);
              if (found) {
                companyId = found;
              } else {
                const created = companyCreateStatement(name);
                pending.push(created.statement);
                lookups.companies.set(name, created.id);
                companyId = created.id;
                counts.companiesCreated += 1;
              }
            }

            // Source.
            let sourceId: string | null = null;
            if (row.source.length > 0) {
              const name = row.source.trim();
              const found = lookups.sources.get(name);
              if (found) {
                sourceId = found;
              } else {
                const created = sourceCreateStatement(name);
                pending.push(created.statement);
                lookups.sources.set(name, created.id);
                sourceId = created.id;
              }
            }

            let contactId: string;
            if (existingId !== null) {
              contactId = existingId;
              const update = contactUpdateStatement(existingId, {
                firstName: row.firstName,
                lastName: row.lastName,
                companyId,
                addressJson: addressJsonFor(row.address),
                sourceId,
                notes: row.notes.length > 0 ? row.notes : null,
              });
              if (update) pending.push(update);

              const known = lookups.emailsByContact.get(existingId) ?? new Set<string>();
              for (const email of row.emails) {
                if (email.email.length === 0 || known.has(email.email)) continue;
                pending.push(contactEmailStatement(existingId, email.email, email.label));
                known.add(email.email);
                lookups.emailToContact.set(email.email, existingId);
              }
              lookups.emailsByContact.set(existingId, known);

              const knownPhones = lookups.phonesByContact.get(existingId) ?? new Set<string>();
              for (const phone of row.phones) {
                if (phone.e164 !== null && knownPhones.has(phone.e164)) continue;
                pending.push(
                  contactPhoneStatement(existingId, phone.raw, phone.label, {
                    region: options.region,
                  }),
                );
                if (phone.e164 !== null) {
                  knownPhones.add(phone.e164);
                  lookups.phoneToContact.set(phone.e164, existingId);
                }
              }
              lookups.phonesByContact.set(existingId, knownPhones);
              counts.updated += 1;
            } else {
              const created = importContactStatements(
                {
                  firstName: row.firstName,
                  lastName: row.lastName,
                  companyId,
                  sourceId,
                  notes: row.notes.length > 0 ? row.notes : null,
                  addressJson: addressJsonFor(row.address),
                  phones: row.phones.map((p) => ({ raw: p.raw, label: p.label })),
                  emails: row.emails.map((e) => ({ email: e.email, label: e.label })),
                },
                options.region,
              );
              contactId = created.id;
              pending.push(...created.statements);

              // Register the new contact so a later row in the same file
              // dedupes against it instead of creating a twin.
              if (options.policy !== "duplicate") {
                const emails = new Set<string>();
                for (const email of row.emails) {
                  if (email.email.length === 0) continue;
                  emails.add(email.email);
                  if (!lookups.emailToContact.has(email.email)) {
                    lookups.emailToContact.set(email.email, contactId);
                  }
                }
                lookups.emailsByContact.set(contactId, emails);
                const phones = new Set<string>();
                for (const phone of row.phones) {
                  if (phone.e164 === null) continue;
                  phones.add(phone.e164);
                  if (!lookups.phoneToContact.has(phone.e164)) {
                    lookups.phoneToContact.set(phone.e164, contactId);
                  }
                }
                lookups.phonesByContact.set(contactId, phones);
              }
              counts.created += 1;
            }

            // Tags.
            for (const tag of row.tags) {
              let tagId = lookups.tags.get(tag);
              if (!tagId) {
                const created = tagCreateStatement(tag);
                pending.push(created.statement);
                lookups.tags.set(tag, created.id);
                tagId = created.id;
                counts.tagsCreated += 1;
              }
              pending.push(tagLinkStatement(tagId, "contact", contactId));
            }

            // Custom fields.
            for (const custom of row.custom) {
              let fieldId = lookups.customFields.get(custom.name);
              if (!fieldId) {
                const created = customFieldCreateStatement(
                  "contact",
                  custom.name,
                  lookups.customFieldCount,
                );
                pending.push(created.statement);
                lookups.customFields.set(custom.name, created.id);
                lookups.customFieldCount += 1;
                fieldId = created.id;
                counts.customFieldsCreated += 1;
              }
              pending.push(customValueStatement(fieldId, contactId, custom.value));
            }
          }
        }

        if (processed % BATCH_ROWS === 0) {
          await flush();
          report({ phase: "writing", processed, total });
        }
      }

      await flush();

      // One change_log row for the whole import rather than one per contact:
      // 100k rows would otherwise double the work, and undo for an import is
      // "restore the backup", not "walk the log".
      const logStatement = changeLogStatement({
        entityType: "import",
        entityId: batchId,
        op: "create",
        after: {
          created: counts.created,
          updated: counts.updated,
          skipped: counts.skipped,
          companiesCreated: counts.companiesCreated,
          at: nowIso(),
        },
        batchId,
      });
      await raw.execute(logStatement.sql, logStatement.params);
    }, "Importing a CSV");
  } catch (err) {
    if (err instanceof ImportWriteError) throw err;
    throw new ImportWriteError(
      err instanceof Error
        ? `Nothing was imported. ${err.message}`
        : "Nothing was imported.",
      err,
    );
  } finally {
    resumeTimers();
  }

  report({ phase: "done", processed: total, total });

  return {
    ...counts,
    totalRows: total,
    batchId,
    durationMs: Date.now() - started,
    headers,
    skippedRows,
    skippedTruncated,
    warnings,
    warningsTruncated,
    preImportBackupPath,
  };
}
