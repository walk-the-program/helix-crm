/**
 * Applying screen 2: one transaction, or nothing at all.
 *
 * The owner has just edited a preset — renamed stages, dropped a source, added
 * a field — and pressed "Use this setup". What that writes:
 *
 *   settings.vocabulary          the word the whole product uses
 *   stages                       replaced, in the plan's order
 *   sources                      replaced
 *   custom_fields                the ones that are not there yet
 *   products                     the trade's starting price list, new workspace only
 *   onboarding.completedAt       now
 *
 * All of it in one `withTransaction`. The write lock is not reentrant, so
 * nothing in here calls a repository write function: every change is built as a
 * statement and sent in one `raw.batch`, in the order it was built (which is
 * why `planBatch` is deliberately not used — it moves every non-insert to the
 * end, and that would delete the stages this function had just inserted).
 *
 * "Replaced" needs a caveat, and it is the one thing worth reading twice.
 *
 * Stages are replaced by what they HOLD, not by whether the workspace is new.
 * A landscaper who picked his trade after clicking around for ten minutes used
 * to end up with the six default stages and the seven landscaping ones stacked
 * on top of each other, which is nobody's pipeline. So every stage that holds
 * nothing - no deal, live or in the trash, and no stage history - is deleted
 * and the preset's stages take its place; a stage that holds work is kept,
 * moved below the new ones, and named in the result so the screen can tell the
 * owner what it left alone. `deals.stage_id` and
 * `deal_stage_events.to_stage_id` are both ON DELETE RESTRICT, so "holds
 * nothing" is measured against both tables rather than guessed: the delete
 * would fail loudly otherwise, mid-transaction, on somebody's first run.
 *
 * Sources and custom fields keep the older, gentler rule. On the first run the
 * workspace is empty, so replacing them is a delete and an insert and nothing
 * moves; once the workspace holds records it is additive, and only genuinely
 * new ones are appended. Nothing the owner has data in is ever thrown away by
 * a setup screen.
 *
 * The price list does not follow that additive rule; it follows a stricter one.
 * A service is seeded only when the workspace is genuinely new (`replace` is
 * true) — never appended on a reopened setup, even though stages and sources
 * are. An owner who already has contacts or deals may well have already built
 * his own price list by hand, and a setup screen does not get to add four more
 * rows to it just because he picked a trade.
 */
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { changeLogStatement } from "@/db/changeLog";
import { insertStatement, stampNew, type Statement } from "@/db/repos/_base";
import * as pipelines from "@/db/repos/pipelines";
import * as stagesRepo from "@/db/repos/stages";
import * as sourcesRepo from "@/db/repos/sources";
import * as customFields from "@/db/repos/customFields";
import { productStatements } from "@/db/repos/products";
import { newBatchId } from "@/lib/ids";
import { KEYS, settingStatement } from "@/features/onboarding/lib/settings";
import { workspaceHasRecords } from "@/features/onboarding/gate";
import type {
  PresetField,
  PresetFieldKind,
  PresetService,
  TradePreset,
  VocabularyKey,
} from "@/features/onboarding/presets/types";

/* -------------------------------------------------------------------------- */
/* the plan: a preset the owner is allowed to edit                            */
/* -------------------------------------------------------------------------- */

/**
 * `key` is a local identity for the editing screen — React needs something
 * stable to keep an input focused while its name is being retyped. It is never
 * written to the database; the row gets a fresh id at apply time.
 */
export type PlanStage = {
  key: string;
  name: string;
  quietDays: number;
  isWon: boolean;
  isLost: boolean;
};

export type PlanSource = { key: string; name: string; kind: string };

export type PlanField = {
  key: string;
  name: string;
  kind: PresetFieldKind;
  entityType: PresetField["entityType"];
  options?: string[];
};

/**
 * A service rides along with the plan unedited — screen 2 has no UI for the
 * price list, so there is no `key` to keep an input focused and nothing here
 * is ever typed into. It is `preset.services`, carried through so `applyPlan`
 * only has to know about `SetupPlan`.
 */
export type PlanService = PresetService;

export type SetupPlan = {
  vocabulary: VocabularyKey;
  stages: PlanStage[];
  sources: PlanSource[];
  fields: PlanField[];
  services: PlanService[];
};

