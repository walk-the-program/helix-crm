/**
 * The import itself, for companies, deals and services.
 *
 *   text + mapping
 *        |
 *        v  walkCsv, one row in memory at a time
 *   DraftRow[]  -- only the mapped fields are kept
 *        |
 *        v  pauseTimers() + withTransaction()
 *   prefetch: stages, contacts by email/phone/name, companies, sources, tags,
 *             the open deals already in the pipeline, the next free position
 *             in every stage
 *        |
 *        v  per row: resolve -> decide (skip | update | create) -> statements
 *   every 500 rows: coalesce into multi-row inserts -> raw.batch
 *        |
 *        v  commit -> counts + warnings + the rows that did not go in
 *
 * Same promise as the contacts import (`lib/importRun.ts`, which this
 * deliberately mirrors rather than refactors): one transaction for the whole
 * file, so a failure part way through leaves nothing behind.
 *
 * The difference is what a row has to be tied to. A contact row is a contact.
 * A deal row is a deal plus, quite often, a person and a business that either
 * already exist or have to be made on the spot. Everything Helix had to guess
 * about becomes a warning on the result screen rather than a failed row:
 * the owner gets the import and the list of what to look at.
 */
import { raw } from "@/db/client";
import { pauseTimers, withTransaction } from "@/db/writeLock";
import { changeLogStatement } from "@/db/changeLog";
import { newBatchId, newId } from "@/lib/ids";
import { nowIso, parseDateOnly, toIso } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAll as getAllSettings } from "@/db/repos/settings";
import type { Delimiter } from "@/lib/csv";
import { splitFullName } from "@/features/data/lib/mapping";
import { backupBeforeImport } from "@/features/data/lib/backupsFs";
import {
  readDraftRow,
  type DraftRow,
  type TypedColumnMapping,
} from "@/features/data/lib/typedMapping";
import { importType } from "@/features/data/import/fields/index";
import {
  draftList,
  draftNumber,
  draftText,
  type ImportTypeId,
} from "@/features/data/import/fields/types";
import { insertStatement, planBatch, stampNew, type Statement } from "@/db/repos/_base";
import {
  contactEmailStatement,
  contactPhoneStatement,
  importContactStatements,
} from "@/db/repos/contacts";
import { companyCreateStatement } from "@/db/repos/companies";
import { sourceCreateStatement } from "@/db/repos/sources";
import { tagCreateStatement, tagLinkStatement } from "@/db/repos/tags";
import { systemStatement } from "@/db/repos/activities";
import {
  BATCH_ROWS,
  ImportRowLimitError,
  ImportWriteError,
  MAX_IMPORT_ROWS,
  MAX_SKIPPED_KEPT,
  type DedupePolicy,
  type ImportProgress,
  type SkippedRow,
} from "@/features/data/lib/importRun";

export const MAX_WARNINGS_KEPT = 5_000;

export type ImportWarning = {
  rowNumber: number;
  /** Groups the list on the result screen: stage, contact, money, date... */
  kind: string;
  message: string;
  column?: string;
};

export type TypedImportCounts = {
  created: number;
  updated: number;
  skipped: number;
  companiesCreated: number;
  contactsCreated: number;
  sourcesCreated: number;
  tagsCreated: number;
};

export type TypedImportResult = TypedImportCounts & {
  typeId: ImportTypeId;
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
   * means (`backupBeforeImport`). Null on a dry run, and null when the caller
   * asked for no backup - only the tests do.
   */
  preImportBackupPath: string | null;
};

export type TypedImportOptions = {
  typeId: ImportTypeId;
  text: string;
  mapping: TypedColumnMapping[];
  delimiter?: Delimiter;
  policy: DedupePolicy;
  region?: string;
  onProgress?: (progress: ImportProgress) => void;
  dryRun?: boolean;
  /**
   * Off in the repo tests, which run against a better-sqlite3 file. The product
   * never passes it.
   */
  backup?: boolean;
};

/* -------------------------------------------------------------------------- */
/* the duplicate question, per type                                           */
/* -------------------------------------------------------------------------- */

export type PolicyOption = { value: DedupePolicy; label: string; hint: string };

/**
 * Deals have no natural key - two "Water heater replacement" rows for the same
 * customer in the same month are usually the same job, and sometimes two
 * houses. So the question Helix asks about a deal is narrower than the one it
 * asks about a person, and there is no "fill in the blanks": there is nothing
 * to fill in on a deal the owner has already been working.
 */
