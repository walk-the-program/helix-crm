/**
 * Writing one page of website leads into the workspace.
 *
 *   for each lead:
 *     no usable id?                                 -> drop it, count it invalid
 *     already claimed earlier in THIS page          -> skip, one deal per id
 *     deals.findByExternalId("<origin>:<lead id>")  -> found? it is a re-poll:
 *       leave the deal alone, but a changed field writes one update activity
 *     contacts.findByEmailOrPhone(email, phone)     -> found? reuse (and add
 *       any new phone/email as a secondary), else create
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
 * `activities.systemStatement`, `changeLogStatement`, `contacts.
 * contactPhoneStatement`/`contactEmailStatement` - and only reads call into
 * the repositories. (`deals.createStatements` was added in wave 3; this file
 * used to build the deal and its first `deal_stage_events` row by hand.)
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
import * as automations from "@/db/repos/automations";
import { nowIso } from "@/lib/dates";
import { normalizeEmail } from "@/lib/email";
import { normalizePhone } from "@/lib/phone";
import {
  activityDetail,
  hasUsableId,
  LEAD_UPDATE_INTRO,
  mapLead,
  WEBSITE_SOURCE,
  type MappedLead,
} from "@/features/leads/lib/leadMapping";
import type { Lead } from "@/features/leads/lib/types";

export type ApplyResult = {
  /** Leads that became a new deal. */
  created: number;
  /** Leads whose external_id was already on a deal, or repeated on this page: a re-poll or a same-page duplicate. */
  skipped: number;
  /** Of the created ones, how many reused an existing contact. */
  contactsReused: number;
  /**
   * Leads dropped without becoming anything at all: no usable id, so there is
   * nothing to key a deal on (CPO audit, F-LB-8). In production
   * `leadsFetch.assertValidLeadPage` rejects a page before it reaches here,
   * so this is a defensive count, not the normal path to zero.
   */
  invalid: number;
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
 * True for the one error this file treats as "already have this one" rather
 * than a poll failure: the partial unique index `idx_deals_external_id_unique`
 * (drizzle/0005_lead_dedup.sql, F-SEC-28) refusing a second live deal at an
 * external_id.
 *
 * Matched on the message text, not an error code, because the two drivers
 * this file runs under disagree on everything else: the test driver
 * (better-sqlite3) throws its own `SqliteError` with `code:
 * "SQLITE_CONSTRAINT_UNIQUE"`, while the production path wraps whatever Rust's
 * `rusqlite` produced into `DbError` with the generic `code: "SQL_ERROR"`
 * (docs/CONTRACTS.md) - the specific code is thrown away before this file
 * ever sees it. What both share is the literal string SQLite itself puts in
 * the error, "UNIQUE constraint failed: deals.external_id" - that text comes
 * from the SQLite engine, not from either binding, so it survives both paths.
 */
function isExternalIdConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unique constraint failed/i.test(message) && /external_id/i.test(message);
}

/**
 * What the speed-to-lead reminder calls this person.
 *
 * `splitLeadName` already falls back to "Website lead" when the form gave no
 * name at all, so this is never empty; the deal title is the last resort for
 * a mapping that somehow produced neither.
 */
function leadCustomerName(mapped: MappedLead): string {
  const person = `${mapped.firstName} ${mapped.lastName}`.trim();
  return person.length > 0 ? person : mapped.dealTitle;
}