let keySeq = 0;
/** A local key for a row on the editing screen. Not a database id. */
export function planKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

export function planFromPreset(preset: TradePreset): SetupPlan {
  return {
    vocabulary: preset.vocabulary,
    stages: preset.stages.map((stage) => ({
      key: planKey("stage"),
      name: stage.name,
      quietDays: stage.quietDays,
      isWon: stage.isWon ?? false,
      isLost: stage.isLost ?? false,
    })),
    sources: preset.sources.map((source) => ({
      key: planKey("source"),
      name: source.name,
      kind: source.kind,
    })),
    fields: preset.fields.map((field) => ({
      key: planKey("field"),
      name: field.name,
      kind: field.kind,
      entityType: field.entityType,
      options: field.options ? [...field.options] : undefined,
    })),
    services: preset.services.map((service) => ({ ...service })),
  };
}

/* -------------------------------------------------------------------------- */
/* colour                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The stage ramp, spent the way docs/DESIGN.md §5 spends it: won is the green,
 * lost is the red, and everything in between walks the muted hues in order. A
 * pipeline needs separable colours more than it needs meaningful ones, and the
 * stage name is spelled out beside the colour everywhere it appears.
 */
const OPEN_STAGE_COLORS = [
  "var(--stage-1)",
  "var(--stage-2)",
  "var(--stage-3)",
  "var(--stage-4)",
  "var(--stage-7)",
  "var(--stage-8)",
];

export function stageColor(stage: { isWon: boolean; isLost: boolean }, openIndex: number): string {
  if (stage.isWon) return "var(--stage-5)";
  if (stage.isLost) return "var(--stage-6)";
  return OPEN_STAGE_COLORS[openIndex % OPEN_STAGE_COLORS.length];
}

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

export type PlanProblem = { field: "stages" | "sources" | "fields"; message: string };

/**
 * What the owner is not allowed to press "Use this setup" with. Deliberately
 * short: the point of the screen is that he can rename anything, so the only
 * rules are the ones the pipeline cannot work without.
 */
