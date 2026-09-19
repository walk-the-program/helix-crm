/**
 * Pipelines. v1 has exactly one, seeded on first boot; the table exists so
 * several pipelines are additive later. The repository still checks that a
 * deal's stage belongs to the pipeline it claims, because the state machine in
 * docs/PLAN.md names that as the invalid move.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import {
  insertStatement,
  logWrite,
  mapRows,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  updateStatement,
  parseOrThrow,
  type Col,
} from "@/db/repos/_base";

export type Pipeline = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newPipelineSchema = z.object({
  name: z.string().min(1, "A pipeline needs a name."),
});

export type NewPipeline = z.input<typeof newPipelineSchema>;

const PIPELINE_COLS: readonly Col<Pipeline>[] = [
  ["id", "pl.id", "text"],
  ["name", "pl.name", "text"],
  ["createdAt", "pl.created_at", "text"],
  ["updatedAt", "pl.updated_at", "text"],
  ["deletedAt", "pl.deleted_at", "textNull"],
] as const;

export async function get(id: string): Promise<Pipeline | null> {
  const rows = await raw.query(
    `SELECT ${selectList(PIPELINE_COLS, "pl")} FROM pipelines pl WHERE pl.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(PIPELINE_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Pipeline> {
  const found = await get(id);
  if (!found) throw new NotFoundError("pipeline", id);
  return found;
}

export async function list(): Promise<Pipeline[]> {
  const rows = await raw.query(
    `SELECT ${selectList(PIPELINE_COLS, "pl")} FROM pipelines pl
     WHERE pl.deleted_at IS NULL ORDER BY pl.created_at ASC`,
  );
  return mapRows(PIPELINE_COLS, rows);
}

/** The one pipeline v1 uses. Null only before the first-boot seed runs. */
export async function getDefault(): Promise<Pipeline | null> {
  const all = await list();
  return all[0] ?? null;
}

export async function getDefaultOrThrow(): Promise<Pipeline> {
  const found = await getDefault();
  if (!found) throw new NotFoundError("pipeline", "default");
  return found;
}

export async function create(
  input: NewPipeline,
  options: { batchId?: string } = {},
): Promise<Pipeline> {
  const parsed = parseOrThrow(newPipelineSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = { ...stamps, name: trimmed(parsed.name), deletedAt: null };
    const stmt = insertStatement("pipelines", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("pipeline", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a pipeline");
}

export async function update(
  id: string,
  patch: { name?: string },
  options: { batchId?: string } = {},
): Promise<Pipeline> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    const stmt = updateStatement("pipelines", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("pipeline", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a pipeline");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("pipelines", "pipeline", id, options.batchId),
    "Deleting a pipeline",
  );
}
