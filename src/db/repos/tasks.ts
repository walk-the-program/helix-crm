/**
 * Tasks and follow-ups.
 *
 *   [open] --check--> [done, done_at set] --uncheck--> [open]
 *   [open] --snooze--> [open, due moved]
 *
 * due_on is always set when any due date exists; due_at is an optional
 * refinement of it. Overdue is derived, never stored: due_at < now when set,
 * otherwise due_on < today. Today's buckets use due_on.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite, withTransaction } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { systemStatement } from "@/db/repos/activities";
import {
  addDaysToDateString,
  nowIso,
  todayLocal,
  toLocalDateString,
} from "@/lib/dates";
import {
  countRows,
  insertStatement,
  logWrite,
  mapRows,
  pageClause,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  updateStatement,
  parseOrThrow,
  type Col,
  type Page,
} from "@/db/repos/_base";

export type Task = {
  id: string;
  title: string;
  dueOn: string | null;
  dueAt: string | null;
  doneAt: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newTaskSchema = z.object({
  title: z.string().min(1, "A task needs a title."),
  dueOn: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
});

export type NewTask = z.input<typeof newTaskSchema>;

export type TaskFilter = {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  openOnly?: boolean;
  doneOnly?: boolean;
  dueOnOrBefore?: string;
  dueFrom?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
};

const TASK_COLS: readonly Col<Task>[] = [
  ["id", "t.id", "text"],
  ["title", "t.title", "text"],
  ["dueOn", "t.due_on", "textNull"],
  ["dueAt", "t.due_at", "textNull"],
  ["doneAt", "t.done_at", "textNull"],
  ["contactId", "t.contact_id", "textNull"],
  ["companyId", "t.company_id", "textNull"],
  ["dealId", "t.deal_id", "textNull"],
  ["createdAt", "t.created_at", "text"],
  ["updatedAt", "t.updated_at", "text"],
  ["deletedAt", "t.deleted_at", "textNull"],
] as const;

/**
 * due_on is the source of truth for the day; due_at only refines it. Given
 * either one, work out the pair that must be stored.
 */
export function normalizeDue(input: {
  dueOn?: string | null;
  dueAt?: string | null;
}): { dueOn: string | null; dueAt: string | null } {
  const dueAt = input.dueAt ?? null;
  let dueOn = input.dueOn ?? null;
  if (dueAt && !dueOn) {
    const parsed = new Date(dueAt);
    dueOn = Number.isNaN(parsed.getTime()) ? null : toLocalDateString(parsed);
  }
  if (!dueOn) return { dueOn: null, dueAt: null };
  return { dueOn, dueAt };
}

export async function get(id: string): Promise<Task | null> {
  const rows = await raw.query(
    `SELECT ${selectList(TASK_COLS, "t")} FROM tasks t WHERE t.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(TASK_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Task> {
  const found = await get(id);
  if (!found) throw new NotFoundError("task", id);
  return found;
}

function whereFor(filter: TaskFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.onlyDeleted) clauses.push("t.deleted_at IS NOT NULL");
  else if (!filter.includeDeleted) clauses.push("t.deleted_at IS NULL");

  if (filter.openOnly) clauses.push("t.done_at IS NULL");
  if (filter.doneOnly) clauses.push("t.done_at IS NOT NULL");
  if (filter.contactId) {
    clauses.push("t.contact_id = ?");
    params.push(filter.contactId);
  }
  if (filter.companyId) {
    clauses.push("t.company_id = ?");
    params.push(filter.companyId);
  }
  if (filter.dealId) {
    clauses.push("t.deal_id = ?");
    params.push(filter.dealId);
  }
  if (filter.dueOnOrBefore) {
    clauses.push("t.due_on IS NOT NULL AND t.due_on <= ?");
    params.push(filter.dueOnOrBefore);
  }
  if (filter.dueFrom) {
    clauses.push("t.due_on IS NOT NULL AND t.due_on >= ?");
    params.push(filter.dueFrom);
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function list(
  filter: TaskFilter = {},
  page?: Page,
): Promise<{ rows: Task[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(TASK_COLS, "t")} FROM tasks t${where.sql}
     ORDER BY (t.due_on IS NULL) ASC, t.due_on ASC, t.due_at ASC, t.created_at ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM tasks t${where.sql}`,
    where.params,
  );
  return { rows: mapRows(TASK_COLS, rows), total };
}