export const COMPANY_POLICIES: readonly PolicyOption[] = [
  {
    value: "skip",
    label: "Skip them",
    hint: "Leave the record already in Helix exactly as it is.",
  },
  {
    value: "update",
    label: "Fill in the blanks",
    hint: "Add the details that are missing. Nothing already filled in is overwritten.",
  },
  {
    value: "duplicate",
    label: "Import anyway",
    hint: "Create a second record. You can merge them later on the Duplicates screen.",
  },
];

export const DEAL_POLICIES: readonly PolicyOption[] = [
  {
    value: "skip",
    label: "Skip them",
    hint: "Leave out a row whose deal name and customer already match a deal you have open.",
  },
  {
    value: "duplicate",
    label: "Import anyway",
    hint: "Bring in every row, even the ones that look like a job already on your board.",
  },
];

export function policiesFor(typeId: ImportTypeId): readonly PolicyOption[] {
  return typeId === "deals" ? DEAL_POLICIES : COMPANY_POLICIES;
}

/* -------------------------------------------------------------------------- */
/* reading                                                                    */
/* -------------------------------------------------------------------------- */

export type TypedReadResult = {
  headers: string[];
  rows: DraftRow[];
  cellsByRow: Map<number, string[]>;
};

/**
 * papaparse (behind @/lib/csv's walkCsv) is loaded here, at the point of use:
 * the import resolves once, before the parse starts, so the row-by-row `step`
 * streaming below it is unaffected.
 */
export async function readDraftRows(
  typeId: ImportTypeId,
  text: string,
  mapping: TypedColumnMapping[],
  options: { delimiter?: Delimiter; region?: string; onProgress?: (n: number) => void } = {},
): Promise<TypedReadResult> {
  const { walkCsv } = await import("@/lib/csv");
  const type = importType(typeId);
  const rows: DraftRow[] = [];
  const cellsByRow = new Map<number, string[]>();
  let seen = 0;

  const { headers } = walkCsv(text, { delimiter: options.delimiter }, (cells, rowNumber) => {
    if (seen >= MAX_IMPORT_ROWS) throw new ImportRowLimitError(MAX_IMPORT_ROWS);
    const row = readDraftRow(type, cells, mapping, rowNumber, { region: options.region });
    rows.push(row);
    if (!row.importable && cellsByRow.size < MAX_SKIPPED_KEPT) {
      cellsByRow.set(rowNumber, cells);
    }
    seen += 1;
    if (options.onProgress && seen % 1000 === 0) options.onProgress(seen);
  });

  return { headers, rows, cellsByRow };
}

/* -------------------------------------------------------------------------- */
/* what the write phase needs to know about this workspace                    */
/* -------------------------------------------------------------------------- */

type StageRow = {
  id: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
};

type Lookups = {
  /** lower(name) -> stage. */
  stages: Map<string, StageRow>;
  /** Board order. The first entry is where an unknown stage lands. */
  stageOrder: StageRow[];
  wonStage: StageRow | null;
  lostStage: StageRow | null;
  /** stage id -> the next free position in that stage. */
  nextPosition: Map<string, number>;
  /**
   * The workspace's own currency and locale (F-LC-1).
   *
   * An imported deal used to be stamped `currency: "USD"` outright, and the
   * warning about a mismatched money column printed US dollars in the
   * browser's locale, whatever the owner had chosen in Settings. This is a
   * lookup rather than a hook because none of this runs inside a component.
   */
  currency: string;
  locale: string;
  emailToContact: Map<string, string>;
  phoneToContact: Map<string, string>;
  /** lower("first last") -> contact id. Only names that are unambiguous. */
  nameToContact: Map<string, string>;
  companies: Map<string, string>;
  /** lower(name) -> id, for the "already here?" question. */
  companiesLower: Map<string, string>;
  sources: Map<string, string>;
  tags: Map<string, string>;
  /** "title|contactId" for every deal in a stage that is neither won nor lost. */
  openDeals: Set<string>;
  /** lower(name) -> product id, for the services catalog. */
  products: Map<string, string>;
  /** The next free position at the bottom of the services list. */
  nextProductPosition: number;
  /** True once the deals table has grown the split-revenue columns. */
  dealRevenueColumns: boolean;
};

