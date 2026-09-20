/**
 * The sample data set: load it, and take it back out again.
 *
 * Both halves are one transaction each, and neither one calls a repository
 * write function, because the write lock is not reentrant. Everything is built
 * as statements and sent in one `raw.batch`, in an order that keeps the foreign
 * keys happy: a company before the contact that names it, a contact before its
 * phones, a deal before its stage event, the tag before the links that point at
 * it.
 *
 * The tag is the whole trick. Every row a load writes — company, contact, deal,
 * activity and task alike — gets a link to one tag called "Sample", so removal
 * never has to guess which rows were the example and which ones the owner typed
 * himself. `tag_links.entity_id` has no foreign key (it points at whichever
 * table `entity_type` names), which is what lets a task and an activity carry a
 * tag even though nothing in the product tags those today.
 *
 * Removal is a purge, not a soft delete: the example is not something anyone
 * wants in the trash, and "Remove sample data" says so before it runs.
 */
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { changeLogStatement } from "@/db/changeLog";
import { insertStatement, stampNew, type Statement } from "@/db/repos/_base";
import * as pipelines from "@/db/repos/pipelines";
import * as stagesRepo from "@/db/repos/stages";
import * as sourcesRepo from "@/db/repos/sources";
import * as customFields from "@/db/repos/customFields";
import * as tagsRepo from "@/db/repos/tags";
import * as productsRepo from "@/db/repos/products";
import * as dealItemsRepo from "@/db/repos/dealItems";
import * as documentsRepo from "@/db/repos/documents";
import * as paymentsRepo from "@/db/repos/payments";
import * as settingsRepo from "@/db/repos/settings";
import { contactEmailStatement, contactPhoneStatement } from "@/db/repos/contacts";
import { normalizePhone } from "@/lib/phone";
import { newBatchId } from "@/lib/ids";
import { addDaysToDateString, todayLocal, toLocalDateString } from "@/lib/dates";
import { KEYS, settingStatement } from "@/features/onboarding/lib/settings";
import { SAMPLE_TAG, sampleFor } from "@/features/onboarding/sample";
import type {
  SampleDeal,
  SampleDocument,
  SampleSet,
} from "@/features/onboarding/sample/types";
import type { TradeId } from "@/features/onboarding/presets/types";

/** The entity types a sample row can be, in the order removal deletes them. */
const SAMPLE_ENTITY_TYPES = ["activity", "task", "deal", "contact", "company"] as const;
type SampleEntityType = (typeof SAMPLE_ENTITY_TYPES)[number];

