/**
 * Custom fields and their per-entity values.
 *
 * A custom field is defined once per entity_type (contact, company, deal, ...)
 * and ordered by position. Values are one row per (field, entity) pair, keyed
 * loosely by entity_id (no foreign key, since it points at whichever table the
 * field's entity_type names) and are hard-deleted: softDeleteRow/restoreRow do
 * not apply to them, and an entity purge already removes its values by
 * entity_id (see _base.ts purgeRow). A field purge cascades its values through
 * the custom_values.field_id foreign key.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import {
  insertStatement,
  logWrite,
  mapRow,
  mapRows,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  updateStatement,
  parseOrThrow,
  type Col,
  type Statement,
} from "@/db/repos/_base";

/* -------------------------------------------------------------------------- */
/* custom fields                                                              */
/* -------------------------------------------------------------------------- */

export const customFieldKindSchema = z.enum(["text", "number", "date", "choice"]);
export type CustomFieldKind = z.infer<typeof customFieldKindSchema>;

export type CustomField = {
  id: string;
  entityType: string;
  name: string;
  kind: CustomFieldKind;
  optionsJson: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newCustomFieldSchema = z.object({
  entityType: z.string().min(1, "A custom field needs an entity type."),
  name: z.string().min(1, "A custom field needs a name."),
  kind: customFieldKindSchema,
  optionsJson: z.string().nullable().optional(),
  position: z.number().optional(),
});

export type NewCustomField = z.input<typeof newCustomFieldSchema>;

const CUSTOM_FIELD_COLS: readonly Col<CustomField>[] = [
  ["id", "cf.id", "text"],
  ["entityType", "cf.entity_type", "text"],
  ["name", "cf.name", "text"],
  ["kind", "cf.kind", "text"],
  ["optionsJson", "cf.options_json", "textNull"],
  ["position", "cf.position", "int"],
  ["createdAt", "cf.created_at", "text"],
  ["updatedAt", "cf.updated_at", "text"],
  ["deletedAt", "cf.deleted_at", "textNull"],
] as const;

function toCustomField(row: unknown[]): CustomField {
  const mapped = mapRow(CUSTOM_FIELD_COLS, row);
  return { ...mapped, kind: customFieldKindSchema.parse(mapped.kind) };
}

export async function get(id: string): Promise<CustomField | null> {
  const rows = await raw.query(
    `SELECT ${selectList(CUSTOM_FIELD_COLS, "cf")} FROM custom_fields cf WHERE cf.id = ?`,
    [id],
  );
  return rows.length > 0 ? toCustomField(rows[0]) : null;
}

export async function getOrThrow(id: string): Promise<CustomField> {
  const found = await get(id);
  if (!found) throw new NotFoundError("custom_field", id);
  return found;
}

/** Live fields, optionally scoped to one entity type, ordered by position. */
export async function list(entityType?: string): Promise<CustomField[]> {
  const clauses = ["cf.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (entityType) {
    clauses.push("cf.entity_type = ?");
    params.push(entityType);
  }
  const rows = await raw.query(
    `SELECT ${selectList(CUSTOM_FIELD_COLS, "cf")} FROM custom_fields cf
     WHERE ${clauses.join(" AND ")}
     ORDER BY cf.position ASC`,
    params,
  );
  return rows.map(toCustomField);
}

export async function create(
  input: NewCustomField,
  options: { batchId?: string } = {},
): Promise<CustomField> {
  const parsed = parseOrThrow(newCustomFieldSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      entityType: trimmed(parsed.entityType),
      name: trimmed(parsed.name),
      kind: parsed.kind,
      optionsJson: parsed.optionsJson ?? null,
      position: parsed.position ?? 0,
      deletedAt: null,
    };
    const stmt = insertStatement("custom_fields", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("custom_field", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a custom field");
}

export type CustomFieldPatch = Partial<
  Pick<NewCustomField, "name" | "kind" | "optionsJson" | "position">
>;

export async function update(
  id: string,
  patch: CustomFieldPatch,
  options: { batchId?: string } = {},
): Promise<CustomField> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.optionsJson !== undefined) values.optionsJson = patch.optionsJson ?? null;
    if (patch.position !== undefined) values.position = patch.position;

    const stmt = updateStatement("custom_fields", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("custom_field", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a custom field");
}

/** Rewrite positions 0,1,2... in the given order, in one batch. */
export async function reorder(
  orderedIds: string[],
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    const statements = orderedIds.map((id, index) =>
      updateStatement("custom_fields", id, { position: index, updatedAt: at }),
    );
    if (statements.length > 0) await raw.batch(statements);
    for (const [index, id] of orderedIds.entries()) {
      await logWrite("custom_field", id, "update", null, { position: index }, options.batchId);
    }
  }, "Reordering custom fields");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("custom_fields", "custom_field", id, options.batchId),
    "Deleting a custom field",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("custom_fields", "custom_field", id, options.batchId),
    "Restoring a custom field",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("custom_fields", "custom_field", id, options.batchId),
    "Purging a custom field",
  );
}