/** Does this database have the catalog agent's one_time_cents / recurring_monthly_cents yet? */
async function hasDealRevenueColumns(): Promise<boolean> {
  try {
    const rows = await raw.query(`PRAGMA table_info(deals)`);
    const names = new Set(rows.map((r) => String(r[1]).toLowerCase()));
    return names.has("one_time_cents") && names.has("recurring_monthly_cents");
  } catch {
    return false;
  }
}

async function loadLookups(typeId: ImportTypeId): Promise<Lookups> {
  const needsDeals = typeId === "deals";
  const needsProducts = typeId === "services";

  const [stageRows, emailRows, phoneRows, nameRows, companyRows, sourceRows, tagRows] =
    await Promise.all([
      needsDeals
        ? raw.query(
            `SELECT s.id AS s_id, s.name AS s_name, s.is_won AS s_is_won, s.is_lost AS s_is_lost
             FROM stages s WHERE s.deleted_at IS NULL
             ORDER BY s.position ASC, s.created_at ASC`,
          )
        : Promise.resolve([] as unknown[][]),
      needsDeals
        ? raw.query(
            `SELECT e.email_lower AS e_email, e.contact_id AS e_contact
             FROM contact_emails e JOIN contacts c ON c.id = e.contact_id
             WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL`,
          )
        : Promise.resolve([] as unknown[][]),
      needsDeals
        ? raw.query(
            `SELECT p.e164 AS p_e164, p.contact_id AS p_contact
             FROM contact_phones p JOIN contacts c ON c.id = p.contact_id
             WHERE p.e164 IS NOT NULL AND p.deleted_at IS NULL AND c.deleted_at IS NULL`,
          )
        : Promise.resolve([] as unknown[][]),
      needsDeals
        ? raw.query(
            `SELECT lower(trim(c.first_name || ' ' || c.last_name)) AS c_name,
                    c.id AS c_id, count(*) OVER (PARTITION BY lower(trim(c.first_name || ' ' || c.last_name))) AS c_count
             FROM contacts c WHERE c.deleted_at IS NULL`,
          )
        : Promise.resolve([] as unknown[][]),
      raw.query(`SELECT co.name AS co_name, co.id AS co_id FROM companies co WHERE co.deleted_at IS NULL`),
      raw.query(`SELECT s.name AS s_name, s.id AS s_id FROM sources s WHERE s.deleted_at IS NULL`),
      raw.query(`SELECT t.name AS t_name, t.id AS t_id FROM tags t WHERE t.deleted_at IS NULL`),
    ]);

  const stageOrder: StageRow[] = stageRows.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    isWon: Number(r[2]) === 1,
    isLost: Number(r[3]) === 1,
  }));
  const stages = new Map<string, StageRow>();
  for (const stage of stageOrder) {
    const key = stage.name.trim().toLowerCase();
    if (!stages.has(key)) stages.set(key, stage);
  }

  const emailToContact = new Map<string, string>();
  for (const r of emailRows) {
    const email = String(r[0]);
    if (!emailToContact.has(email)) emailToContact.set(email, String(r[1]));
  }

  const phoneToContact = new Map<string, string>();
  for (const r of phoneRows) {
    const e164 = String(r[0]);
    if (!phoneToContact.has(e164)) phoneToContact.set(e164, String(r[1]));
  }

  // A name only identifies someone when exactly one person has it. Two Dave
  // Chens and Helix must not guess which deal is whose.
  const nameToContact = new Map<string, string>();
  for (const r of nameRows) {
    const name = String(r[0]).trim();
    if (name.length === 0 || Number(r[2]) !== 1) continue;
    nameToContact.set(name, String(r[1]));
  }

  const companies = new Map<string, string>();
  const companiesLower = new Map<string, string>();
  for (const r of companyRows) {
    const name = String(r[0]).trim();
    const id = String(r[1]);
    if (!companies.has(name)) companies.set(name, id);
    const lower = name.toLowerCase();
    if (!companiesLower.has(lower)) companiesLower.set(lower, id);
  }

  const asMap = (rows: unknown[][]) =>
    new Map(rows.map((r) => [String(r[0]).trim(), String(r[1])]));

  const products = new Map<string, string>();
  let nextProductPosition = 0;
  if (needsProducts) {
    const productRows = await raw.query(
      `SELECT p.name AS p_name, p.id AS p_id, p.position AS p_position
       FROM products p WHERE p.deleted_at IS NULL`,
    );
    for (const r of productRows) {
      const key = String(r[0]).trim().toLowerCase();
      if (!products.has(key)) products.set(key, String(r[1]));
      nextProductPosition = Math.max(nextProductPosition, Number(r[2]) + 1);
    }
  }

  const nextPosition = new Map<string, number>();
  const openDeals = new Set<string>();
  let dealRevenueColumns = false;
  if (needsDeals) {
    const positionRows = await raw.query(
      `SELECT d.stage_id AS d_stage, coalesce(max(d.position), -1) AS d_max
       FROM deals d WHERE d.deleted_at IS NULL GROUP BY d.stage_id`,
    );
    for (const r of positionRows) nextPosition.set(String(r[0]), Number(r[1]) + 1);
    for (const stage of stageOrder) {
      if (!nextPosition.has(stage.id)) nextPosition.set(stage.id, 0);
    }

    const openRows = await raw.query(
      `SELECT lower(trim(d.title)) AS d_title, coalesce(d.contact_id, '') AS d_contact
       FROM deals d JOIN stages s ON s.id = d.stage_id
       WHERE d.deleted_at IS NULL AND s.is_won = 0 AND s.is_lost = 0`,
    );
    for (const r of openRows) openDeals.add(`${String(r[0])}|${String(r[1])}`);

    dealRevenueColumns = await hasDealRevenueColumns();
  }

  const workspaceSettings = await getAllSettings();

  return {
    currency: workspaceSettings.currency,
    locale: workspaceSettings.locale,
    stages,
    stageOrder,
    wonStage: stageOrder.find((s) => s.isWon) ?? null,
    lostStage: stageOrder.find((s) => s.isLost) ?? null,
    nextPosition,
    emailToContact,
    phoneToContact,
    nameToContact,
    companies,
    companiesLower,
    sources: asMap(sourceRows),
    tags: asMap(tagRows),
    products,
    nextProductPosition,
    openDeals,
    dealRevenueColumns,
  };
}

