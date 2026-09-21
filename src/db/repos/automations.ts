/**
 * Follow-up automations (LR-PX-C, PX-4): three fixed rules plus a per-stage
 * follow-up, all running synchronously inside the write that triggers them -
 * a lead arriving, a quote being marked sent, a deal moving stage, or the
 * daily overdue sweep. There is no job queue and no background scheduler; a
 * rule that is disabled, or has nothing to say, simply does nothing.
 *
 * Every `run*` function below is a pure-ish read-then-plan step: it assumes
 * the caller is already inside `withWrite`/`withTransaction` (the write lock
 * is not reentrant), reads what it needs, and returns the `Statement[]` the
 * caller folds into its own batch. Only `automationSweep` opens its own
 * transaction, because the daily sweep has no caller's write to run inside.
 *
 * Idempotency is a ledger, not a flag on `tasks` - see the comment block at
 * the top of drizzle/0008_automations.sql for why. Every runner checks
 * `automation_runs` before doing any work and emits the ledger row as part of
 * its own statements, so the table's unique index is the real guard even
 * under a race between two callers.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withTransaction, withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { changeLogStatement } from "@/db/changeLog";
import * as activities from "@/db/repos/activities";
import * as documents from "@/db/repos/documents";
import { nowIso, todayLocal, toIso, toLocalDateString } from "@/lib/dates";
import { newId } from "@/lib/ids";
import {
  insertStatement,
  logWrite,
  mapRows,
  parseOrThrow,
  selectList,
  stampNew,
  updateStatement,
  type Col,
  type Statement,
} from "@/db/repos/_base";

/* -------------------------------------------------------------------------- */
/* the three fixed rules                                                     */
/* -------------------------------------------------------------------------- */

export type AutomationKind = "lead_arrived" | "quote_sent" | "invoice_overdue";

/** Seeded in this order by drizzle/0008_automations.sql; `list()` returns it. */
export const AUTOMATION_KINDS: readonly AutomationKind[] = [
  "lead_arrived",
  "quote_sent",
  "invoice_overdue",
];

export type Automation = {
  id: string;
  kind: AutomationKind;
  enabled: boolean;
  delayMinutes: number;
  titleTemplate: string;
  createdAt: string;
  updatedAt: string;
};

const AUTOMATION_COLS: readonly Col<Automation>[] = [
  ["id", "a.id", "text"],
  ["kind", "a.kind", "text"],
  ["enabled", "a.enabled", "bool"],
  ["delayMinutes", "a.delay_minutes", "int"],
  ["titleTemplate", "a.title_template", "text"],
  ["createdAt", "a.created_at", "text"],
  ["updatedAt", "a.updated_at", "text"],
] as const;

/** Always the three rules, in AUTOMATION_KINDS order - Settings lists them once. */
export async function list(): Promise<Automation[]> {
  const rows = await raw.query(`SELECT ${selectList(AUTOMATION_COLS, "a")} FROM automations a`);
  const byKind = new Map(
    mapRows(AUTOMATION_COLS, rows).map((a) => [a.kind, a] as const),
  );
  return AUTOMATION_KINDS.map((kind) => {
    const found = byKind.get(kind);
    if (!found) throw new NotFoundError("automation", kind);
    return found;
  });
}

export async function get(kind: AutomationKind): Promise<Automation | null> {
  const rows = await raw.query(
    `SELECT ${selectList(AUTOMATION_COLS, "a")} FROM automations a WHERE a.kind = ?`,
    [kind],
  );
  return rows.length > 0 ? mapRows(AUTOMATION_COLS, rows)[0] : null;
}

export type AutomationPatch = {
  enabled?: boolean;
  delayMinutes?: number;
  titleTemplate?: string;
};

export const automationPatchSchema: z.ZodType<AutomationPatch> = z.object({
  enabled: z.boolean().optional(),
  delayMinutes: z
    .number()
    .int("A delay is a whole number of minutes.")
    .min(0, "A delay cannot be negative.")
    .max(525_600, "A delay cannot be longer than a year.")
    .optional(),
  titleTemplate: z
    .string()
    .min(1, "A follow-up needs a title, in plain words.")
    .optional(),
});