/** One lead's own statements, and how to undo what `result` assumed about it. */
type LeadUnit = {
  statements: Statement[];
  onConflict: () => void;
};

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
    invalid: 0,
    dealIds: [],
  };
  if (leads.length === 0) return result;

  return withTransaction(async () => {
    let position = context.nextPosition;
    // externalIdFor -> the deal id this page already created for it. Closes
    // the gap `deals.findByExternalId` cannot: it only sees COMMITTED rows,
    // so two leads sharing one id within the same page would otherwise both
    // slip past it and both create a deal (CPO audit, F-LB-8).
    const claimedThisPage = new Map<string, string>();
    // One entry per lead that produced something to write. Batched together
    // below in the common case (one round trip); see the catch block for why
    // each entry is also able to stand alone.
    const units: LeadUnit[] = [];

    for (const lead of leads) {
      // No usable id, no external_id worth keying anything on. Belt and
      // braces: `leadsFetch.assertValidLeadPage` already keeps a page this
      // malformed out of production, but this file does not trust a caller
      // it cannot see (CPO audit, F-LB-8).
      if (!hasUsableId(lead.id)) {
        result.invalid += 1;
        continue;
      }

      const mapped = mapLead(lead, siteOrigin);

      // Same-page duplicate: another lead earlier in this page already
      // claimed this external id. One deal per id, even when the site sent
      // the same one twice in one response.
      if (claimedThisPage.has(mapped.externalId)) {
        result.skipped += 1;
        continue;
      }

      // Re-poll: this lead is already a deal. The deal itself is left alone
      // - the owner may have edited it since - but a genuine site-side
      // correction is not thrown away silently: one system activity records
      // it, and only when something actually changed (CPO audit, F-LB-17).
      const existingDeal = await deals.findByExternalId(mapped.externalId);
      if (existingDeal) {
        result.skipped += 1;
        const update = await leadUpdateStatement(existingDeal, mapped);
        // A plain activity insert against an already-existing deal id: it
        // cannot collide with idx_deals_external_id_unique (it never touches
        // deals.external_id), so `onConflict` here is unreachable in
        // practice and only guards against ever silently swallowing a
        // genuinely different failure.
        if (update) units.push({ statements: [update], onConflict: () => {} });
        continue;
      }

      // Dedupe on email, then phone. A miss creates the contact.
      let contactId = await contacts.findByEmailOrPhone(
        mapped.email,
        mapped.phone,
      );
      const unitStatements: Statement[] = [];
      const reusedContact = contactId !== null;
      if (contactId) {
        result.contactsReused += 1;
        // The visitor is known, but this submission may carry a phone or
        // email that is not on file yet - a second number, a work email
        // instead of a personal one. That used to be dropped on the floor
        // with no trace at all; now it is added as a secondary entry. Never
        // overwrites or removes what is already there (CPO audit, F-LB-16).
        unitStatements.push(
          ...(await secondaryContactStatements(contactId, mapped, context.region)),
        );
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
        unitStatements.push(...created.statements);
        unitStatements.push(
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
      unitStatements.push(...deal.statements);
      unitStatements.push(
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
      unitStatements.push({ sql: activity.sql, params: activity.params });
      unitStatements.push(
        changeLogStatement({
          entityType: "activity",
          entityId: activity.id,
          op: "create",
          after: { system: true, body: mapped.activityBody },
        }),
      );

      /**
       * Speed to lead (LR-PX-C, rule `lead_arrived`).
       *
       * The whole point of the feature is that the owner answers today's
       * lead today, so the reminder is written in the same transaction as
       * the lead it is about: a lead that rolls back takes its follow-up
       * with it, and a lead that lands can never land without one. The
       * runner returns statements rather than writing, because the write
       * lock this transaction holds is not reentrant - the same reason
       * everything else in this loop is a statement builder.
       *
       * It returns nothing at all when the rule is switched off, and its
       * own `automation_runs` row makes a second task for this deal
       * impossible even if a re-poll ever reached here.
       */
      const followUp = await automations.runLeadArrived({
        dealId,
        dealTitle: mapped.dealTitle,
        contactId,
        companyId: null,
        customerName: leadCustomerName(mapped),
      });
      unitStatements.push(...followUp.statements);

      claimedThisPage.set(mapped.externalId, dealId);
      result.created += 1;
      result.dealIds.push(dealId);

      units.push({
        statements: unitStatements,
        onConflict: () => {
          // `deals.findByExternalId` said nobody had this external_id, and
          // between that read and this write somebody did (F-SEC-28: the
          // check has always been read-then-write, safe only because the
          // write lock serialises every writer that could race it -
          // tests/repo/leads/pollerRace.test.ts proves that holds for both
          // of the poller's own callers today). Whatever this lead's own
          // unit was about to add - a brand-new contact, the deal, the
          // system activity - rolled back with it as one nested savepoint,
          // so there is nothing left behind to clean up. Reclassify it
          // exactly like an ordinary re-poll: already have this one.
          result.created -= 1;
          result.skipped += 1;
          result.dealIds = result.dealIds.filter((id) => id !== dealId);
          if (reusedContact) result.contactsReused -= 1;
          claimedThisPage.delete(mapped.externalId);
        },
      });
    }

    if (units.length > 0) {
      try {
        await raw.batch(units.flatMap((u) => u.statements));
      } catch (err) {
        if (!isExternalIdConflict(err)) throw err;
        // The fallback path: retry each lead's own statements as its own
        // nested savepoint (raw.batch already does this whenever it runs
        // inside an open transaction - see src/db/writeLock.ts and
        // tests/repo/driver.ts's header comment), so the leads that do not
        // conflict are not taken down with the one that does. This never
        // runs on the common path - only once the single combined batch
        // above has already failed for exactly this reason.
        for (const unit of units) {
          try {
            await raw.batch(unit.statements);
          } catch (unitErr) {
            if (!isExternalIdConflict(unitErr)) throw unitErr;
            unit.onConflict();
          }
        }
      }
    }
    return result;
  }, "Saving website leads");
}

/**
 * A returning visitor's phone or email that is not already on the matched
 * contact. Added as a secondary entry - never primary, never a replacement -
 * so nothing the contact already had is touched (CPO audit, F-LB-16).
 *
 * Reads only (`contacts.listPhones`/`listEmails`): this runs inside the same
 * `withTransaction` as everything else in `applyLeadPage`, and the write lock
 * is not reentrant, so the actual insert has to come back as a statement for
 * the caller's own batch rather than a `contacts.addPhone`/`addEmail` call.
 */
async function secondaryContactStatements(
  contactId: string,
  mapped: MappedLead,
  region: string,
): Promise<Statement[]> {
  const statements: Statement[] = [];

  if (mapped.phone) {
    const incoming = normalizePhone(mapped.phone, region);
    const onFile = await contacts.listPhones(contactId);
    const known = onFile.some((phone) =>
      incoming.e164 !== null ? phone.e164 === incoming.e164 : phone.raw === mapped.phone,
    );
    if (!known) {
      statements.push(
        contacts.contactPhoneStatement(contactId, mapped.phone, "mobile", {
          region,
          isPrimary: false,
        }),
      );
    }
  }

  if (mapped.email) {
    const incomingLower = normalizeEmail(mapped.email).lower;
    const onFile = await contacts.listEmails(contactId);
    const known = onFile.some((email) => email.emailLower === incomingLower);
    if (!known) {
      statements.push(contacts.contactEmailStatement(contactId, mapped.email, "work", false));
    }
  }

  return statements;
}

/**
 * A re-poll of a lead already on file. The deal's own fields are never
 * touched here - the owner may have edited them - but when the website's
 * Service/Message/Page detail differs from what the deal's timeline already
 * shows, one system activity records the correction, in the same voice as
 * the original "Lead from the website." entry. An unchanged re-poll writes
 * nothing at all (CPO audit, F-LB-17).
 */
async function leadUpdateStatement(
  existingDeal: { id: string; contactId: string | null },
  mapped: MappedLead,
): Promise<Statement | null> {
  const newDetail = activityDetail(mapped.activityBody);

  const timeline = await activities.list({ dealId: existingDeal.id, kind: "system" });
  const latestLeadActivity = timeline.rows.find(
    (entry) =>
      entry.body.startsWith("Lead from the website.") ||
      entry.body.startsWith(LEAD_UPDATE_INTRO),
  );
  const oldDetail = latestLeadActivity ? activityDetail(latestLeadActivity.body) : "";

  if (newDetail === oldDetail) return null;

  const body = newDetail.length > 0 ? `${LEAD_UPDATE_INTRO}\n${newDetail}` : LEAD_UPDATE_INTRO;
  const activity = activities.systemStatement({
    body,
    contactId: existingDeal.contactId,
    dealId: existingDeal.id,
    occurredAt: nowIso(),
  });
  return { sql: activity.sql, params: activity.params };
}