export function planProblems(plan: SetupPlan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const named = plan.stages.filter((s) => s.name.trim().length > 0);

  if (named.length < 2) {
    problems.push({ field: "stages", message: "A pipeline needs at least two stages." });
  }
  if (named.length > 12) {
    problems.push({ field: "stages", message: "Twelve stages is as many as a board can show." });
  }
  const seen = new Set<string>();
  for (const stage of named) {
    const key = stage.name.trim().toLowerCase();
    if (seen.has(key)) {
      problems.push({ field: "stages", message: `Two stages are both called "${stage.name.trim()}".` });
      break;
    }
    seen.add(key);
  }
  if (named.filter((s) => s.isWon).length !== 1) {
    problems.push({ field: "stages", message: "Mark exactly one stage as the one you have won." });
  }
  if (named.filter((s) => s.isLost).length !== 1) {
    problems.push({ field: "stages", message: "Mark exactly one stage as the one you have lost." });
  }
  if (plan.sources.filter((s) => s.name.trim().length > 0).length === 0) {
    problems.push({ field: "sources", message: "Keep at least one place work comes from." });
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* the apply                                                                  */
/* -------------------------------------------------------------------------- */

function cleanPlan(plan: SetupPlan): SetupPlan {
  return {
    vocabulary: plan.vocabulary,
    stages: plan.stages
      .map((s) => ({ ...s, name: s.name.trim() }))
      .filter((s) => s.name.length > 0),
    sources: plan.sources
      .map((s) => ({ ...s, name: s.name.trim() }))
      .filter((s) => s.name.length > 0),
    fields: plan.fields
      .map((f) => ({ ...f, name: f.name.trim() }))
      .filter((f) => f.name.length > 0),
    services: plan.services
      .map((s) => ({ ...s, name: s.name.trim() }))
      .filter((s) => s.name.length > 0),
  };
}

export type ApplyResult = {
  /** False when the workspace was already in use and this ran additively. */
  replaced: boolean;
  stagesCreated: number;
  /** Empty stages that were cleared out to make room for the preset's. */
  stagesRemoved: number;
  /**
   * Stages that were kept because they still hold work, by name, so the screen
   * can say which ones it left alone instead of the owner finding them later.
   */
  stagesKept: string[];
  sourcesCreated: number;
  fieldsCreated: number;
  servicesCreated: number;
};

/**
 * Which stages can be deleted: the ones nothing points at.
 *
 * Both counts include soft-deleted rows on purpose. A deal in the trash still
 * holds its `stage_id`, and SQLite's RESTRICT does not care that the owner
 * considers it deleted - the DELETE fails either way, so a stage under a
 * trashed deal is not empty for this purpose.
 */
async function emptyStageIds(pipelineId: string): Promise<Set<string>> {
  const rows = await raw.query(
    `SELECT s.id AS s_id,
            (SELECT count(*) FROM deals d WHERE d.stage_id = s.id)               AS deal_rows,
            (SELECT count(*) FROM deal_stage_events e WHERE e.to_stage_id = s.id) AS event_rows
     FROM stages s
     WHERE s.pipeline_id = ? AND s.deleted_at IS NULL`,
    [pipelineId],
  );
  const empty = new Set<string>();
  for (const row of rows) {
    if (Number(row[1]) === 0 && Number(row[2]) === 0) empty.add(String(row[0]));
  }
  return empty;
}

export async function applyPlan(input: SetupPlan): Promise<ApplyResult> {
  const plan = cleanPlan(input);
  const problems = planProblems(plan);
  if (problems.length > 0) {
    throw new Error(problems[0].message);
  }

  const inUse = await workspaceHasRecords();
  const replace = !inUse;
  const batchId = newBatchId();

  return withTransaction(async () => {
    const pipeline = await pipelines.getDefaultOrThrow();
    const liveStages = await stagesRepo.list(pipeline.id);
    const liveSources = (await sourcesRepo.list()).rows;
    const liveFields = await customFields.list();

    const statements: Statement[] = [];
    const changes: Statement[] = [];
    const result: ApplyResult = {
      replaced: replace,
      stagesCreated: 0,
      stagesRemoved: 0,
      stagesKept: [],
      sourcesCreated: 0,
      fieldsCreated: 0,
      servicesCreated: 0,
    };

    /* -- stages ------------------------------------------------------------ */

    const empty = await emptyStageIds(pipeline.id);
    const keptStages = liveStages.filter((stage) => !empty.has(stage.id));

    for (const stage of liveStages) {
      if (!empty.has(stage.id)) continue;
      statements.push({ sql: `DELETE FROM stages WHERE id = ?`, params: [stage.id] });
      changes.push(
        changeLogStatement({
          entityType: "stage",
          entityId: stage.id,
          op: "delete",
          before: stage,
          batchId,
        }),
      );
      result.stagesRemoved += 1;
    }
    result.stagesKept = keptStages.map((stage) => stage.name);

    // A stage that holds work keeps its name, its flags and its history; the
    // preset does not get to insert a second stage by the same name over it.
    const existingStageNames = new Set(keptStages.map((s) => s.name.trim().toLowerCase()));
    let position = 0;
    let openIndex = 0;
    for (const stage of plan.stages) {
      if (!stage.isWon && !stage.isLost) openIndex += 1;
      if (existingStageNames.has(stage.name.toLowerCase())) continue;
      const stamps = stampNew();
      const row = {
        ...stamps,
        pipelineId: pipeline.id,
        name: stage.name,
        position,
        color: stageColor(stage, openIndex - 1),
        quietDays: stage.quietDays,
        isWon: stage.isWon,
        isLost: stage.isLost,
        deletedAt: null,
      };
      statements.push(insertStatement("stages", row));
      changes.push(
        changeLogStatement({
          entityType: "stage",
          entityId: stamps.id,
          op: "create",
          after: row,
          batchId,
        }),
      );
      position += 1;
      result.stagesCreated += 1;
    }

    // The kept stages fall in below the preset's, in the order they were
    // already in. Positions are rewritten rather than left alone so the board
    // and every stage picker read one continuous pipeline order.
    for (const stage of keptStages) {
      if (stage.position === position) {
        position += 1;
        continue;
      }
      statements.push({
        sql: `UPDATE stages SET position = ?, updated_at = ? WHERE id = ?`,
        params: [position, new Date().toISOString(), stage.id],
      });
      changes.push(
        changeLogStatement({
          entityType: "stage",
          entityId: stage.id,
          op: "update",
          before: stage,
          after: { ...stage, position },
          batchId,
        }),
      );
      position += 1;
    }

    /* -- sources ----------------------------------------------------------- */

    if (replace) {
      for (const source of liveSources) {
        statements.push({ sql: `DELETE FROM sources WHERE id = ?`, params: [source.id] });
        changes.push(
          changeLogStatement({
            entityType: "source",
            entityId: source.id,
            op: "delete",
            before: source,
            batchId,
          }),
        );
      }
    }

    const existingSourceNames = new Set(
      replace ? [] : liveSources.map((s) => s.name.trim().toLowerCase()),
    );
    for (const source of plan.sources) {
      if (existingSourceNames.has(source.name.toLowerCase())) continue;
      const stamps = stampNew();
      const row = {
        ...stamps,
        name: source.name,
        kind: source.kind || "manual",
        deletedAt: null,
      };
      statements.push(insertStatement("sources", row));
      changes.push(
        changeLogStatement({
          entityType: "source",
          entityId: stamps.id,
          op: "create",
          after: row,
          batchId,
        }),
      );
      result.sourcesCreated += 1;
    }

    /* -- custom fields ----------------------------------------------------- */
    /* Never replaced, in either mode: a field the owner already has may hold
     * values on records, and a setup screen does not get to drop those. */

    const nextPosition = new Map<string, number>();
    for (const field of liveFields) {
      const at = nextPosition.get(field.entityType) ?? 0;
      nextPosition.set(field.entityType, Math.max(at, field.position + 1));
    }
    const existingFieldNames = new Set(
      liveFields.map((f) => `${f.entityType} ${f.name.trim().toLowerCase()}`),
    );
    for (const field of plan.fields) {
      const identity = `${field.entityType} ${field.name.toLowerCase()}`;
      if (existingFieldNames.has(identity)) continue;
      existingFieldNames.add(identity);
      const at = nextPosition.get(field.entityType) ?? 0;
      nextPosition.set(field.entityType, at + 1);
      const stamps = stampNew();
      const row = {
        ...stamps,
        entityType: field.entityType,
        name: field.name,
        kind: field.kind,
        optionsJson:
          field.kind === "choice" && field.options && field.options.length > 0
            ? JSON.stringify(field.options)
            : null,
        position: at,
        deletedAt: null,
      };
      statements.push(insertStatement("custom_fields", row));
      changes.push(
        changeLogStatement({
          entityType: "custom_field",
          entityId: stamps.id,
          op: "create",
          after: row,
          batchId,
        }),
      );
      result.fieldsCreated += 1;
    }

    /* -- services (the starting price list) --------------------------------- */
    /* A new workspace only, per the preset type's own doc comment: nothing here
     * runs once the workspace already holds a contact or a deal, so a reopened
     * "/setup" never dumps a second price list on top of one the owner has
     * already built by hand. */

    if (replace) {
      let position = 0;
      for (const service of plan.services) {
        const built = productStatements({
          name: service.name,
          kind: service.kind,
          interval: service.interval,
          unitPriceCents: service.unitPriceCents,
          taxable: service.taxable,
          position,
        });
        statements.push(...built.statements);
        changes.push(
          changeLogStatement({
            entityType: "product",
            entityId: built.id,
            op: "create",
            after: built.row,
            batchId,
          }),
        );
        position += 1;
        result.servicesCreated += 1;
      }
    }

    /* -- settings ---------------------------------------------------------- */

    statements.push(settingStatement("vocabulary", plan.vocabulary));
    changes.push(
      changeLogStatement({
        entityType: "setting",
        entityId: "vocabulary",
        op: "update",
        after: plan.vocabulary,
        batchId,
      }),
    );
    const completedAt = new Date().toISOString();
    statements.push(settingStatement(KEYS.completedAt, completedAt));
    changes.push(
      changeLogStatement({
        entityType: "setting",
        entityId: KEYS.completedAt,
        op: "update",
        after: completedAt,
        batchId,
      }),
    );

    await raw.batch([...statements, ...changes]);
    return result;
  }, "Setting up your pipeline");
}