/** Today's three buckets: overdue rises to the top. */
export async function today(
  reference: string = todayLocal(),
): Promise<{ overdue: Task[]; today: Task[]; next7: Task[] }> {
  const in7 = addDaysToDateString(reference, 7);
  const { rows } = await list(
    { openOnly: true, dueOnOrBefore: in7 },
    { limit: 500 },
  );
  return {
    overdue: rows.filter((t) => t.dueOn !== null && t.dueOn < reference),
    today: rows.filter((t) => t.dueOn === reference),
    next7: rows.filter((t) => t.dueOn !== null && t.dueOn > reference),
  };
}

/**
 * The timeline entry a task write leaves behind.
 *
 * Round 3, criterion 26: the timeline is the record's full history, and every
 * repository write that changes one of those things writes its system entry in
 * the SAME transaction - so a task can never exist without its "Task added"
 * line, and a crash between the two is not a state the database can reach.
 *
 * A task linked to nothing has no timeline to appear on, so it writes nothing
 * rather than an orphan entry.
 */
async function writeTimelineEntry(
  link: { contactId: string | null; companyId: string | null; dealId: string | null },
  body: string,
  occurredAt?: string,
): Promise<void> {
  if (!link.contactId && !link.companyId && !link.dealId) return;
  const entry = systemStatement({
    body,
    contactId: link.contactId,
    companyId: link.companyId,
    dealId: link.dealId,
    ...(occurredAt ? { occurredAt } : {}),
  });
  await raw.execute(entry.sql, entry.params);
}

export async function create(
  input: NewTask,
  options: { batchId?: string } = {},
): Promise<Task> {
  const parsed = parseOrThrow(newTaskSchema, input);
  return withTransaction(async () => {
    const due = normalizeDue(parsed);
    const stamps = stampNew();
    const row = {
      ...stamps,
      title: trimmed(parsed.title),
      dueOn: due.dueOn,
      dueAt: due.dueAt,
      doneAt: null,
      contactId: parsed.contactId ?? null,
      companyId: parsed.companyId ?? null,
      dealId: parsed.dealId ?? null,
      deletedAt: null,
    };
    const stmt = insertStatement("tasks", row);
    await raw.execute(stmt.sql, stmt.params);
    await writeTimelineEntry(row, `Task added: ${row.title}`);
    await logWrite("task", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a task");
}

export type TaskPatch = Partial<NewTask>;

export async function update(
  id: string,
  patch: TaskPatch,
  options: { batchId?: string } = {},
): Promise<Task> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.title !== undefined) values.title = trimmed(patch.title);
    if (patch.dueOn !== undefined || patch.dueAt !== undefined) {
      const due = normalizeDue({
        dueOn: patch.dueOn !== undefined ? patch.dueOn : before.dueOn,
        dueAt: patch.dueAt !== undefined ? patch.dueAt : before.dueAt,
      });
      values.dueOn = due.dueOn;
      values.dueAt = due.dueAt;
    }
    if (patch.contactId !== undefined) values.contactId = patch.contactId ?? null;
    if (patch.companyId !== undefined) values.companyId = patch.companyId ?? null;
    if (patch.dealId !== undefined) values.dealId = patch.dealId ?? null;

    const stmt = updateStatement("tasks", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("task", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a task");
}

export async function complete(
  id: string,
  options: { batchId?: string; at?: string } = {},
): Promise<Task> {
  return withTransaction(async () => {
    const before = await getOrThrow(id);
    const at = options.at ?? nowIso();
    const stmt = updateStatement("tasks", id, { doneAt: at, updatedAt: at });
    await raw.execute(stmt.sql, stmt.params);
    await writeTimelineEntry(before, `Task done: ${before.title}`, at);
    await logWrite(
      "task",
      id,
      "update",
      before,
      { doneAt: at },
      options.batchId,
    );
    return getOrThrow(id);
  }, "Completing a task");
}

export async function uncomplete(
  id: string,
  options: { batchId?: string } = {},
): Promise<Task> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const at = nowIso();
    const stmt = updateStatement("tasks", id, { doneAt: null, updatedAt: at });
    await raw.execute(stmt.sql, stmt.params);
    await logWrite(
      "task",
      id,
      "update",
      before,
      { doneAt: null },
      options.batchId,
    );
    return getOrThrow(id);
  }, "Reopening a task");
}

/**
 * Snooze to tomorrow or next week, counted from today rather than from the
 * old due date: a task three weeks overdue snoozed "to tomorrow" means
 * tomorrow, not three weeks ago plus a day.
 */