/* -------------------------------------------------------------------------- */
/* small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

function addressJson(draft: Record<string, unknown>): string | null {
  const parts: Record<string, string> = {};
  for (const key of ["street", "city", "state", "postal", "country"] as const) {
    const value = draft[key];
    if (typeof value === "string" && value.trim().length > 0) parts[key] = value.trim();
  }
  return Object.keys(parts).length === 0 ? null : JSON.stringify(parts);
}

/** A date-only string becomes an instant at local noon, well clear of any edge. */
function closedAtFrom(dateOnly: string): string {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed) return nowIso();
  parsed.setHours(12, 0, 0, 0);
  return toIso(parsed);
}

/* -------------------------------------------------------------------------- */
/* the run                                                                    */
/* -------------------------------------------------------------------------- */

export async function runTypedImport(
  options: TypedImportOptions,
): Promise<TypedImportResult> {
  const started = Date.now();
  const report = options.onProgress ?? (() => {});
  const typeId = options.typeId;
  if (typeId === "contacts") {
    throw new Error("Contacts go through runImport, not runTypedImport.");
  }

  report({ phase: "reading", processed: 0, total: 0 });
  const { headers, rows, cellsByRow } = await readDraftRows(typeId, options.text, options.mapping, {
    delimiter: options.delimiter,
    region: options.region,
    onProgress: (n) => report({ phase: "reading", processed: n, total: 0 }),
  });

  const total = rows.length;
  const counts: TypedImportCounts = {
    created: 0,
    updated: 0,
    skipped: 0,
    companiesCreated: 0,
    contactsCreated: 0,
    sourcesCreated: 0,
    tagsCreated: 0,
  };
  const skippedRows: SkippedRow[] = [];
  const warnings: ImportWarning[] = [];
  let skippedTruncated = false;
  let warningsTruncated = false;
  const batchId = newBatchId();

  const warn = (rowNumber: number, kind: string, message: string, column?: string) => {
    if (warnings.length >= MAX_WARNINGS_KEPT) {
      warningsTruncated = true;
      return;
    }
    warnings.push({ rowNumber, kind, message, column });
  };

  const noteSkip = (row: DraftRow, reason: string) => {
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

  let preImportBackupPath: string | null = null;

  const finish = (): TypedImportResult => ({
    ...counts,
    typeId,
    totalRows: total,
    batchId,
    durationMs: Date.now() - started,
    headers,
    skippedRows,
    skippedTruncated,
    warnings,
    warningsTruncated,
    preImportBackupPath,
  });

  if (options.dryRun) {
    for (const row of rows) {
      for (const flag of row.warnings) {
        if (flag.level === "warning") warn(row.rowNumber, flag.kind, flag.message, flag.column);
      }
      if (!row.importable) {
        noteSkip(row, row.warnings[0]?.message ?? "Nothing to file this row under.");
      }
    }
    report({ phase: "done", processed: total, total });
    return finish();
  }

  // Before the write lock and before the transaction, for the same reason the
  // contacts importer does it: restoring this file is what undoing an import
  // means, and a backup taken after the first statement is a backup of the
  // damage (F-OPS-4). A failure here throws and the import never starts.
  if (options.backup !== false) {
    preImportBackupPath = (await backupBeforeImport()).path;
  }

  const resumeTimers = pauseTimers();
  try {
    await withTransaction(async () => {
      const lookups = await loadLookups(typeId);
      let pending: Statement[] = [];
      let processed = 0;
      let rowInFlight = 0;
      /** Said once per file, not once per row. */
      let saidRevenueMerged = false;
      /** Was there anyone here to match a deal's contact against? */
      const hadContactsToMatch =
        lookups.emailToContact.size > 0 ||
        lookups.phoneToContact.size > 0 ||
        lookups.nameToContact.size > 0;

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

      /** The company on this row: matched on the exact name, created when new. */
      const resolveCompany = (name: string): string | null => {
        if (name.length === 0) return null;
        const exact = lookups.companies.get(name);
        if (exact) return exact;
        const created = companyCreateStatement(name);
        pending.push(created.statement);
        lookups.companies.set(name, created.id);
        lookups.companiesLower.set(name.toLowerCase(), created.id);
        counts.companiesCreated += 1;
        return created.id;
      };

      const resolveSource = (name: string): string | null => {
        if (name.length === 0) return null;
        const found = lookups.sources.get(name);
        if (found) return found;
        const created = sourceCreateStatement(name);
        pending.push(created.statement);
        lookups.sources.set(name, created.id);
        counts.sourcesCreated += 1;
        return created.id;
      };

      const linkTags = (tags: string[], entityType: string, entityId: string) => {
        for (const tag of tags) {
          let tagId = lookups.tags.get(tag);
          if (!tagId) {
            const created = tagCreateStatement(tag);
            pending.push(created.statement);
            lookups.tags.set(tag, created.id);
            counts.tagsCreated += 1;
            tagId = created.id;
          }
          pending.push(tagLinkStatement(tagId, entityType, entityId));
        }
      };

      for (const row of rows) {
        rowInFlight = row.rowNumber;
        processed += 1;

        for (const flag of row.warnings) {
          if (flag.level === "warning") {
            warn(row.rowNumber, flag.kind, flag.message, flag.column);
          }
        }

        if (!row.importable) {
          noteSkip(row, row.warnings[0]?.message ?? "Nothing to file this row under.");
        } else if (typeId === "companies") {
          writeCompanyRow(row);
        } else if (typeId === "services") {
          writeServiceRow(row);
        } else {
          writeDealRow(row);
        }

        if (processed % BATCH_ROWS === 0) {
          await flush();
          report({ phase: "writing", processed, total });
        }
      }

      /* ------------------------------------------------------------------ */
      /* companies                                                          */
      /* ------------------------------------------------------------------ */

      function writeCompanyRow(row: DraftRow) {
        const draft = row.draft;
        const name = draftText(draft, "name");
        const existingId =
          options.policy === "duplicate"
            ? null
            : (lookups.companies.get(name) ?? lookups.companiesLower.get(name.toLowerCase()) ?? null);

        if (existingId !== null && options.policy === "skip") {
          noteSkip(row, `Already in Helix (matched on the name "${name}").`);
          return;
        }

        const phone = draftText(draft, "phone");
        const website = draftText(draft, "website");
        const notes = draftList(draft, "notes").join("\n");
        const sourceId = resolveSource(draftText(draft, "source"));
        const address = addressJson(draft);

        if (existingId !== null) {
          // Fill in the blanks only: COALESCE(NULLIF(...)) never overwrites
          // something the owner has already typed.
          const sets: string[] = [];
          const params: unknown[] = [];
          const fill = (column: string, value: unknown) => {
            sets.push(`${column} = COALESCE(NULLIF(${column}, ''), ?)`);
            params.push(value);
          };
          if (phone.length > 0) {
            fill("phone_raw", phone);
            fill("phone_e164", phone.startsWith("+") ? phone : null);
          }
          if (website.length > 0) fill("website", website);
          if (address !== null) fill("address_json", address);
          if (notes.length > 0) fill("notes", notes);
          if (sourceId !== null) fill("source_id", sourceId);
          if (sets.length > 0) {
            sets.push("updated_at = ?");
            params.push(nowIso());
            pending.push({
              sql: `UPDATE companies SET ${sets.join(", ")} WHERE id = ?`,
              params: [...params, existingId],
            });
          }
          linkTags(draftList(draft, "tags"), "company", existingId);
          counts.updated += 1;
          return;
        }

        const stamps = stampNew();
        pending.push(
          insertStatement("companies", {
            ...stamps,
            name,
            website: website.length > 0 ? website : null,
            phoneRaw: phone.length > 0 ? phone : null,
            phoneE164: phone.startsWith("+") ? phone : null,
            addressJson: address,
            sourceId,
            notes: notes.length > 0 ? notes : null,
            deletedAt: null,
          }),
        );
        lookups.companies.set(name, stamps.id);
        lookups.companiesLower.set(name.toLowerCase(), stamps.id);
        linkTags(draftList(draft, "tags"), "company", stamps.id);
        counts.created += 1;
      }

      /* ------------------------------------------------------------------ */
      /* services (the catalog)                                             */
      /* ------------------------------------------------------------------ */

      function writeServiceRow(row: DraftRow) {
        const draft = row.draft;
        const name = draftText(draft, "name");
        const existingId =
          options.policy === "duplicate" ? null : (lookups.products.get(name.toLowerCase()) ?? null);

        if (existingId !== null && options.policy === "skip") {
          noteSkip(row, `Already in your services (matched on the name "${name}").`);
          return;
        }

        const description = draftText(draft, "description");
        const priceCents = draftNumber(draft, "price") ?? 0;
        const billing = draftText(draft, "billing");
        // 'one_time' never carries an interval; 'recurring' always does
        // (src/db/repos/products.ts says so, and reports read it directly).
        const kind = billing === "Monthly" || billing === "Yearly" ? "recurring" : "one_time";
        const interval =
          kind === "recurring" ? (billing === "Yearly" ? "year" : "month") : null;
        const taxable = draftText(draft, "taxable") === "Yes";

        if (existingId !== null) {
          const sets: string[] = [];
          const params: unknown[] = [];
          if (description.length > 0) {
            sets.push("description = COALESCE(NULLIF(description, ''), ?)");
            params.push(description);
          }
          if (priceCents > 0) {
            // A price of zero on an existing service is almost always a blank
            // column, not a decision to give the work away.
            sets.push("unit_price_cents = CASE WHEN unit_price_cents = 0 THEN ? ELSE unit_price_cents END");
            params.push(priceCents);
          }
          if (sets.length > 0) {
            sets.push("updated_at = ?");
            params.push(nowIso());
            pending.push({
              sql: `UPDATE products SET ${sets.join(", ")} WHERE id = ?`,
              params: [...params, existingId],
            });
          }
          counts.updated += 1;
          return;
        }

        const stamps = stampNew();
        pending.push(
          insertStatement("products", {
            ...stamps,
            name,
            description: description.length > 0 ? description : null,
            kind,
            interval,
            unitPriceCents: priceCents,
            taxable,
            active: true,
            position: lookups.nextProductPosition,
            deletedAt: null,
          }),
        );
        lookups.nextProductPosition += 1;
        lookups.products.set(name.toLowerCase(), stamps.id);
        counts.created += 1;
      }

      /* ------------------------------------------------------------------ */
      /* deals                                                              */
      /* ------------------------------------------------------------------ */

      function writeDealRow(row: DraftRow) {
        const draft = row.draft;
        const title = draftText(draft, "title");

        // --- the person -------------------------------------------------
        const contactName = draftText(draft, "contactName");
        const contactEmail = draftText(draft, "contactEmail");
        const contactPhone = draftText(draft, "contactPhone");
        const companyId = resolveCompany(draftText(draft, "company"));
        const sourceId = resolveSource(draftText(draft, "source"));

        let contactId: string | null = null;
        if (contactEmail.length > 0) {
          contactId = lookups.emailToContact.get(contactEmail) ?? null;
        }
        if (contactId === null && contactPhone.startsWith("+")) {
          contactId = lookups.phoneToContact.get(contactPhone) ?? null;
        }
        if (contactId === null && contactName.length > 0) {
          contactId = lookups.nameToContact.get(contactName.toLowerCase()) ?? null;
        }

        if (contactId === null && (contactName.length > 0 || contactEmail.length > 0)) {
          // Nobody here matches, so make them. A row with an email and no name
          // still gets a record - losing the address would be worse than a
          // contact with a blank name, and the warning says what happened.
          const split = splitFullName(contactName);
          const created = importContactStatements(
            {
              firstName: split.firstName,
              lastName: split.lastName,
              companyId,
              sourceId,
              notes: null,
              addressJson: null,
              phones: contactPhone.length > 0 ? [{ raw: contactPhone, label: "mobile" }] : [],
              emails: contactEmail.length > 0 ? [{ email: contactEmail, label: "work" }] : [],
            },
            options.region,
          );
          pending.push(...created.statements);
          contactId = created.id;
          counts.contactsCreated += 1;

          if (contactEmail.length > 0) lookups.emailToContact.set(contactEmail, contactId);
          if (contactPhone.startsWith("+")) lookups.phoneToContact.set(contactPhone, contactId);
          if (contactName.length > 0) {
            lookups.nameToContact.set(contactName.toLowerCase(), contactId);
          }

          // Only worth saying when there was somebody to match against. On a
          // workspace with no contacts in it yet, every row creates one and
          // "Helix added them" thirty times over is noise - the result screen
          // already says how many contacts were created.
          if (hadContactsToMatch) {
            warn(
              row.rowNumber,
              "contact",
              contactName.length > 0
                ? `No one here matched ${contactName}, so Helix added them.`
                : `No one here matched ${contactEmail}, so Helix added a contact for that address.`,
            );
          }
        } else if (contactId !== null && contactEmail.length > 0) {
          // A match on the phone or the name may still be missing this email.
          if (lookups.emailToContact.get(contactEmail) !== contactId) {
            pending.push(contactEmailStatement(contactId, contactEmail, "work"));
            lookups.emailToContact.set(contactEmail, contactId);
          }
        } else if (contactId !== null && contactPhone.startsWith("+")) {
          if (lookups.phoneToContact.get(contactPhone) !== contactId) {
            pending.push(contactPhoneStatement(contactId, contactPhone, "mobile", {
              region: options.region,
            }));
            lookups.phoneToContact.set(contactPhone, contactId);
          }
        }

        // --- already on the board? --------------------------------------
        const dealKey = `${title.toLowerCase()}|${contactId ?? ""}`;
        if (options.policy !== "duplicate" && lookups.openDeals.has(dealKey)) {
          noteSkip(
            row,
            contactId === null
              ? `"${title}" is already open on your board.`
              : `"${title}" is already open for this customer.`,
          );
          return;
        }

        // --- the stage ---------------------------------------------------
        const wonOn = draftText(draft, "wonOn");
        const lostOn = draftText(draft, "lostOn");
        const stageName = draftText(draft, "stage");

        let stage: StageRow | null = null;
        if (stageName.length > 0) {
          stage = lookups.stages.get(stageName.toLowerCase()) ?? null;
          if (stage === null) {
            stage = lookups.stageOrder[0] ?? null;
            warn(
              row.rowNumber,
              "stage",
              `You do not have a stage called "${stageName}". This one went into ${
                stage?.name ?? "your first stage"
              }.`,
              "Stage",
            );
          }
        } else if (wonOn.length > 0 && lookups.wonStage) {
          stage = lookups.wonStage;
        } else if (lostOn.length > 0 && lookups.lostStage) {
          stage = lookups.lostStage;
        } else {
          stage = lookups.stageOrder[0] ?? null;
        }

        if (stage === null) {
          noteSkip(row, "This workspace has no pipeline stages to put a deal in.");
          return;
        }

        // A won or lost date closes the deal whichever stage it landed in.
        const closedAt =
          wonOn.length > 0
            ? closedAtFrom(wonOn)
            : lostOn.length > 0
              ? closedAtFrom(lostOn)
              : stage.isWon || stage.isLost
                ? nowIso()
                : null;

        // --- the money ---------------------------------------------------
        //
        // `value_cents` is the deal's ANNUAL value and it is derived, not
        // independent: one_time_cents + 12 x recurring_monthly_cents
        // (drizzle/0004_revenue.sql). So a file that carries both a total and
        // a split is read from the split, and the total is only used when
        // there is no split to read. A file whose own total disagrees with its
        // own split is worth one line in the warnings.
        //
        // On a database from before that migration there is nowhere to put the
        // split, so the two columns are added into the one total instead and
        // the owner is told once.
        const value = draftNumber(draft, "value");
        const upfront = draftNumber(draft, "upfront");
        const monthly = draftNumber(draft, "monthly");
        const hasSplit = upfront !== null || monthly !== null;

        let valueCents: number;
        let oneTimeCents: number;
        let recurringMonthlyCents: number;

        if (hasSplit) {
          oneTimeCents = upfront ?? 0;
          recurringMonthlyCents = monthly ?? 0;
          valueCents = lookups.dealRevenueColumns
            ? oneTimeCents + recurringMonthlyCents * 12
            : oneTimeCents + recurringMonthlyCents;
          if (!lookups.dealRevenueColumns && !saidRevenueMerged) {
            saidRevenueMerged = true;
            warn(
              row.rowNumber,
              "money",
              "This workspace keeps one total per deal, so the upfront and monthly columns were added together.",
            );
          }
          if (value !== null && value !== valueCents) {
            warn(
              row.rowNumber,
              "money",
              `The total in this row does not match its upfront and monthly columns, so Helix used the split: ${formatMoney(
                valueCents,
                lookups.currency,
                lookups.locale,
              )} a year.`,
            );
          }
        } else {
          valueCents = value ?? 0;
          oneTimeCents = valueCents;
          recurringMonthlyCents = 0;
        }

        // --- write it ----------------------------------------------------
        const at = nowIso();
        const stamps = { id: newId(), createdAt: at, updatedAt: at };
        const position = lookups.nextPosition.get(stage.id) ?? 0;
        lookups.nextPosition.set(stage.id, position + 1);

        const dealRow: Record<string, unknown> = {
          ...stamps,
          title,
          valueCents,
          currency: lookups.currency,
          stageId: stage.id,
          stageEnteredAt: at,
          position,
          contactId,
          companyId,
          sourceId,
          externalId: null,
          expectedOn: draftText(draft, "expectedOn") || null,
          closedAt,
          outcomeReason: null,
          deletedAt: null,
        };
        if (lookups.dealRevenueColumns) {
          dealRow.oneTimeCents = oneTimeCents;
          dealRow.recurringMonthlyCents = recurringMonthlyCents;
        }
        pending.push(insertStatement("deals", dealRow));
        pending.push(
          insertStatement("deal_stage_events", {
            id: newId(),
            createdAt: at,
            updatedAt: at,
            dealId: stamps.id,
            fromStageId: null,
            toStageId: stage.id,
            at,
            deletedAt: null,
          }),
        );

        const notes = draftList(draft, "notes").join("\n");
        if (notes.length > 0) {
          const note = systemStatement({
            body: notes,
            dealId: stamps.id,
            contactId,
            companyId,
          });
          pending.push({ sql: note.sql, params: note.params });
        }

        linkTags(draftList(draft, "tags"), "deal", stamps.id);
        if (!stage.isWon && !stage.isLost) lookups.openDeals.add(dealKey);
        counts.created += 1;
      }

      await flush();

      // One change_log row for the whole import, as the contacts import does:
      // undo for an import is "restore the backup", not "walk the log".
      const logStatement = changeLogStatement({
        entityType: "import",
        entityId: batchId,
        op: "create",
        after: {
          type: typeId,
          created: counts.created,
          updated: counts.updated,
          skipped: counts.skipped,
          contactsCreated: counts.contactsCreated,
          companiesCreated: counts.companiesCreated,
          warnings: warnings.length,
          at: nowIso(),
        },
        batchId,
      });
      await raw.execute(logStatement.sql, logStatement.params);
    }, `Importing ${typeId}`);
  } catch (err) {
    if (err instanceof ImportWriteError) throw err;
    throw new ImportWriteError(
      err instanceof Error ? `Nothing was imported. ${err.message}` : "Nothing was imported.",
      err,
    );
  } finally {
    resumeTimers();
  }

  report({ phase: "done", processed: total, total });
  return finish();
}
