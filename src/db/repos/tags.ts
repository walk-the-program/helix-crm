/**
 * Tags, and the polymorphic tag_links join.
 *
 * tag_links.entity_id has no foreign key because it points at whichever of
 * contacts, companies or deals the tag was put on, so every query here filters
 * by entity_type as well. Link rows are never soft-deleted (there is no
 * deleted_at worth keeping on a join row); detach and setForEntity hard-delete
 * them. A tag itself is soft-deletable like any other entity, and purging one
 * cascades to its links through the tag_links.tag_id foreign key.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
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
  type Statement,
} from "@/db/repos/_base";

export type Tag = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newTagSchema = z.object({
  name: z.string().min(1, "A tag needs a name."),
  color: z.string().default("var(--stage-1)"),
});

export type NewTag = z.input<typeof newTagSchema>;

export type TagFilter = {
  includeDeleted?: boolean;
};

const TAG_COLS: readonly Col<Tag>[] = [
  ["id", "t.id", "text"],
  ["name", "t.name", "text"],
  ["color", "t.color", "text"],
  ["createdAt", "t.created_at", "text"],
  ["updatedAt", "t.updated_at", "text"],
  ["deletedAt", "t.deleted_at", "textNull"],
] as const;

/* -------------------------------------------------------------------------- */
/* tags: reads                                                                */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<Tag | null> {
  const rows = await raw.query(
    `SELECT ${selectList(TAG_COLS, "t")} FROM tags t WHERE t.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(TAG_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Tag> {
  const found = await get(id);
  if (!found) throw new NotFoundError("tag", id);
  return found;
}

function whereFor(filter: TagFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  if (!filter.includeDeleted) clauses.push("t.deleted_at IS NULL");
  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params: [],
  };
}

export async function list(
  filter: TagFilter = {},
  page?: Page,
): Promise<{ rows: Tag[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(TAG_COLS, "t")} FROM tags t${where.sql}
     ORDER BY t.name COLLATE NOCASE ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM tags t${where.sql}`,
    where.params,
  );
  return { rows: mapRows(TAG_COLS, rows), total };
}

/** Exact-name lookup, live rows only. */
export async function findByName(name: string): Promise<Tag | null> {
  const trimmedName = trimmed(name);
  if (trimmedName.length === 0) return null;
  const rows = await raw.query(
    `SELECT ${selectList(TAG_COLS, "t")} FROM tags t
     WHERE t.name = ? AND t.deleted_at IS NULL
     ORDER BY t.created_at ASC LIMIT 1`,
    [trimmedName],
  );
  return rows.length > 0 ? mapRows(TAG_COLS, rows)[0] : null;
}

/* -------------------------------------------------------------------------- */
/* tags: writes                                                               */
/* -------------------------------------------------------------------------- */

export async function create(
  input: NewTag,
  options: { batchId?: string } = {},
): Promise<Tag> {
  const parsed = parseOrThrow(newTagSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      name: trimmed(parsed.name),
      color: trimmed(parsed.color) || "var(--stage-1)",
      deletedAt: null,
    };
    const stmt = insertStatement("tags", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("tag", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a tag");
}

export type TagPatch = Partial<NewTag>;

export async function update(
  id: string,
  patch: TagPatch,
  options: { batchId?: string } = {},
): Promise<Tag> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.color !== undefined) values.color = trimmed(patch.color) || "var(--stage-1)";

    const stmt = updateStatement("tags", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("tag", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a tag");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("tags", "tag", id, options.batchId),
    "Deleting a tag",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("tags", "tag", id, options.batchId),
    "Restoring a tag",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("tags", "tag", id, options.batchId),
    "Purging a tag",
  );
}

/** Return the existing live tag or create it. */
export async function ensure(name: string, color?: string): Promise<Tag> {
  const existing = await findByName(name);
  if (existing) return existing;
  return create({ name, color: color ?? "var(--stage-1)" });
}

/* -------------------------------------------------------------------------- */
/* tag links: the polymorphic join                                           */
/* -------------------------------------------------------------------------- */

export type TaggedEntityType = "contact" | "company" | "deal";

async function findLiveLinkId(
  tagId: string,
  entityType: TaggedEntityType,
  entityId: string,
): Promise<string | null> {
  const rows = await raw.query(
    `SELECT tl.id AS tl_id FROM tag_links tl
     WHERE tl.tag_id = ? AND tl.entity_type = ? AND tl.entity_id = ? AND tl.deleted_at IS NULL
     LIMIT 1`,
    [tagId, entityType, entityId],
  );
  return rows.length > 0 ? String(rows[0][0]) : null;
}

/** Idempotent: does nothing when a live link already exists. */
export async function attach(
  tagId: string,
  entityType: TaggedEntityType,
  entityId: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const existingId = await findLiveLinkId(tagId, entityType, entityId);
    if (existingId) return;
    const stamps = stampNew();
    const row = { ...stamps, tagId, entityType, entityId, deletedAt: null };
    const stmt = insertStatement("tag_links", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("tag_link", stamps.id, "create", null, row, options.batchId);
  }, "Tagging");
}

