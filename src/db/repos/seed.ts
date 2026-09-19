/**
 * First-boot seed: one pipeline with six stages, and the four sources every
 * workspace starts with. Idempotent - boot calls it after every db_open, and
 * it does nothing when the rows are already there.
 */
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { insertStatement } from "@/db/repos/_base";

export const DEFAULT_PIPELINE_NAME = "Pipeline";

/** Order matters: position is the index, and the first stage takes new deals. */
export const DEFAULT_STAGES = [
  { name: "New", color: "var(--stage-1)", quietDays: 14, isWon: false, isLost: false },
  { name: "Contacted", color: "var(--stage-2)", quietDays: 14, isWon: false, isLost: false },
  { name: "Quoted", color: "var(--stage-3)", quietDays: 14, isWon: false, isLost: false },
  { name: "Scheduled", color: "var(--stage-4)", quietDays: 14, isWon: false, isLost: false },
  { name: "Won", color: "var(--stage-6)", quietDays: 0, isWon: true, isLost: false },
  { name: "Lost", color: "var(--stage-7)", quietDays: 0, isWon: false, isLost: true },
] as const;

export const DEFAULT_SOURCES = [
  { name: "Website", kind: "website" },
  { name: "Referral", kind: "referral" },
  { name: "Import", kind: "import" },
  { name: "Manual", kind: "manual" },
] as const;

async function countLive(table: string): Promise<number> {
  const rows = await raw.query(
    `SELECT count(*) AS row_count FROM ${table} WHERE deleted_at IS NULL`,
  );
  return rows.length > 0 ? Number(rows[0][0]) : 0;
}

export type SeedResult = {
  pipelineCreated: boolean;
  stagesCreated: number;
  sourcesCreated: number;
};

/** Create whatever is missing. Safe to call on every boot. */
export async function seedWorkspace(): Promise<SeedResult> {
  const result: SeedResult = {
    pipelineCreated: false,
    stagesCreated: 0,
    sourcesCreated: 0,
  };

  const existingSources = await raw.query(
    `SELECT s.name AS s_name FROM sources s WHERE s.deleted_at IS NULL`,
  );
  const haveSources = new Set(existingSources.map((r) => String(r[0])));
  const missingSources = DEFAULT_SOURCES.filter((s) => !haveSources.has(s.name));

  const pipelineCount = await countLive("pipelines");

  if (pipelineCount === 0 || missingSources.length > 0) {
    await withTransaction(async () => {
      const at = nowIso();
      const statements: { sql: string; params: unknown[] }[] = [];

      if (pipelineCount === 0) {
        const pipelineId = newId();
        statements.push(
          insertStatement("pipelines", {
            id: pipelineId,
            createdAt: at,
            updatedAt: at,
            name: DEFAULT_PIPELINE_NAME,
            deletedAt: null,
          }),
        );
        DEFAULT_STAGES.forEach((stage, index) => {
          statements.push(
            insertStatement("stages", {
              id: newId(),
              createdAt: at,
              updatedAt: at,
              pipelineId,
              name: stage.name,
              position: index,
              color: stage.color,
              quietDays: stage.quietDays,
              isWon: stage.isWon,
              isLost: stage.isLost,
              deletedAt: null,
            }),
          );
        });
        result.pipelineCreated = true;
        result.stagesCreated = DEFAULT_STAGES.length;
      }

      for (const source of missingSources) {
        statements.push(
          insertStatement("sources", {
            id: newId(),
            createdAt: at,
            updatedAt: at,
            name: source.name,
            kind: source.kind,
            deletedAt: null,
          }),
        );
      }
      result.sourcesCreated = missingSources.length;

      if (statements.length > 0) await raw.batch(statements);
    }, "Setting up this workspace");
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/today/lib/todayData.ts.             */
/* -------------------------------------------------------------------------- */

/** True when the workspace has nothing in it at all — the first-run screen. */
export async function workspaceIsEmpty(): Promise<boolean> {
  const rows = await raw.query(
    `SELECT (SELECT count(*) FROM contacts WHERE deleted_at IS NULL) AS contact_count,
            (SELECT count(*) FROM companies WHERE deleted_at IS NULL) AS company_count,
            (SELECT count(*) FROM deals WHERE deleted_at IS NULL) AS deal_count,
            (SELECT count(*) FROM tasks WHERE deleted_at IS NULL) AS task_count,
            (SELECT count(*) FROM activities WHERE deleted_at IS NULL) AS activity_count`,
  );
  if (rows.length === 0) return true;
  return rows[0].every((value) => Number(value ?? 0) === 0);
}