/* -------------------------------------------------------------------------- */
/* custom values                                                              */
/* -------------------------------------------------------------------------- */

export type CustomValue = {
  id: string;
  fieldId: string;
  entityId: string;
  valueText: string | null;
  valueNum: number | null;
  valueDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CustomValueWithField = CustomValue & {
  fieldName: string;
  fieldKind: string;
};

const CUSTOM_VALUE_COLS: readonly Col<CustomValue>[] = [
  ["id", "cv.id", "text"],
  ["fieldId", "cv.field_id", "text"],
  ["entityId", "cv.entity_id", "text"],
  ["valueText", "cv.value_text", "textNull"],
  ["valueNum", "cv.value_num", "intNull"],
  ["valueDate", "cv.value_date", "textNull"],
  ["createdAt", "cv.created_at", "text"],
  ["updatedAt", "cv.updated_at", "text"],
  ["deletedAt", "cv.deleted_at", "textNull"],
] as const;

/** Every live value on one entity, joined to its field, ordered by field position. */
export async function listValues(entityId: string): Promise<CustomValueWithField[]> {
  const rows = await raw.query(
    `SELECT ${selectList(CUSTOM_VALUE_COLS, "cv")}, cf.name AS field_name, cf.kind AS field_kind
     FROM custom_values cv
     JOIN custom_fields cf ON cf.id = cv.field_id
     WHERE cv.entity_id = ? AND cv.deleted_at IS NULL AND cf.deleted_at IS NULL
     ORDER BY cf.position ASC`,
    [entityId],
  );
  return rows.map((r) => {
    const base = mapRow(CUSTOM_VALUE_COLS, r);
    return {
      ...base,
      fieldName: String(r[CUSTOM_VALUE_COLS.length] ?? ""),
      fieldKind: String(r[CUSTOM_VALUE_COLS.length + 1] ?? ""),
    };
  });
}

async function findValueRow(fieldId: string, entityId: string): Promise<CustomValue | null> {
  const rows = await raw.query(
    `SELECT ${selectList(CUSTOM_VALUE_COLS, "cv")} FROM custom_values cv
     WHERE cv.field_id = ? AND cv.entity_id = ? AND cv.deleted_at IS NULL
     LIMIT 1`,
    [fieldId, entityId],
  );
  return rows.length > 0 ? mapRows(CUSTOM_VALUE_COLS, rows)[0] : null;
}

/**
 * Insert or update the single value row for (fieldId, entityId), writing
 * exactly one change_log entry.
 */
export async function setValue(
  fieldId: string,
  entityId: string,
  value: { text?: string | null; num?: number | null; date?: string | null },
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const existing = await findValueRow(fieldId, entityId);
    if (existing) {
      const values: Record<string, unknown> = {
        updatedAt: nowIso(),
        valueText: value.text ?? null,
        valueNum: value.num ?? null,
        valueDate: value.date ?? null,
      };
      const stmt = updateStatement("custom_values", existing.id, values);
      await raw.execute(stmt.sql, stmt.params);
      await logWrite("custom_value", existing.id, "update", existing, values, options.batchId);
      return;
    }
    const stamps = stampNew();
    const row = {
      ...stamps,
      fieldId,
      entityId,
      valueText: value.text ?? null,
      valueNum: value.num ?? null,
      valueDate: value.date ?? null,
      deletedAt: null,
    };
    const stmt = insertStatement("custom_values", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("custom_value", stamps.id, "create", null, row, options.batchId);
  }, "Saving a custom value");
}

/** Hard delete: values are never soft-deleted. */
export async function clearValue(
  fieldId: string,
  entityId: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const existing = await findValueRow(fieldId, entityId);
    if (!existing) return;
    await raw.execute(`DELETE FROM custom_values WHERE field_id = ? AND entity_id = ?`, [
      fieldId,
      entityId,
    ]);
    await logWrite("custom_value", existing.id, "delete", existing, null, options.batchId);
  }, "Clearing a custom value");
}

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/data/lib/importWrite.ts. */
/* -------------------------------------------------------------------------- */

export function customFieldCreateStatement(
  entityType: string,
  name: string,
  position: number,
): { id: string; statement: Statement } {
  const s = stampNew();
  return {
    id: s.id,
    statement: insertStatement("custom_fields", {
      ...s,
      entityType,
      name: name.trim(),
      kind: "text",
      optionsJson: null,
      position,
      deletedAt: null,
    }),
  };
}

export function customValueStatement(
  fieldId: string,
  entityId: string,
  value: string,
): Statement {
  return insertStatement("custom_values", {
    ...stampNew(),
    fieldId,
    entityId,
    valueText: value,
    valueNum: null,
    valueDate: null,
    deletedAt: null,
  });
}
