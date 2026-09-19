/**
 * Writing one page of website leads into the workspace.
 *
 *   for each lead:
 *     deals.findByExternalId("<origin>:<lead id>")  -> found? skip, it is a re-poll
 *     contacts.findByEmailOrPhone(email, phone)     -> found? reuse, else create
 *     insert deal in the first stage, source Website, external_id set
 *     insert one immutable system activity holding the message
 *
 * The whole page lands in ONE `withTransaction`, so a failure halfway through
 * leaves nothing behind and the cursor is never advanced past work that did not
 * commit.
 *
 * Why this file builds its own statements instead of calling `deals.create`
 * and friends: the write lock is not reentrant (docs/STATUS.md, foundations
 * TypeScript agent, note 2). A repository write inside `withTransaction` would
 * queue behind the transaction that is already holding the lock and both would
 * wait forever. So everything inside the transaction is a statement builder -
 * `contacts.createStatements`, `deals.createStatements`,
 * `activities.systemStatement`, `changeLogStatement` - and only reads call
 * into the repositories. (`deals.createStatements` was added in wave 3; this
 * file used to build the deal and its first `deal_stage_events` row by hand.)
 */
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { changeLogStatement } from "@/db/changeLog";
import type { Statement } from "@/db/repos/_base";
import * as contacts from "@/db/repos/contacts";
import * as deals from "@/db/repos/deals";
import * as activities from "@/db/repos/activities";
import * as sources from "@/db/repos/sources";
import * as settings from "@/db/repos/settings";
import { mapLead, WEBSITE_SOURCE } from "@/features/leads/lib/leadMapping";
import type { Lead } from "@/features/leads/lib/types";

export type ApplyResult = {
  /** Leads that became a new deal. */
  created: number;
  /** Leads whose external_id was already on a deal: a re-poll. */
  skipped: number;
  /** Of the created ones, how many reused an existing contact. */
  contactsReused: number;
  /** The ids of the deals created, newest last. Used by tests and by Today. */
  dealIds: string[];
};

/** Everything that must be read or created before the transaction opens. */
export type ApplyContext = {
  stageId: string;
  sourceId: string;
  currency: string;
  region: string;
  nextPosition: number;
};

/** The first stage of the first pipeline: where a new lead lands. */
export async function firstStageId(): Promise<string | null> {
  const rows = await raw.query(
    `SELECT s.id AS s_id FROM stages s
     JOIN pipelines p ON p.id = s.pipeline_id AND p.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
     ORDER BY p.created_at ASC, s.position ASC, s.created_at ASC
     LIMIT 1`,
  );
  return rows.length > 0 ? String(rows[0][0]) : null;
}

async function nextPositionIn(stageId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(max(d.position), -1) AS max_position FROM deals d
     WHERE d.stage_id = ? AND d.deleted_at IS NULL`,
    [stageId],
  );
  return (rows.length > 0 ? Number(rows[0][0]) : -1) + 1;
}

/**
 * Resolve the stage, the source and the workspace's currency and region.
 *
 * `sources.ensure` is a repository write, so it has to happen out here, before
 * the transaction takes the lock.
 */
export async function prepareApply(): Promise<ApplyContext | null> {
  const stageId = await firstStageId();
  if (!stageId) return null;
  const source = await sources.ensure(WEBSITE_SOURCE, "website");
  const [currency, region] = await Promise.all([
    settings.get("currency"),
    settings.get("defaultRegion"),
  ]);
  return {
    stageId,
    sourceId: source.id,
    currency,
    region,
    nextPosition: await nextPositionIn(stageId),
  };
}

/**
 * Apply one page. Idempotent: leads whose external_id is already on a deal are
 * counted as skipped and nothing is written for them.
 */
export async function applyLeadPage(
  leads: Lead[],
  siteOrigin: string,
  context: ApplyContext,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    created: 0,
    skipped: 0,
    contactsReused: 0,
    dealIds: [],
  };
  if (leads.length === 0) return result;

  return withTransaction(async () => {
    const statements: Statement[] = [];
    let position = context.nextPosition;

    for (const lead of leads) {
      const mapped = mapLead(lead, siteOrigin);

      // Re-poll: this lead is already a deal. Nothing to do, and nothing to
      // update either - the owner may have edited the deal since.
      if (await deals.findByExternalId(mapped.externalId)) {
        result.skipped += 1;
        continue;
      }

      // Dedupe on email, then phone. A miss creates the contact.
      let contactId = await contacts.findByEmailOrPhone(
        mapped.email,
        mapped.phone,
      );
      if (contactId) {
        result.contactsReused += 1;
      } else {
        const created = contacts.createStatements(
          {
            firstName: mapped.firstName,
            lastName: mapped.lastName,
            sourceId: context.sourceId,
            phones: mapped.phone
              ? [{ raw: mapped.phone, label: "mobile", isPrimary: true }]
              : [],
            emails: mapped.email
              ? [{ email: mapped.email, label: "work", isPrimary: true }]
              : [],
          },
          context.region,
        );
        contactId = created.id;
        statements.push(...created.statements);
        statements.push(
          changeLogStatement({
            entityType: "contact",
            entityId: created.id,
            op: "create",
            after: {
              firstName: mapped.firstName,
              lastName: mapped.lastName,
              sourceId: context.sourceId,
            },
          }),
        );
      }

      const deal = deals.createStatements({
        title: mapped.dealTitle,
        valueCents: 0,
        currency: context.currency,
        stageId: context.stageId,
        position: position++,
        contactId,
        companyId: null,
        sourceId: context.sourceId,
        externalId: mapped.externalId,
      });
      const dealId = deal.id;
      statements.push(...deal.statements);
      statements.push(
        changeLogStatement({
          entityType: "deal",
          entityId: dealId,
          op: "create",
          after: deal.row,
        }),
      );

      const activity = activities.systemStatement({
        body: mapped.activityBody,
        contactId,
        dealId,
        occurredAt: mapped.occurredAt,
      });
      statements.push({ sql: activity.sql, params: activity.params });
      statements.push(
        changeLogStatement({
          entityType: "activity",
          entityId: activity.id,
          op: "create",
          after: { system: true, body: mapped.activityBody },
        }),
      );

      result.created += 1;
      result.dealIds.push(dealId);
    }

    if (statements.length > 0) {
      await raw.batch(statements);
    }
    return result;
  }, "Saving website leads");
}