export async function snooze(
  id: string,
  when: "tomorrow" | "next-week" | { days: number },
  options: { batchId?: string; from?: string } = {},
): Promise<Task> {
  const base = options.from ?? todayLocal();
  const days =
    when === "tomorrow" ? 1 : when === "next-week" ? 7 : Math.trunc(when.days);
  const dueOn = addDaysToDateString(base, days);
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const at = nowIso();
    const stmt = updateStatement("tasks", id, {
      dueOn,
      dueAt: null,
      updatedAt: at,
    });
    await raw.execute(stmt.sql, stmt.params);
    await logWrite(
      "task",
      id,
      "update",
      before,
      { dueOn, dueAt: null },
      options.batchId,
    );
    return getOrThrow(id);
  }, "Snoozing a task");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("tasks", "task", id, options.batchId),
    "Deleting a task",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("tasks", "task", id, options.batchId),
    "Restoring a task",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("tasks", "task", id, options.batchId),
    "Purging a task",
  );
}

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/today/lib/todayData.ts.             */
/* -------------------------------------------------------------------------- */

/**
 * Who a task is about, and how to reach them.
 *
 * `tasks.today()` gives the three buckets but only foreign keys, and DESIGN.md
 * is explicit that a Today row without the customer's name and a direct action
 * does not belong on Today. One query for the whole list, keyed by task id.
 * Absent from the map means a standalone task with no record attached, which
 * is legitimate ("Order sod").
 */
export type TaskLink = {
  label: string;
  href: string;
  /** The primary phone of whoever the task is about, if there is one. */
  phone: string | null;
  email: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
};

export async function taskLinks(
  taskIds: string[],
): Promise<Map<string, TaskLink>> {
  const out = new Map<string, TaskLink>();
  if (taskIds.length === 0) return out;

  const chunkSize = 400;
  for (let i = 0; i < taskIds.length; i += chunkSize) {
    const chunk = taskIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await raw.query(
      `SELECT t.id         AS t_id,
              t.deal_id    AS t_deal_id,
              d.title      AS d_title,
              t.contact_id AS t_contact_id,
              c.first_name AS c_first_name,
              c.last_name  AS c_last_name,
              t.company_id AS t_company_id,
              co.name      AS co_name,
              (SELECT p.raw FROM contact_phones p
                WHERE p.contact_id = coalesce(t.contact_id, d.contact_id)
                ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS t_phone,
              (SELECT e.email_lower FROM contact_emails e
                WHERE e.contact_id = coalesce(t.contact_id, d.contact_id)
                ORDER BY e.is_primary DESC, e.created_at ASC LIMIT 1) AS t_email,
              d.contact_id AS d_contact_id
       FROM tasks t
       LEFT JOIN deals d ON d.id = t.deal_id AND d.deleted_at IS NULL
       LEFT JOIN contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
       LEFT JOIN companies co ON co.id = t.company_id AND co.deleted_at IS NULL
       WHERE t.id IN (${placeholders})`,
      chunk,
    );

    for (const r of rows) {
      const taskId = String(r[0]);
      const dealId = r[1] === null || r[1] === undefined ? null : String(r[1]);
      const dealTitle = r[2] === null || r[2] === undefined ? null : String(r[2]);
      const contactId = r[3] === null || r[3] === undefined ? null : String(r[3]);
      const first = r[4] === null || r[4] === undefined ? "" : String(r[4]);
      const last = r[5] === null || r[5] === undefined ? "" : String(r[5]);
      const companyId = r[6] === null || r[6] === undefined ? null : String(r[6]);
      const companyName = r[7] === null || r[7] === undefined ? null : String(r[7]);
      const phone = r[8] === null || r[8] === undefined ? null : String(r[8]);
      const email = r[9] === null || r[9] === undefined ? null : String(r[9]);
      const dealContactId = r[10] === null || r[10] === undefined ? null : String(r[10]);

      const contactName = `${first} ${last}`.trim();
      let label: string | null = null;
      let href: string | null = null;
      if (contactId && contactName) {
        label = contactName;
        href = `/contacts/${contactId}`;
      } else if (companyId && companyName) {
        label = companyName;
        href = `/companies/${companyId}`;
      } else if (dealId && dealTitle) {
        label = dealTitle;
        href = `/deals/${dealId}`;
      }
      if (!label || !href) continue;

      out.set(taskId, {
        label,
        href,
        phone,
        email,
        contactId: contactId ?? dealContactId,
        companyId,
        dealId,
      });
    }
  }
  return out;
}