/** Hard delete: link rows are not soft-deleted. */
export async function detach(
  tagId: string,
  entityType: TaggedEntityType,
  entityId: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const rows = await raw.query(
      `SELECT tl.id AS tl_id, tl.created_at AS tl_created_at, tl.updated_at AS tl_updated_at
       FROM tag_links tl
       WHERE tl.tag_id = ? AND tl.entity_type = ? AND tl.entity_id = ?`,
      [tagId, entityType, entityId],
    );
    if (rows.length === 0) return;
    await raw.execute(
      `DELETE FROM tag_links WHERE tag_id = ? AND entity_type = ? AND entity_id = ?`,
      [tagId, entityType, entityId],
    );
    // A link is hard-deleted, so undo has to re-insert it: log the whole row,
    // `id` included. Without the id, undoBatch treats the entry as a soft
    // delete and issues an UPDATE that matches nothing (docs/CONTRACTS.md, "Undo").
    for (const r of rows) {
      await logWrite(
        "tag_link",
        String(r[0]),
        "delete",
        {
          id: String(r[0]),
          tagId,
          entityType,
          entityId,
          createdAt: String(r[1]),
          updatedAt: String(r[2]),
          deletedAt: null,
        },
        null,
        options.batchId,
      );
    }
  }, "Untagging");
}

/** Every live tag on one entity, joined and aliased, ordered by name. */
export async function listForEntity(
  entityType: TaggedEntityType,
  entityId: string,
): Promise<Tag[]> {
  const rows = await raw.query(
    `SELECT ${selectList(TAG_COLS, "t")} FROM tag_links tl
     JOIN tags t ON t.id = tl.tag_id
     WHERE tl.entity_type = ? AND tl.entity_id = ?
       AND tl.deleted_at IS NULL AND t.deleted_at IS NULL
     ORDER BY t.name COLLATE NOCASE ASC`,
    [entityType, entityId],
  );
  return mapRows(TAG_COLS, rows);
}

/** Every live entity id of one type carrying a given tag. */
export async function listEntityIdsForTag(
  tagId: string,
  entityType: TaggedEntityType,
): Promise<string[]> {
  const rows = await raw.query(
    `SELECT tl.entity_id AS tl_entity_id FROM tag_links tl
     WHERE tl.tag_id = ? AND tl.entity_type = ? AND tl.deleted_at IS NULL`,
    [tagId, entityType],
  );
  return rows.map((r) => String(r[0]));
}

/** Diff the wanted tag set against the live links and apply in one batch. */
export async function setForEntity(
  entityType: TaggedEntityType,
  entityId: string,
  tagIds: string[],
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const rows = await raw.query(
      `SELECT tl.id AS tl_id, tl.tag_id AS tl_tag_id, tl.created_at AS tl_created_at,
              tl.updated_at AS tl_updated_at
       FROM tag_links tl
       WHERE tl.entity_type = ? AND tl.entity_id = ? AND tl.deleted_at IS NULL`,
      [entityType, entityId],
    );
    const existingByTagId = new Map<string, string>();
    const stampsByLinkId = new Map<string, { createdAt: string; updatedAt: string }>();
    for (const r of rows) {
      existingByTagId.set(String(r[1]), String(r[0]));
      stampsByLinkId.set(String(r[0]), { createdAt: String(r[2]), updatedAt: String(r[3]) });
    }

    const wanted = new Set(tagIds);
    const toRemove = [...existingByTagId.entries()].filter(
      ([tagId]) => !wanted.has(tagId),
    );
    const toAdd = tagIds.filter((tagId) => !existingByTagId.has(tagId));

    const statements: { sql: string; params: unknown[] }[] = [];
    const newLinks: { id: string; tagId: string }[] = [];

    for (const [, linkId] of toRemove) {
      statements.push({ sql: `DELETE FROM tag_links WHERE id = ?`, params: [linkId] });
    }
    for (const tagId of toAdd) {
      const stamps = stampNew();
      const row = { ...stamps, tagId, entityType, entityId, deletedAt: null };
      statements.push(insertStatement("tag_links", row));
      newLinks.push({ id: stamps.id, tagId });
    }

    if (statements.length > 0) await raw.batch(statements);

    // Hard delete: log the whole row with its id so undo re-inserts it
    // instead of updating a row that is gone (see detach()).
    for (const [tagId, linkId] of toRemove) {
      const stamps = stampsByLinkId.get(linkId);
      await logWrite(
        "tag_link",
        linkId,
        "delete",
        {
          id: linkId,
          tagId,
          entityType,
          entityId,
          createdAt: stamps?.createdAt ?? nowIso(),
          updatedAt: stamps?.updatedAt ?? nowIso(),
          deletedAt: null,
        },
        null,
        options.batchId,
      );
    }
    for (const added of newLinks) {
      await logWrite(
        "tag_link",
        added.id,
        "create",
        null,
        { tagId: added.tagId, entityType, entityId },
        options.batchId,
      );
    }
  }, "Setting tags");
}

/** Live tag counts for the sidebar. */
export async function counts(): Promise<{ tagId: string; count: number }[]> {
  const rows = await raw.query(
    `SELECT tl.tag_id AS tl_tag_id, count(*) AS tl_count FROM tag_links tl
     JOIN tags t ON t.id = tl.tag_id
     WHERE tl.deleted_at IS NULL AND t.deleted_at IS NULL
     GROUP BY tl.tag_id`,
  );
  return rows.map((r) => ({ tagId: String(r[0]), count: Number(r[1]) }));
}

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/data/lib/importWrite.ts. */
/* -------------------------------------------------------------------------- */

export function tagCreateStatement(name: string): { id: string; statement: Statement } {
  const s = stampNew();
  return {
    id: s.id,
    statement: insertStatement("tags", {
      ...s,
      name: name.trim(),
      color: "var(--stage-1)",
      deletedAt: null,
    }),
  };
}

export function tagLinkStatement(
  tagId: string,
  entityType: string,
  entityId: string,
): Statement {
  return insertStatement("tag_links", {
    ...stampNew(),
    tagId,
    entityType,
    entityId,
    deletedAt: null,
  });
}
