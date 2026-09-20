/**
 * Message templates: the four or five things the owner types every week.
 *
 * A template is stored with its merge fields intact ({{first_name}}) and is
 * rendered at send time by `src/features/templates/lib/merge.ts`. That split is
 * deliberate: the row is the wording, not a rendered message, so editing a
 * template never rewrites history and the same body serves every customer.
 *
 * `kind` is 'text' or 'email'. A text template has no subject, and the
 * repository nulls one out rather than storing a subject nobody can send.
 *
 * Deleting is a soft delete, so it can be undone from the toast. Templates are
 * now listed in Trash (`TrashEntityType` in `src/db/repos/trash.ts`), so a
 * deleted template is purged like anything else after 30 days - which is why
 * the first-use seed's guard below is a settings key rather than a row count:
 * a purged table looks exactly like a fresh workspace to a `count(*)`.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { changeLogStatement } from "@/db/changeLog";
import { nowIso } from "@/lib/dates";
import * as settingsRepo from "@/db/repos/settings";
import {
  countRows,
  insertStatement,
  logWrite,
  mapRows,
  parseOrThrow,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  trimmedOrNull,
  updateStatement,
  type Col,
  type Statement,
} from "@/db/repos/_base";

export const TEMPLATE_KINDS = ["text", "email"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type Template = {
  id: string;
  kind: TemplateKind;
  name: string;
  subject: string | null;
  body: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newTemplateSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS),
  // Trimmed before the length check, so a name of spaces is refused rather
  // than stored as an empty string.
  name: z.string().trim().min(1, "Give the template a name you will recognise."),
  subject: z.string().nullable().optional(),
  body: z.string().trim().min(1, "A template needs something to say."),
  position: z.number().optional(),
});

export type NewTemplate = z.input<typeof newTemplateSchema>;

const TEMPLATE_COLS: readonly Col<Template>[] = [
  ["id", "t.id", "text"],
  ["kind", "t.kind", "text"],
  ["name", "t.name", "text"],
  ["subject", "t.subject", "textNull"],
  ["body", "t.body", "text"],
  ["position", "t.position", "int"],
  ["createdAt", "t.created_at", "text"],
  ["updatedAt", "t.updated_at", "text"],
  ["deletedAt", "t.deleted_at", "textNull"],
] as const;

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<Template | null> {
  const rows = await raw.query(
    `SELECT ${selectList(TEMPLATE_COLS, "t")} FROM templates t WHERE t.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(TEMPLATE_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Template> {
  const found = await get(id);
  if (!found) throw new NotFoundError("template", id);
  return found;
}

/** Live templates in the owner's own order, optionally one kind only. */
export async function list(
  filter: { kind?: TemplateKind; includeDeleted?: boolean } = {},
): Promise<Template[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!filter.includeDeleted) clauses.push("t.deleted_at IS NULL");
  if (filter.kind) {
    clauses.push("t.kind = ?");
    params.push(filter.kind);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = await raw.query(
    `SELECT ${selectList(TEMPLATE_COLS, "t")} FROM templates t${where}
     ORDER BY t.position ASC, t.created_at ASC`,
    params,
  );
  return mapRows(TEMPLATE_COLS, rows);
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

async function nextPosition(): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(max(t.position), -1) AS max_position FROM templates t WHERE t.deleted_at IS NULL`,
  );
  return rows.length > 0 ? Number(rows[0][0]) + 1 : 0;
}

export async function create(
  input: NewTemplate,
  options: { batchId?: string } = {},
): Promise<Template> {
  const parsed = parseOrThrow(newTemplateSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      kind: parsed.kind,
      name: trimmed(parsed.name),
      // A text message has no subject line to send, so it never keeps one.
      subject: parsed.kind === "email" ? trimmedOrNull(parsed.subject) : null,
      body: parsed.body,
      position: parsed.position ?? (await nextPosition()),
      deletedAt: null,
    };
    const stmt = insertStatement("templates", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("template", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a template");
}

export type TemplatePatch = Partial<
  Pick<NewTemplate, "kind" | "name" | "subject" | "body" | "position">
>;

export async function update(
  id: string,
  patch: TemplatePatch,
  options: { batchId?: string } = {},
): Promise<Template> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const kind = patch.kind ?? before.kind;
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.body !== undefined) values.body = patch.body;
    if (patch.position !== undefined) values.position = patch.position;
    if (patch.subject !== undefined || patch.kind !== undefined) {
      const subject = patch.subject !== undefined ? patch.subject : before.subject;
      values.subject = kind === "email" ? trimmedOrNull(subject) : null;
    }

    const stmt = updateStatement("templates", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("template", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a template");
}

/** Rewrite positions 0,1,2... in the given order, in one batch. */
export async function reorder(
  orderedIds: string[],
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    const statements = orderedIds.map((id, index) =>
      updateStatement("templates", id, { position: index, updatedAt: at }),
    );
    if (statements.length > 0) await raw.batch(statements);
    for (const [index, id] of orderedIds.entries()) {
      await logWrite("template", id, "update", null, { position: index }, options.batchId);
    }
  }, "Reordering templates");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("templates", "template", id, options.batchId),
    "Deleting a template",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("templates", "template", id, options.batchId),
    "Restoring a template",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("templates", "template", id, options.batchId),
    "Purging a template",
  );
}

/* -------------------------------------------------------------------------- */
/* the four starters                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What a new workspace starts with: two texts and two emails, in the owner's
 * voice, with the merge fields already in place so the first thing he sees is
 * what a template is for.
 *
 * They are ordinary rows. He can rewrite every word of them, reorder them or
 * delete them, and nothing puts them back.
 */
export const STARTER_TEMPLATES: readonly NewTemplate[] = [
  {
    kind: "text",
    name: "Quote follow-up",
    body:
      "Hi {{first_name}}, this is {{owner_name}} at {{business_name}}. " +
      "I sent the quote for {{deal_title}} over at {{deal_value}}. " +
      "Any questions, or would you like me to get you on the schedule?",
    position: 0,
  },
  {
    kind: "text",
    name: "Running late",
    body:
      "Hi {{first_name}}, {{owner_name}} here. I am running about 20 minutes " +
      "behind on my way to you. Sorry about that. I will text when I am close.",
    position: 1,
  },
  {
    kind: "email",
    name: "Quote sent",
    subject: "Your quote from {{business_name}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Thanks for having me out. The quote for {{deal_title}} comes to " +
      "{{deal_value}}, and that covers the work we talked through.\n\n" +
      "The price holds for 30 days. Reply to this email or call me and I will " +
      "get you booked in.\n\n" +
      "{{owner_name}}\n{{business_name}}",
    position: 2,
  },
  {
    kind: "email",
    name: "Thank you",
    subject: "Thank you from {{business_name}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Thanks for the work at {{company}}. It was good to meet you, and I am " +
      "glad about how it turned out.\n\n" +
      "If anything looks wrong, call me and I will come back out. And if you " +
      "know somebody who needs the same job doing, I would be grateful for the " +
      "introduction.\n\n" +
      "{{owner_name}}\n{{business_name}}",
    position: 3,
  },
] as const;

/** The workspace-settings key that records "the starter seed has run". */
const TEMPLATES_SEEDED_KEY = "templates.seededAt";

/**
 * The settings upsert as a statement, so the key can be written inside the same
 * `withWrite` as the starter inserts.
 *
 * `settings.setRaw` cannot be called from in here: it takes the write lock, and
 * the write lock does not reenter. `settingStatement` is the repository's own
 * upsert built as a statement for exactly this, and it is what the onboarding
 * apply uses too.
 */
function templatesSeededStatement(at: string): Statement {
  return settingsRepo.settingStatement(TEMPLATES_SEEDED_KEY, at);
}

/**
 * Seed the four starters the first time the workspace needs templates.
 *
 * The guard is the `templates.seededAt` setting, not a row count: Trash now
 * purges templates after 30 days, and once every starter can be purged a
 * `count(*)` guard would see an empty table and put them all back. The key is
 * written in the same batch as the starter inserts, which is also what keeps
 * this safe to call from a query function - a contact page mounts two
 * template pickers, text and email, that load at the same time, and the read
 * of the key plus the inserts happen inside ONE `withWrite` so the workspace
 * cannot end up with eight starters. That is also why this does not call
 * `create()` in a loop - the write lock does not reenter.
 *
 * Migration: a workspace that ran the old row-count guard before this key
 * existed may already have the four starters (or their soft-deleted remains)
 * with no key to show for it. Naively keying off the setting alone would seed
 * four MORE for every such workspace, so the honest test is "the key is set,
 * OR the table has ever held a row" - and the second half of that only needs
 * to be checked once: the first time this runs with no key present, a
 * non-empty table is treated as prior evidence of a seed, and the key is
 * written immediately (with no inserts) so every later call answers from the
 * key alone, including after the table is fully purged.
 */
export async function ensureStarters(): Promise<number> {
  return withWrite(async () => {
    const seededAt = await settingsRepo.getRaw(TEMPLATES_SEEDED_KEY);
    if (typeof seededAt === "string" && seededAt.length > 0) return 0;

    const at = nowIso();
    const existing = await countRows(`SELECT count(*) AS total FROM templates`);
    if (existing > 0) {
      // A pre-existing workspace from before this key existed. Record the
      // key so future calls never need to ask the row-count question again,
      // but seed nothing - the row count already established it.
      const stmt = templatesSeededStatement(at);
      await raw.execute(stmt.sql, stmt.params);
      return 0;
    }

    const statements: Statement[] = [];
    for (const starter of STARTER_TEMPLATES) {
      const parsed = parseOrThrow(newTemplateSchema, starter);
      const stamps = stampNew();
      const row = {
        ...stamps,
        kind: parsed.kind,
        name: trimmed(parsed.name),
        subject: parsed.kind === "email" ? trimmedOrNull(parsed.subject) : null,
        body: parsed.body,
        position: parsed.position ?? 0,
        deletedAt: null,
      };
      statements.push(insertStatement("templates", row));
      statements.push(
        changeLogStatement({
          entityType: "template",
          entityId: stamps.id,
          op: "create",
          after: row,
        }),
      );
    }
    statements.push(templatesSeededStatement(at));

    await raw.batch(statements);
    return STARTER_TEMPLATES.length;
  }, "Setting up your templates");
}