export async function update(
  kind: AutomationKind,
  patch: AutomationPatch,
  options: { batchId?: string } = {},
): Promise<Automation> {
  const parsed = parseOrThrow(automationPatchSchema, patch);
  return withWrite(async () => {
    const before = await get(kind);
    if (!before) throw new NotFoundError("automation", kind);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (parsed.enabled !== undefined) values.enabled = parsed.enabled;
    if (parsed.delayMinutes !== undefined) values.delayMinutes = parsed.delayMinutes;
    if (parsed.titleTemplate !== undefined) values.titleTemplate = parsed.titleTemplate;
    const stmt = updateStatement("automations", before.id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("automation", before.id, "update", before, values, options.batchId);
    const after = await get(kind);
    if (!after) throw new NotFoundError("automation", kind);
    return after;
  }, "Saving an automation");
}

/* -------------------------------------------------------------------------- */
/* template rendering and phrasing                                           */
/* -------------------------------------------------------------------------- */

export type TemplateTokens = {
  name?: string | null;
  number?: string | null;
  job?: string | null;
};

const TOKEN_RE = /\{(name|number|job)\}/g;

/**
 * An automation title is the one string in the product assembled from the
 * owner's template and somebody else's data, and it does not stay on screen:
 * it becomes a task title, which the Schedule exports into a .ics `SUMMARY`
 * and the export writes into a CSV cell.
 *
 * `{name}` on the speed-to-lead rule comes from a public web form. That path
 * is already bounded and stripped in Rust (`leads::enforce_bounds`), but it is
 * not the only one: a contact imported from a CSV reaches the same token with
 * nothing stripped at all, and `{job}` is a deal title that can be as long as
 * the importer made it. So the guard belongs here, at the point the tokens are
 * substituted, rather than on whichever upstream happened to be hardened first.
 */
const MAX_TITLE_LEN = 200;

/**
 * True for a NUL or a bidi override/embedding character (U+200E, U+200F,
 * U+202A-U+202E, U+2066-U+2069), or any other C0 control except tab. A
 * right-to-left override in a task title reads one way in the list and another
 * in the calendar entry the owner exports, which is the whole trick. Written as
 * numeric code-point comparisons rather than a regex literal, so no invisible
 * character sits in this source file - the same reasoning, and the same code
 * points, as `sanitizeDisplayName` in `src/db/repos/attachments.ts`.
 */
function isUnsafeTitleCodePoint(codePoint: number): boolean {
  if (codePoint < 0x0020 || codePoint === 0x007f) return true;
  if (codePoint === 0x200e || codePoint === 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  return false;
}

/**
 * A control character that separates words rather than meaning nothing: tab,
 * newline, carriage return, vertical tab, form feed. These become a space
 * instead of being dropped. Dropping them glued "Call\nJane" into "CallJane",
 * which is a worse title than the one we were protecting the owner from - the
 * point of the guard is that the title reads honestly, not merely that it is
 * free of invisible characters.
 */
function isWhitespaceControl(codePoint: number): boolean {
  return codePoint === 0x0009 || (codePoint >= 0x000a && codePoint <= 0x000d);
}

/** Strip what must never reach a title, collapse whitespace, cap the length. */
export function sanitizeTitle(value: string): string {
  let out = "";
  for (const ch of value) {
    const codePoint = ch.codePointAt(0) ?? 0;
    if (isWhitespaceControl(codePoint)) {
      out += " ";
      continue;
    }
    if (isUnsafeTitleCodePoint(codePoint)) continue;
    out += ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > MAX_TITLE_LEN ? `${out.slice(0, MAX_TITLE_LEN - 1).trimEnd()}…` : out;
}

/** {name} {number} {job}. Unknown tokens are left alone; a null/empty value renders as "". */
export function renderTemplate(template: string, tokens: TemplateTokens): string {
  const substituted = template.replace(TOKEN_RE, (_match, key: keyof TemplateTokens) => {
    const value = tokens[key];
    return value ? String(value) : "";
  });
  return sanitizeTitle(substituted);
}

/**
 * "now" / "in 45 minutes" / "in 1 hour" / "in 3 hours" / "in 1 day" / "in 3
 * days" - the one place a delay becomes words, so every activity line reads
 * the same way regardless of which rule wrote it.
 */
export function dueInPhrase(delayMinutes: number): string {
  if (delayMinutes <= 0) return "now";
  if (delayMinutes < 60) {
    return `in ${delayMinutes} minute${delayMinutes === 1 ? "" : "s"}`;
  }
  if (delayMinutes < 1440) {
    const hours = Math.round(delayMinutes / 60);
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(delayMinutes / 1440);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/* -------------------------------------------------------------------------- */
/* firing a rule                                                              */
/* -------------------------------------------------------------------------- */

export type AutomationResult = { statements: Statement[]; taskId: string | null };

/**
 * How every automation's timeline entry opens.
 *
 * Exported for the same reason `LEAD_UPDATE_INTRO` is
 * (src/features/leads/lib/leadMapping.ts): a test that needs to tell "the line
 * a rule wrote" from "the line the owner's own work wrote" must not re-type
 * the sentence and quietly stop matching when the wording is improved.
 *
 * The parenthesis is F-CS-R-7, reconfirmed still open by LR-LA-W1 and closed
 * here. Two of these rules ship on, so the owner most likely to read this line
 * is one who found a task on Today that he is certain he did not write. The
 * line already answered "who" and "why"; it did not answer the question that
 * actually follows, which is "where do I stop it" - and a line in a timeline
 * is the one place he is looking at the moment he wants to know. Naming the
 * screen here costs four words and saves a search through Settings.
 */
export const FOLLOW_UP_INTRO = "Helix added a follow-up (Settings, then Automations):";

function computeDue(now: string, delayMinutes: number): { dueOn: string; dueAt: string } {
  const at = new Date(new Date(now).getTime() + delayMinutes * 60_000);
  return { dueAt: toIso(at), dueOn: toLocalDateString(at) };
}

type FireInput = {
  /** The automation_runs.kind value: one of AUTOMATION_KINDS, or "stage". */
  ledgerKind: string;
  subjectId: string;
  enabled: boolean;
  delayMinutes: number;
  titleTemplate: string;
  tokens: TemplateTokens;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  /** The clause after "because": "a new lead arrived", "the quote was sent". */
  reason: string;
  now: string;
  batchId?: string;
};

/**
 * The one place every runner below plans its work: check the rule is live,
 * check it has not already fired for this subject, then build the task, its
 * timeline entry and the ledger row as statements for the caller's batch.
 * Never touches the write lock itself (see the module doc comment).
 */
async function fire(input: FireInput): Promise<AutomationResult> {
  if (!input.enabled) return { statements: [], taskId: null };

  const title = renderTemplate(input.titleTemplate, input.tokens).trim();
  if (title.length === 0) return { statements: [], taskId: null };

  const already = await raw.query(
    `SELECT 1 FROM automation_runs WHERE kind = ? AND subject_id = ?`,
    [input.ledgerKind, input.subjectId],
  );
  if (already.length > 0) return { statements: [], taskId: null };

  const due = computeDue(input.now, input.delayMinutes);
  const stamps = stampNew();
  const taskRow = {
    ...stamps,
    title,
    dueOn: due.dueOn,
    dueAt: due.dueAt,
    doneAt: null,
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    source: "automation" as const,
    place: null,
    durationMinutes: null,
    deletedAt: null,
  };

  const statements: Statement[] = [insertStatement("tasks", taskRow)];

  // A task with no record link has no timeline to appear on.
  if (input.contactId || input.companyId || input.dealId) {
    const body = `${FOLLOW_UP_INTRO} ${title}. Due ${dueInPhrase(
      input.delayMinutes,
    )}, because ${input.reason}.`;
    const activity = activities.systemStatement({
      body,
      contactId: input.contactId,
      companyId: input.companyId,
      dealId: input.dealId,
    });
    statements.push({ sql: activity.sql, params: activity.params });
  }

  statements.push({
    sql: `INSERT INTO automation_runs (id, kind, subject_id, task_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    params: [newId(), input.ledgerKind, input.subjectId, stamps.id, nowIso()],
  });

  statements.push(
    changeLogStatement({
      entityType: "task",
      entityId: stamps.id,
      op: "create",
      after: taskRow,
      batchId: input.batchId,
    }),
  );

  return { statements, taskId: stamps.id };
}

/* -------------------------------------------------------------------------- */
/* the runners                                                                */
/* -------------------------------------------------------------------------- */

export async function runLeadArrived(input: {
  dealId: string;
  dealTitle: string;
  contactId: string | null;
  companyId: string | null;
  customerName: string;
  now?: string;
  batchId?: string;
}): Promise<AutomationResult> {
  const rule = await get("lead_arrived");
  if (!rule) return { statements: [], taskId: null };
  return fire({
    ledgerKind: "lead_arrived",
    subjectId: input.dealId,
    enabled: rule.enabled,
    delayMinutes: rule.delayMinutes,
    titleTemplate: rule.titleTemplate,
    tokens: { name: input.customerName, job: input.dealTitle },
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    reason: "a new lead arrived",
    now: input.now ?? nowIso(),
    batchId: input.batchId,
  });
}

export async function runQuoteSent(input: {
  documentId: string;
  number: string;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  customerName: string;
  dealTitle?: string | null;
  now?: string;
  batchId?: string;
}): Promise<AutomationResult> {
  const rule = await get("quote_sent");
  if (!rule) return { statements: [], taskId: null };
  return fire({
    ledgerKind: "quote_sent",
    subjectId: input.documentId,
    enabled: rule.enabled,
    delayMinutes: rule.delayMinutes,
    titleTemplate: rule.titleTemplate,
    tokens: { name: input.customerName, number: input.number, job: input.dealTitle ?? null },
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    reason: "the quote was sent",
    now: input.now ?? nowIso(),
    batchId: input.batchId,
  });
}

export async function runStageEntered(input: {
  dealId: string;
  dealTitle: string;
  contactId: string | null;
  companyId: string | null;
  customerName: string;
  stageId: string;
  stageName: string;
  followUpDays: number | null;
  followUpTitle: string | null;
  enteredAt: string;
  now?: string;
  batchId?: string;
}): Promise<AutomationResult> {
  const titleTemplate = (input.followUpTitle ?? "").trim();
  if (input.followUpDays === null || input.followUpDays <= 0 || titleTemplate.length === 0) {
    return { statements: [], taskId: null };
  }
  const day = input.enteredAt.slice(0, 10);
  return fire({
    // A stage rule is not one of the three switchable automations, so its
    // ledger rows carry the literal kind "stage" rather than an
    // AutomationKind - it has no row of its own in the `automations` table.
    ledgerKind: "stage",
    subjectId: `${input.dealId}:${input.stageId}:${day}`,
    enabled: true,
    delayMinutes: input.followUpDays * 1440,
    titleTemplate,
    tokens: { name: input.customerName, job: input.dealTitle },
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    reason: `this job moved to ${input.stageName}`,
    now: input.now ?? nowIso(),
    batchId: input.batchId,
  });
}

export async function runInvoiceOverdue(input: {
  documentId: string;
  number: string;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  customerName: string;
  today: string;
  now?: string;
  batchId?: string;
}): Promise<AutomationResult> {
  const rule = await get("invoice_overdue");
  if (!rule) return { statements: [], taskId: null };
  return fire({
    ledgerKind: "invoice_overdue",
    subjectId: `${input.documentId}:${input.today}`,
    enabled: rule.enabled,
    delayMinutes: rule.delayMinutes,
    titleTemplate: rule.titleTemplate,
    tokens: { name: input.customerName, number: input.number },
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    reason: "the invoice is overdue",
    now: input.now ?? nowIso(),
    batchId: input.batchId,
  });
}

/* -------------------------------------------------------------------------- */
/* the daily sweep                                                            */
/* -------------------------------------------------------------------------- */

function customerNameFor(doc: {
  contactFirstName: string | null;
  contactLastName: string | null;
  companyName: string | null;
}): string {
  const name = `${doc.contactFirstName ?? ""} ${doc.contactLastName ?? ""}`.trim();
  return name.length > 0 ? name : (doc.companyName ?? "");
}

/**
 * The daily overdue sweep: every invoice that is sent or partial (never
 * draft or void) with a due date before today gets one attempt at
 * `runInvoiceOverdue`. Unlike every runner above, this one has no caller's
 * transaction to run inside, so it opens its own. Safe to call repeatedly on
 * the same day - the pre-check plus the unique index on `automation_runs`
 * both say so - and it does nothing at all when the rule is disabled, which
 * it is by default (LR-PX-C-W1 contract).
 */
export async function automationSweep(
  options: { today?: string; now?: string } = {},
): Promise<number> {
  const rule = await get("invoice_overdue");
  if (!rule || !rule.enabled) return 0;

  const today = options.today ?? todayLocal();
  const now = options.now ?? nowIso();

  return withTransaction(async () => {
    const statements: Statement[] = [];
    let created = 0;
    let offset = 0;
    const limit = 200;

    for (;;) {
      const { rows, total } = await documents.list(
        { kind: "invoice", unpaidOnly: true },
        { limit, offset },
      );
      for (const doc of rows) {
        if (doc.status === "draft") continue;
        if (!doc.dueOn || doc.dueOn >= today) continue;
        const result = await runInvoiceOverdue({
          documentId: doc.id,
          number: doc.number,
          dealId: doc.dealId,
          contactId: doc.contactId,
          companyId: doc.companyId,
          customerName: customerNameFor(doc),
          today,
          now,
        });
        if (result.statements.length > 0) {
          statements.push(...result.statements);
          created += 1;
        }
      }
      offset += limit;
      if (rows.length === 0 || offset >= total) break;
    }

    if (statements.length > 0) {
      await raw.batch(statements);
    }
    return created;
  }, "Running the daily follow-up sweep");
}