const TABLE_FOR: Record<SampleEntityType, string> = {
  activity: "activities",
  task: "tasks",
  deal: "deals",
  contact: "contacts",
  company: "companies",
};

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function dateFromNow(days: number): string {
  return toLocalDateString(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

/* -------------------------------------------------------------------------- */
/* load                                                                       */
/* -------------------------------------------------------------------------- */

export type LoadResult = {
  companies: number;
  contacts: number;
  deals: number;
  activities: number;
  tasks: number;
  /** Priced lines written in phase two (R9). */
  dealItems: number;
  /** Quotes and invoices raised in phase two (R9). */
  documents: number;
};

export async function loadSampleData(
  trade: TradeId,
  set: SampleSet = sampleFor(trade),
): Promise<LoadResult> {
  const batchId = newBatchId();

  const base = await withTransaction(async () => {
    const pipeline = await pipelines.getDefaultOrThrow();
    const liveStages = await stagesRepo.list(pipeline.id);
    if (liveStages.length === 0) {
      throw new Error("This workspace has no pipeline stages yet.");
    }
    const liveSources = (await sourcesRepo.list()).rows;
    const liveFields = await customFields.list();
    const existingTag = await tagsRepo.findByName(SAMPLE_TAG);

    /* The tag first: every link below points at it. */
    const companyStatements: Statement[] = [];
    const contactStatements: Statement[] = [];
    const childStatements: Statement[] = [];
    const dealStatements: Statement[] = [];
    const activityStatements: Statement[] = [];
    const taskStatements: Statement[] = [];
    const tagStatements: Statement[] = [];
    const linkStatements: Statement[] = [];
    const valueStatements: Statement[] = [];
    const changes: Statement[] = [];

    let tagId: string;
    if (existingTag) {
      tagId = existingTag.id;
    } else {
      const created = tagsRepo.tagCreateStatement(SAMPLE_TAG);
      tagId = created.id;
      tagStatements.push(created.statement);
      changes.push(
        changeLogStatement({
          entityType: "tag",
          entityId: tagId,
          op: "create",
          after: { name: SAMPLE_TAG },
          batchId,
        }),
      );
    }

    const tagRow = (entityType: SampleEntityType, entityId: string): void => {
      linkStatements.push(tagsRepo.tagLinkStatement(tagId, entityType, entityId));
    };

    const logged = (entityType: string, entityId: string, after: unknown): void => {
      changes.push(
        changeLogStatement({ entityType, entityId, op: "create", after, batchId }),
      );
    };

    /* -- lookups the rows refer to by name -------------------------------- */

    const stageByName = new Map(liveStages.map((s) => [s.name.trim().toLowerCase(), s]));
    const sourceByName = new Map(liveSources.map((s) => [s.name.trim().toLowerCase(), s]));
    const fieldByName = new Map(
      liveFields.map((f) => [`${f.entityType}\u0000${f.name.trim().toLowerCase()}`, f]),
    );

    /**
     * A sample deal names a stage from its preset, and by the time it loads the
     * owner may have renamed that stage on screen 2. So: by name, and failing
     * that spread over the stages the workspace actually has, which is better
     * than piling every example deal into the first column.
     */
    let spread = 0;
    const resolveStage = (name: string) => {
      const found = stageByName.get(name.trim().toLowerCase());
      if (found) return found;
      const fallback = liveStages[spread % liveStages.length];
      spread += 1;
      return fallback;
    };

    const defaultSource = liveSources[0] ?? null;
    const resolveSource = (name: string | undefined) => {
      if (!name) return defaultSource;
      return sourceByName.get(name.trim().toLowerCase()) ?? defaultSource;
    };

    const customValues = (
      entityType: "contact" | "company" | "deal",
      entityId: string,
      fields: Record<string, string> | undefined,
    ): void => {
      if (!fields) return;
      for (const [name, value] of Object.entries(fields)) {
        const field = fieldByName.get(`${entityType}\u0000${name.trim().toLowerCase()}`);
        if (!field) continue;
        const numeric = field.kind === "number" ? Number(value) : Number.NaN;
        valueStatements.push(
          insertStatement("custom_values", {
            ...stampNew(),
            fieldId: field.id,
            entityId,
            valueText: field.kind === "number" || field.kind === "date" ? null : value,
            valueNum: Number.isFinite(numeric) ? numeric : null,
            valueDate: field.kind === "date" ? value : null,
            deletedAt: null,
          }),
        );
      }
    };

    /* -- companies -------------------------------------------------------- */

    const companyIds = new Map<string, string>();
    for (const company of set.companies) {
      const stamps = stampNew();
      const phone = company.phone ? normalizePhone(company.phone) : null;
      const row = {
        ...stamps,
        createdAt: daysFromNow(-60),
        name: company.name,
        website: company.website ?? null,
        phoneRaw: phone?.raw ?? null,
        phoneE164: phone?.e164 ?? null,
        addressJson: null,
        sourceId: defaultSource?.id ?? null,
        notes: company.notes ?? null,
        deletedAt: null,
      };
      companyStatements.push(insertStatement("companies", row));
      companyIds.set(company.key, stamps.id);
      tagRow("company", stamps.id);
      logged("company", stamps.id, row);
    }

    /* -- contacts and their phones and emails ----------------------------- */

    const contactIds = new Map<string, string>();
    for (const contact of set.contacts) {
      const stamps = stampNew();
      const row = {
        ...stamps,
        createdAt: daysFromNow(-45),
        firstName: contact.firstName,
        lastName: contact.lastName,
        companyId: contact.companyKey ? companyIds.get(contact.companyKey) ?? null : null,
        addressJson: null,
        sourceId: defaultSource?.id ?? null,
        notes: contact.notes ?? null,
        deletedAt: null,
      };
      contactStatements.push(insertStatement("contacts", row));
      contactIds.set(contact.key, stamps.id);
      if (contact.phone) {
        childStatements.push(
          contactPhoneStatement(stamps.id, contact.phone, "mobile", { isPrimary: true }),
        );
      }
      if (contact.email) {
        childStatements.push(contactEmailStatement(stamps.id, contact.email, "work", true));
      }
      customValues("contact", stamps.id, contact.fields);
      tagRow("contact", stamps.id);
      logged("contact", stamps.id, row);
    }

    /* -- deals, each with the stage event that put it where it is --------- */

    const dealIds = new Map<string, string>();
    const positions = new Map<string, number>();
    for (const deal of set.deals) {
      const stage = resolveStage(deal.stage);
      const stamps = stampNew();
      const createdAt = daysFromNow(-deal.ageDays);
      const stageEnteredAt = daysFromNow(-(deal.stageDays ?? deal.ageDays));
      const position = positions.get(stage.id) ?? 0;
      positions.set(stage.id, position + 1);
      const closed = stage.isWon || stage.isLost;
      const row = {
        ...stamps,
        createdAt,
        updatedAt: stageEnteredAt,
        title: deal.title,
        valueCents: Math.round(deal.value * 100),
        currency: "USD",
        stageId: stage.id,
        stageEnteredAt,
        position,
        contactId: deal.contactKey ? contactIds.get(deal.contactKey) ?? null : null,
        companyId: deal.companyKey ? companyIds.get(deal.companyKey) ?? null : null,
        sourceId: resolveSource(deal.sourceName)?.id ?? null,
        externalId: null,
        expectedOn:
          deal.expectedInDays === undefined ? null : dateFromNow(deal.expectedInDays),
        closedAt: closed ? stageEnteredAt : null,
        outcomeReason: null,
        deletedAt: null,
      };
      dealStatements.push(insertStatement("deals", row));
      dealStatements.push(
        insertStatement("deal_stage_events", {
          ...stampNew(),
          createdAt: stageEnteredAt,
          updatedAt: stageEnteredAt,
          dealId: stamps.id,
          fromStageId: null,
          toStageId: stage.id,
          at: stageEnteredAt,
          deletedAt: null,
        }),
      );
      dealIds.set(deal.key, stamps.id);
      customValues("deal", stamps.id, deal.fields);
      tagRow("deal", stamps.id);
      logged("deal", stamps.id, row);
    }

    /* -- activities ------------------------------------------------------- */

    for (const activity of set.activities) {
      const stamps = stampNew();
      const at = daysFromNow(-activity.daysAgo);
      const row = {
        ...stamps,
        createdAt: at,
        updatedAt: at,
        kind: activity.kind,
        body: activity.body,
        occurredAt: at,
        contactId: activity.contactKey ? contactIds.get(activity.contactKey) ?? null : null,
        companyId: activity.companyKey ? companyIds.get(activity.companyKey) ?? null : null,
        dealId: activity.dealKey ? dealIds.get(activity.dealKey) ?? null : null,
        isSystem: false,
        actorId: "owner",
        deletedAt: null,
      };
      activityStatements.push(insertStatement("activities", row));
      tagRow("activity", stamps.id);
      logged("activity", stamps.id, row);
    }

    /* -- tasks ------------------------------------------------------------ */

    for (const task of set.tasks) {
      const stamps = stampNew();
      const row = {
        ...stamps,
        createdAt: daysFromNow(-Math.max(1, Math.abs(task.dueInDays))),
        title: task.title,
        dueOn: dateFromNow(task.dueInDays),
        dueAt: null,
        doneAt: task.done ? daysFromNow(-1) : null,
        contactId: task.contactKey ? contactIds.get(task.contactKey) ?? null : null,
        companyId: task.companyKey ? companyIds.get(task.companyKey) ?? null : null,
        dealId: task.dealKey ? dealIds.get(task.dealKey) ?? null : null,
        deletedAt: null,
      };
      taskStatements.push(insertStatement("tasks", row));
      tagRow("task", stamps.id);
      logged("task", stamps.id, row);
    }

    /* -- one batch, in foreign-key order --------------------------------- */

    const loadedAt = new Date().toISOString();
    await raw.batch([
      ...tagStatements,
      ...companyStatements,
      ...contactStatements,
      ...childStatements,
      ...dealStatements,
      ...activityStatements,
      ...taskStatements,
      ...linkStatements,
      ...valueStatements,
      settingStatement(KEYS.sampleLoadedAt, loadedAt),
      ...changes,
    ]);

    return {
      companies: set.companies.length,
      contacts: set.contacts.length,
      deals: set.deals.length,
      activities: set.activities.length,
      tasks: set.tasks.length,
      dealIds,
    };
  }, "Loading the example");

  /*
   * Phase two: the money (R9).
   *
   * It is deliberately OUTSIDE the transaction above. Phase one writes
   * statements directly because the write lock is not reentrant, but priced
   * lines and documents must not be written that way: `dealItems.recompute` is
   * the only writer of `value_cents`, `one_time_cents`,
   * `recurring_monthly_cents` and `suggested_total_cents`, and
   * `documents.createFromDeal` is what takes a real number out of
   * `document_sequences`, copies the lines at the price the deal actually
   * agreed, inherits the customer from the deal and writes the timeline
   * entries. Hand-rolled inserts would give the example invoice numbers that
   * collide with the owner's first real one.
   *
   * So this phase calls the repositories, each taking its own write lock, the
   * same way every other write in the product does. The cost is that the load
   * is no longer one atomic act — which is why phase one still writes each
   * deal's typed `value`: if phase two fails, the example is exactly what it
   * was before this existed, with correct deal values and no money, rather
   * than a set of deals worth nothing.
   */
  const money = await loadSampleMoney(set, base.dealIds, batchId);

  return {
    companies: base.companies,
    contacts: base.contacts,
    deals: base.deals,
    activities: base.activities,
    tasks: base.tasks,
    dealItems: money.dealItems,
    documents: money.documents,
  };
}

/* -------------------------------------------------------------------------- */
/* phase two: priced lines and documents                                      */
/* -------------------------------------------------------------------------- */

/** Resolve a "days ago" offset to a local calendar day, never a UTC slice. */
function daysAgoLocal(days: number): string {
  return addDaysToDateString(todayLocal(), -days);
}

/**
 * Write the priced lines and raise the documents.
 *
 * Never fatal. A trade whose set has no `items` and no `documents` does
 * nothing here and returns zeros, which is how the sets that have not been
 * given money yet keep loading exactly as they did.
 */
async function loadSampleMoney(
  set: SampleSet,
  dealIds: Map<string, string>,
  batchId: string,
): Promise<{ dealItems: number; documents: number }> {
  const priced = set.deals.filter((deal) => (deal.items?.length ?? 0) > 0);
  const documents = set.documents ?? [];
  if (priced.length === 0 && documents.length === 0) {
    return { dealItems: 0, documents: 0 };
  }

  // The catalogue the preset just created, by name, so a line naming a service
  // links the real product and the Services page's deal counts are true.
  const productByName = new Map(
    (await productsRepo.list()).rows.map((p) => [p.name.trim().toLowerCase(), p]),
  );

  let itemCount = 0;
  for (const deal of priced) {
    const dealId = dealIds.get(deal.key);
    if (dealId === undefined) continue;
    itemCount += await addSampleItems(deal, dealId, productByName, batchId);
  }

  let documentCount = 0;
  for (const doc of documents) {
    const dealId = dealIds.get(doc.dealKey);
    if (dealId === undefined) continue;
    if (await raiseSampleDocument(doc, dealId)) documentCount += 1;
  }

  return { dealItems: itemCount, documents: documentCount };
}

/** One deal's lines, in order. Returns how many landed. */
async function addSampleItems(
  deal: SampleDeal,
  dealId: string,
  productByName: Map<string, { id: string; name: string }>,
  batchId: string,
): Promise<number> {
  let written = 0;
  for (const line of deal.items ?? []) {
    const qty = line.qty ?? 1;
    try {
      if (line.service) {
        const product = productByName.get(line.service.trim().toLowerCase());
        if (!product) {
          // The preset did not create this service — a data error in the set,
          // caught by the invariants test. Skip the line rather than abandon
          // the whole example.
          console.warn(`[helix] sample: no service named "${line.service}"`);
          continue;
        }
        const item = await dealItemsRepo.addFromProduct(dealId, product.id, { qty, batchId });
        // A description or an agreed price that differs from the catalogue is
        // a second, small write rather than a second code path: addFromProduct
        // is the thing that copies the name, kind, interval and taxable flag
        // from the product row in one round trip, and that is worth keeping.
        const patch: { description?: string; actualUnitCents?: number } = {};
        if (line.description) patch.description = line.description;
        if (line.actualPrice !== undefined) {
          patch.actualUnitCents = Math.round(line.actualPrice * 100);
        }
        if (Object.keys(patch).length > 0) {
          await dealItemsRepo.update(item.id, patch, { batchId });
        }
      } else {
        // A custom line: work that was never in the catalogue.
        const price = line.price ?? line.actualPrice ?? 0;
        const suggested = Math.round(price * 100);
        await dealItemsRepo.add(
          {
            dealId,
            productId: null,
            name: line.name ?? "Custom line",
            description: line.description ?? null,
            kind: "one_time",
            interval: null,
            qty,
            suggestedUnitCents: suggested,
            actualUnitCents:
              line.actualPrice === undefined ? suggested : Math.round(line.actualPrice * 100),
            taxable: true,
          },
          { batchId },
        );
      }
      written += 1;
    } catch (err) {
      console.warn(`[helix] sample: could not price "${deal.key}"`, err);
    }
  }
  return written;
}

/** Raise one quote or invoice, through the repository, and move it to status. */
async function raiseSampleDocument(doc: SampleDocument, dealId: string): Promise<boolean> {
  try {
    const settings = await settingsRepo.getAll();
    const issuedOn = daysAgoLocal(doc.issuedDaysAgo);
    const dueDays = doc.dueInDays ?? settings["invoices.dueDays"];

    const created = await documentsRepo.createFromDeal(dealId, {
      kind: doc.kind,
      lines: doc.lines,
      prefix: doc.kind === "invoice" ? settings["invoices.prefix"] : settings["quotes.prefix"],
      taxRateBp: settings["invoices.taxRateBp"],
      dueDays,
      issuedOn,
    });

    // `send` stamps sent_at and derives due_on from the issue date, which is
    // what makes the overdue one genuinely overdue rather than merely old.
    await documentsRepo.send(created.id, {
      dueDays,
      at: new Date(`${issuedOn}T12:00:00.000Z`).toISOString(),
    });

    if (doc.status === "paid") {
      // A paid invoice in the example workspace now carries a real payment
      // row, like one the owner would record himself, so the Payments card and
      // the Revenue report have something true to show on a fresh install.
      await paymentsRepo.recordFullPayment(created.id, {
        paidOn: daysAgoLocal(doc.paidDaysAgo ?? doc.issuedDaysAgo),
        method: paymentsRepo.normalizeMethod(doc.paidMethod ?? "transfer"),
      });
    }
    return true;
  } catch (err) {
    console.warn(`[helix] sample: could not raise the ${doc.kind} for ${doc.dealKey}`, err);
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* remove                                                                     */
/* -------------------------------------------------------------------------- */

export type RemoveResult = { removed: number };

/**
 * Purge everything carrying the Sample tag, drop the tag, clear the setting.
 *
 * The order matters. Activities and tasks point at contacts, companies and
 * deals with ON DELETE SET NULL, so they could go in any order without an
 * error — but they go first anyway, so that a half-applied batch could never
 * leave an orphan pointing at nothing. Deals go before contacts for the same
 * reason. `deal_stage_events`, `contact_phones` and `contact_emails` cascade,
 * and the FTS triggers take the search rows out on the way.
 */
export async function removeSampleData(): Promise<RemoveResult> {
  return withTransaction(async () => {
    const tag = await tagsRepo.findByName(SAMPLE_TAG);
    if (!tag) return { removed: 0 };

    const rows = await raw.query(
      `SELECT tl.entity_type AS tl_entity_type, tl.entity_id AS tl_entity_id
       FROM tag_links tl WHERE tl.tag_id = ?`,
      [tag.id],
    );

    const byType = new Map<string, string[]>();
    for (const row of rows) {
      const entityType = String(row[0]);
      const entityId = String(row[1]);
      const list = byType.get(entityType) ?? [];
      list.push(entityId);
      byType.set(entityType, list);
    }

    const statements: Statement[] = [];
    let removed = 0;

    // Every id this removal is about to touch, tagged or not (a document and
    // its line items are never tagged - nothing in the product tags a
    // document - so they are named by the sample deal they belong to
    // instead). Read before anything is deleted: `change_log.entity_id`
    // carries no foreign key, so it is the one place a purge does not clean
    // itself up for free, and "no sample-derived survivor in the change log"
    // means the CREATE entries this same data wrote when it was loaded, not
    // only whatever this function itself might add.
    const allSampleIds: string[] = [tag.id, ...[...byType.values()].flat()];

    /*
     * The money first (R9).
     *
     * Deal items and invoice schedules carry `ON DELETE CASCADE` and go with
     * their deal on their own, but `documents.deal_id` is `ON DELETE SET
     * NULL`: deleting a sample deal would leave its invoice behind, pointing
     * at nothing, which is precisely the orphan the money lead's F-LB-3 was
     * about. They are therefore deleted explicitly, before the deals, with
     * their line items ahead of them.
     *
     * A document raised against a sample deal is sample data whether or not it
     * carries the tag — it cannot be tagged, because nothing in the product
     * tags a document — so the deal's own id is what identifies it.
     */
    const sampleDealIds = byType.get("deal") ?? [];
    if (sampleDealIds.length > 0) {
      const holes = sampleDealIds.map(() => "?").join(", ");

      const documentRows = await raw.query(
        `SELECT id FROM documents WHERE deal_id IN (${holes})`,
        [...sampleDealIds],
      );
      allSampleIds.push(...documentRows.map((r) => String(r[0])));
      const dealItemRows = await raw.query(
        `SELECT id FROM deal_items WHERE deal_id IN (${holes})`,
        [...sampleDealIds],
      );
      allSampleIds.push(...dealItemRows.map((r) => String(r[0])));

      // The payments before the documents they hang off. `payments.document_id`
      // is ON DELETE RESTRICT (drizzle/0006_payments.sql) so that nothing can
      // wipe out the record of what a customer paid as a side effect of
      // deleting something else - which means the one place where it IS the
      // right thing to do has to say so. The example's paid invoice always has
      // a payment behind it now, so without this the whole removal fails on a
      // foreign key and the owner is told the example could not be removed.
      statements.push({
        sql: `DELETE FROM payments
              WHERE document_id IN (SELECT id FROM documents WHERE deal_id IN (${holes}))`,
        params: [...sampleDealIds],
      });
      statements.push({
        sql: `DELETE FROM document_items
              WHERE document_id IN (SELECT id FROM documents WHERE deal_id IN (${holes}))`,
        params: [...sampleDealIds],
      });
      statements.push({
        sql: `DELETE FROM documents WHERE deal_id IN (${holes})`,
        params: [...sampleDealIds],
      });
      // Cascades with the deal, but said out loud so a future change to the
      // foreign key cannot quietly leave a schedule drafting invoices against
      // a customer who no longer exists.
      statements.push({
        sql: `DELETE FROM invoice_schedules WHERE deal_id IN (${holes})`,
        params: [...sampleDealIds],
      });
      /*
       * And the timeline entries those documents wrote.
       *
       * `documents.createFromDeal`, `send` and `markPaid` each add a system
       * activity ("Invoice INV-0001 sent, $1,450.00"). They are written by the
       * repository, so they never carried the Sample tag, and
       * `activities.deal_id` is ON DELETE SET NULL — so before this the
       * example left five activities behind, floating free of any record.
       *
       * `is_system = 1` is the whole condition that matters: an activity the
       * OWNER wrote against a sample deal is his, and Settings promises him
       * that "Everything you added yourself stays where it is".
       */
      const systemActivityRows = await raw.query(
        `SELECT id FROM activities WHERE is_system = 1 AND deal_id IN (${holes})`,
        [...sampleDealIds],
      );
      allSampleIds.push(...systemActivityRows.map((r) => String(r[0])));
      statements.push({
        sql: `DELETE FROM activities WHERE is_system = 1 AND deal_id IN (${holes})`,
        params: [...sampleDealIds],
      });
    }

    for (const entityType of SAMPLE_ENTITY_TYPES) {
      const ids = byType.get(entityType) ?? [];
      for (const id of ids) {
        statements.push({
          sql: `DELETE FROM custom_values WHERE entity_id = ?`,
          params: [id],
        });
        statements.push({
          sql: `DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?`,
          params: [entityType, id],
        });
        statements.push({
          sql: `DELETE FROM ${TABLE_FOR[entityType]} WHERE id = ?`,
          params: [id],
        });
        removed += 1;
      }
    }

    statements.push({ sql: `DELETE FROM tag_links WHERE tag_id = ?`, params: [tag.id] });
    statements.push({ sql: `DELETE FROM tags WHERE id = ?`, params: [tag.id] });
    statements.push(settingStatement(KEYS.sampleLoadedAt, null));

    // The change log itself: `change_log.entity_id` carries no foreign key,
    // so nothing above cleaned it up for free. Without this, the CREATE (and
    // any UPDATE) entries `loadSampleData` and the money phase wrote when the
    // example first loaded sat there forever, naming ids that no longer
    // resolve to anything - a purge that still left a trail. No new "delete"
    // entries are written to replace them: a demo that no longer exists has
    // nothing left worth logging either way.
    if (allSampleIds.length > 0) {
      const holes = allSampleIds.map(() => "?").join(", ");
      statements.push({
        sql: `DELETE FROM change_log WHERE entity_id IN (${holes})`,
        params: [...allSampleIds],
      });
    }

    await raw.batch(statements);
    return { removed };
  }, "Removing the example");
}
