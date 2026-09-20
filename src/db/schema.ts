/**
 * Helix CRM schema: the Drizzle source of truth (docs/CONTRACTS.md "Schema").
 *
 * Conventions, from docs/PLAN.md "Data model":
 *   - every entity table carries id TEXT PRIMARY KEY (UUID v7), created_at,
 *     updated_at (ISO 8601 UTC strings) and deleted_at (NULL = live).
 *   - money is integer cents; dates without a time are TEXT 'YYYY-MM-DD';
 *     instants are TEXT ISO 8601 UTC; booleans are INTEGER 0/1.
 *   - child rows of a contact or a deal cascade; every optional reference is
 *     ON DELETE SET NULL so a purge never leaves a dangling id.
 *   - stage references are RESTRICT: the UI forces a target stage first
 *     (StageInUseError), and stages are soft-deleted in practice.
 *   - no unique constraint on email or phone: duplicates are policy, and the
 *     duplicates scan surfaces them.
 *
 * search_docs and search_index are created by the hand-written custom
 * migration drizzle/0001_search.sql and are deliberately not modelled here:
 * triggers own them end to end.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* -------------------------------------------------------------------------- */
/* common columns                                                             */
/* -------------------------------------------------------------------------- */

const id = () => text("id").primaryKey();
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const deletedAt = () => text("deleted_at");

const stamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

/* -------------------------------------------------------------------------- */
/* sources                                                                    */
/* -------------------------------------------------------------------------- */

export const sources = sqliteTable(
  "sources",
  {
    id: id(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("manual"),
    ...stamps(),
  },
  (t) => [index("idx_sources_deleted_at").on(t.deletedAt)],
);

/* -------------------------------------------------------------------------- */
/* companies                                                                  */
/* -------------------------------------------------------------------------- */

export const companies = sqliteTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    website: text("website"),
    phoneE164: text("phone_e164"),
    phoneRaw: text("phone_raw"),
    addressJson: text("address_json"),
    sourceId: text("source_id").references(() => sources.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    ...stamps(),
  },
  (t) => [
    index("idx_companies_source_id").on(t.sourceId),
    index("idx_companies_deleted_at").on(t.deletedAt),
    index("idx_companies_name").on(t.name),
    index("idx_companies_phone_e164").on(t.phoneE164),
  ],
);

/* -------------------------------------------------------------------------- */
/* contacts and their child rows                                              */
/* -------------------------------------------------------------------------- */

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    addressJson: text("address_json"),
    sourceId: text("source_id").references(() => sources.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    ...stamps(),
  },
  (t) => [
    index("idx_contacts_company_id").on(t.companyId),
    index("idx_contacts_source_id").on(t.sourceId),
    index("idx_contacts_deleted_at").on(t.deletedAt),
    index("idx_contacts_last_name").on(t.lastName),
  ],
);

export const contactPhones = sqliteTable(
  "contact_phones",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    raw: text("raw").notNull(),
    e164: text("e164"),
    label: text("label").notNull().default("mobile"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    ...stamps(),
  },
  (t) => [
    index("idx_contact_phones_contact_id").on(t.contactId),
    index("idx_contact_phones_e164").on(t.e164),
    index("idx_contact_phones_deleted_at").on(t.deletedAt),
  ],
);

export const contactEmails = sqliteTable(
  "contact_emails",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    emailLower: text("email_lower").notNull(),
    label: text("label").notNull().default("work"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    ...stamps(),
  },
  (t) => [
    index("idx_contact_emails_contact_id").on(t.contactId),
    index("idx_contact_emails_email_lower").on(t.emailLower),
    index("idx_contact_emails_deleted_at").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* pipeline                                                                   */
/* -------------------------------------------------------------------------- */

export const pipelines = sqliteTable(
  "pipelines",
  {
    id: id(),
    name: text("name").notNull(),
    ...stamps(),
  },
  (t) => [index("idx_pipelines_deleted_at").on(t.deletedAt)],
);

export const stages = sqliteTable(
  "stages",
  {
    id: id(),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    position: real("position").notNull().default(0),
    color: text("color").notNull().default("var(--stage-1)"),
    quietDays: integer("quiet_days").notNull().default(14),
    isWon: integer("is_won", { mode: "boolean" }).notNull().default(false),
    isLost: integer("is_lost", { mode: "boolean" }).notNull().default(false),
    ...stamps(),
  },
  (t) => [
    index("idx_stages_pipeline_id").on(t.pipelineId),
    index("idx_stages_position").on(t.position),
    index("idx_stages_deleted_at").on(t.deletedAt),
  ],
);

export const deals = sqliteTable(
  "deals",
  {
    id: id(),
    title: text("title").notNull(),
    valueCents: integer("value_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    stageId: text("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "restrict" }),
    stageEnteredAt: text("stage_entered_at").notNull(),
    position: real("position").notNull().default(0),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    sourceId: text("source_id").references(() => sources.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id"),
    expectedOn: text("expected_on"),
    closedAt: text("closed_at"),
    outcomeReason: text("outcome_reason"),
    /*
     * The revenue breakdown (D20). `value_cents` above stays the deal's single
     * stored number and is the ANNUAL value: one_time_cents + 12 x
     * recurring_monthly_cents. Everything that already sorts, filters, sums or
     * charts on value_cents keeps working, and the three columns below are what
     * let the product say "Upfront $1,500 + $150/mo" instead of one total that
     * hides which half is which.
     *
     * `recurring_monthly_cents` is normalised: a yearly line is divided by 12
     * and rounded, so MRR is one sum with no CASE in it.
     *
     * All five are nullable with a 0/NULL default because they arrive on a
     * table that already holds rows: an existing deal has no line items, and
     * `dealItems.recompute` writes real numbers the first time one is added.
     */
    oneTimeCents: integer("one_time_cents").default(0),
    recurringMonthlyCents: integer("recurring_monthly_cents").default(0),
    /** Set when the deal first reaches a won stage with recurring lines. */
    recurringStartedOn: text("recurring_started_on"),
    /** Set by "End recurring"; MRR stops counting the deal from this date. */
    recurringEndedOn: text("recurring_ended_on"),
    /** The annual value at the catalog's prices, before any discount. */
    suggestedTotalCents: integer("suggested_total_cents").default(0),
    ...stamps(),
  },
  (t) => [
    index("idx_deals_stage_id").on(t.stageId),
    index("idx_deals_stage_entered_at").on(t.stageEnteredAt),
    index("idx_deals_position").on(t.position),
    index("idx_deals_contact_id").on(t.contactId),
    index("idx_deals_company_id").on(t.companyId),
    index("idx_deals_source_id").on(t.sourceId),
    index("idx_deals_external_id").on(t.externalId),
    index("idx_deals_deleted_at").on(t.deletedAt),
    index("idx_deals_stage_position").on(t.stageId, t.position),
    index("idx_deals_recurring_started_on").on(t.recurringStartedOn),
    index("idx_deals_recurring_ended_on").on(t.recurringEndedOn),
    /**
     * Idempotency for the lead poller (F-SEC-28, LR-OPS-W2). Without this the
     * "already have this one" check in applyLeads.ts is read-then-write,
     * correct only because the app's single write lock happens to serialise
     * every writer that could race it. A live deal can still have a NULL
     * external_id (every hand-entered deal does), so the partial index only
     * constrains the rows that actually carry one, and only the live ones -
     * `deals.softDelete` must not be blocked from ever putting a second
     * deal at the same external_id in the Trash. drizzle/0005_lead_dedup.sql
     * de-duplicates any pre-existing violation before this index is created.
     */
    uniqueIndex("idx_deals_external_id_unique")
      .on(t.externalId)
      .where(sql`${t.externalId} is not null and ${t.deletedAt} is null`),
  ],
);

/** One row per stage move: reports and gone-quiet never mine the change log. */
export const dealStageEvents = sqliteTable(
  "deal_stage_events",
  {
    id: id(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    fromStageId: text("from_stage_id").references(() => stages.id, {
      onDelete: "set null",
    }),
    toStageId: text("to_stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "restrict" }),
    at: text("at").notNull(),
    ...stamps(),
  },
  (t) => [
    index("idx_deal_stage_events_deal_id_at").on(t.dealId, t.at),
    index("idx_deal_stage_events_from_stage_id").on(t.fromStageId),
    index("idx_deal_stage_events_to_stage_id").on(t.toStageId),
    index("idx_deal_stage_events_deleted_at").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* timeline and tasks                                                         */
/* -------------------------------------------------------------------------- */

export const activities = sqliteTable(
  "activities",
  {
    id: id(),
    kind: text("kind").notNull(),
    body: text("body").notNull().default(""),
    occurredAt: text("occurred_at").notNull(),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    dealId: text("deal_id").references(() => deals.id, {
      onDelete: "set null",
    }),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    actorId: text("actor_id").notNull().default("owner"),
    ...stamps(),
  },
  (t) => [
    index("idx_activities_contact_id").on(t.contactId),
    index("idx_activities_company_id").on(t.companyId),
    index("idx_activities_deal_id").on(t.dealId),
    index("idx_activities_occurred_at").on(t.occurredAt),
    index("idx_activities_deleted_at").on(t.deletedAt),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    dueOn: text("due_on"),
    dueAt: text("due_at"),
    doneAt: text("done_at"),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    dealId: text("deal_id").references(() => deals.id, {
      onDelete: "set null",
    }),
    /**
     * Who created this task: 'user' (a person typed it) or 'automation' (a
     * rule wrote it). Defaulted rather than nullable so every row written
     * before 0007_visits reads as what it is — a person's task.
     */
    source: text("source").notNull().default("user"),
    /** Where a visit happens. Free text, prefilled from the record's address. */
    place: text("place"),
    /** How long to allow for a visit, in minutes. NULL means no length given. */
    durationMinutes: integer("duration_minutes"),
    ...stamps(),
  },
  (t) => [
    index("idx_tasks_due_on").on(t.dueOn),
    index("idx_tasks_source").on(t.source),
    index("idx_tasks_due_at").on(t.dueAt),
    index("idx_tasks_done_at").on(t.doneAt),
    index("idx_tasks_contact_id").on(t.contactId),
    index("idx_tasks_company_id").on(t.companyId),
    index("idx_tasks_deal_id").on(t.dealId),
    index("idx_tasks_deleted_at").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* tags, custom fields, attachments, saved views                              */
/* -------------------------------------------------------------------------- */

export const tags = sqliteTable(
  "tags",
  {
    id: id(),
    name: text("name").notNull(),
    color: text("color").notNull().default("var(--stage-1)"),
    ...stamps(),
  },
  (t) => [
    index("idx_tags_name").on(t.name),
    index("idx_tags_deleted_at").on(t.deletedAt),
  ],
);

/** Polymorphic: entity_id has no FK because it points at several tables. */
export const tagLinks = sqliteTable(
  "tag_links",
  {
    id: id(),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    ...stamps(),
  },
  (t) => [
    index("idx_tag_links_tag_id").on(t.tagId),
    index("idx_tag_links_entity").on(t.entityType, t.entityId),
    index("idx_tag_links_deleted_at").on(t.deletedAt),
  ],
);

export const customFields = sqliteTable(
  "custom_fields",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    optionsJson: text("options_json"),
    position: real("position").notNull().default(0),
    ...stamps(),
  },
  (t) => [
    index("idx_custom_fields_entity_type").on(t.entityType),
    index("idx_custom_fields_position").on(t.position),
    index("idx_custom_fields_deleted_at").on(t.deletedAt),
  ],
);

export const customValues = sqliteTable(
  "custom_values",
  {
    id: id(),
    fieldId: text("field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    valueText: text("value_text"),
    valueNum: real("value_num"),
    valueDate: text("value_date"),
    ...stamps(),
  },
  (t) => [
    index("idx_custom_values_field_id").on(t.fieldId),
    index("idx_custom_values_entity_id").on(t.entityId),
    index("idx_custom_values_deleted_at").on(t.deletedAt),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    fileName: text("file_name").notNull(),
    storedName: text("stored_name").notNull(),
    bytes: integer("bytes").notNull().default(0),
    mime: text("mime").notNull().default("application/octet-stream"),
    ...stamps(),
  },
  (t) => [
    index("idx_attachments_entity").on(t.entityType, t.entityId),
    index("idx_attachments_deleted_at").on(t.deletedAt),
  ],
);

export const savedViews = sqliteTable(
  "saved_views",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    queryJson: text("query_json").notNull().default("{}"),
    position: real("position").notNull().default(0),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    ...stamps(),
  },
  (t) => [
    index("idx_saved_views_entity_type").on(t.entityType),
    index("idx_saved_views_position").on(t.position),
    index("idx_saved_views_deleted_at").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* recurring service reminders                                                */
/* -------------------------------------------------------------------------- */

/**
 * "Remind me every spring" as a row rather than a timer.
 *
 * `next_due_on` is the only state that matters: Today reads the rules whose
 * next date is inside the next seven days, and marking one done advances that
 * date by the interval and stamps `last_completed_on`. Nothing runs in the
 * background, so a workspace that was closed for a year is still correct the
 * moment it opens - the query is evaluated against today, not against a clock
 * that was not ticking.
 *
 * `every_n` + `unit` rather than an RRULE string: an owner setting "every 3
 * months" does not need RFC 5545, and a column pair can be read in SQL.
 */
export const recurringRules = sqliteTable(
  "recurring_rules",
  {
    id: id(),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    everyN: integer("every_n").notNull().default(1),
    /** 'week' | 'month' | 'year'. */
    unit: text("unit").notNull().default("year"),
    nextDueOn: text("next_due_on").notNull(),
    lastCompletedOn: text("last_completed_on"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...stamps(),
  },
  (t) => [
    index("idx_recurring_rules_contact_id").on(t.contactId),
    index("idx_recurring_rules_company_id").on(t.companyId),
    index("idx_recurring_rules_next_due_on").on(t.nextDueOn),
    index("idx_recurring_rules_active").on(t.active),
    index("idx_recurring_rules_deleted_at").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* message templates                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The four or five things the owner types every week, kept once.
 *
 * `kind` is 'text' or 'email'; a text template has no subject. `body` holds
 * merge fields in double braces ({{first_name}}), rendered at send time - the
 * stored row is never rendered, so a template can be edited after it has been
 * used and nothing that was already sent changes.
 */
export const templates = sqliteTable(
  "templates",
  {
    id: id(),
    /** 'text' | 'email'. */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    subject: text("subject"),
    body: text("body").notNull().default(""),
    position: real("position").notNull().default(0),
    ...stamps(),
  },
  (t) => [
    index("idx_templates_kind").on(t.kind),
    index("idx_templates_position").on(t.position),
    index("idx_templates_deleted_at").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* revenue: the services catalog, deal line items, documents and schedules     */
/* -------------------------------------------------------------------------- */

/**
 * What the business sells, with the price it usually charges (D20).
 *
 * `kind` is 'one_time' or 'recurring'; a recurring service carries an
 * `interval` of 'month' or 'year' and a one-time service leaves it NULL. The
 * price is the *suggested* price: a deal line copies it in and the owner can
 * override the copy, which is what makes the discount on a deal visible
 * instead of lost.
 *
 * A service is never hard-deleted while a deal line still points at it - the
 * repository deactivates it instead - so the history of what was sold survives
 * a change to the price list.
 */
export const products = sqliteTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    /** 'one_time' | 'recurring'. */
    kind: text("kind").notNull().default("one_time"),
    /** 'month' | 'year', and NULL for a one-time service. */
    interval: text("interval"),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    taxable: integer("taxable", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    position: real("position").notNull().default(0),
    ...stamps(),
  },
  (t) => [
    index("idx_products_kind").on(t.kind),
    index("idx_products_active").on(t.active),
    index("idx_products_position").on(t.position),
    index("idx_products_deleted_at").on(t.deletedAt),
  ],
);

/**
 * One line of what a deal is for.
 *
 * The line copies the product's name, kind, interval and price rather than
 * reading through the reference, because a price list changes and a deal that
 * was agreed at last year's price is still that deal. `product_id` is
 * ON DELETE SET NULL for the same reason: losing the catalog row must not lose
 * the line.
 *
 * `suggested_unit_cents` is what the catalog said and is read-only in the UI;
 * `actual_unit_cents` is what the owner is charging. The difference between
 * the two totals is the discount the deal page shows.
 *
 * Changing any line runs `dealItems.recompute(dealId)`, which rewrites the
 * deal's one_time_cents, recurring_monthly_cents, suggested_total_cents and
 * value_cents in the same transaction as the change.
 */
export const dealItems = sqliteTable(
  "deal_items",
  {
    id: id(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    /** 'one_time' | 'recurring'. */
    kind: text("kind").notNull().default("one_time"),
    /** 'month' | 'year', and NULL for a one-time line. */
    interval: text("interval"),
    qty: integer("qty").notNull().default(1),
    suggestedUnitCents: integer("suggested_unit_cents").notNull().default(0),
    actualUnitCents: integer("actual_unit_cents").notNull().default(0),
    taxable: integer("taxable", { mode: "boolean" }).notNull().default(false),
    position: real("position").notNull().default(0),
    ...stamps(),
  },
  (t) => [
    index("idx_deal_items_deal_id").on(t.dealId),
    index("idx_deal_items_product_id").on(t.productId),
    index("idx_deal_items_position").on(t.position),
    index("idx_deal_items_deleted_at").on(t.deletedAt),
  ],
);

/**
 * A quote or an invoice: one table, two kinds.
 *
 * They are the same document with different words on it and a different set of
 * statuses - a quote is draft/sent/accepted/declined, an invoice is
 * draft/sent/paid/void - so splitting them would duplicate the numbering, the
 * line items, the tax and the PDF path for no gain. `converted_to_id` is the
 * link an accepted quote leaves behind when it becomes an invoice.
 *
 * `number` is unique per kind, handed out by `document_sequences`. Tax is
 * stored as basis points (1% = 100) so a rate of 8.25% is an integer and no
 * float ever touches money.
 */
export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    /** 'quote' | 'invoice'. */
    kind: text("kind").notNull(),
    /** "INV-0007": the prefix from settings plus the sequence number. */
    number: text("number").notNull(),
    dealId: text("deal_id").references(() => deals.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    /**
     * Quote: 'draft' | 'sent' | 'accepted' | 'declined'.
     * Invoice: 'draft' | 'sent' | 'paid' | 'void'.
     */
    status: text("status").notNull().default("draft"),
    issuedOn: text("issued_on"),
    dueOn: text("due_on"),
    validUntil: text("valid_until"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    /** Basis points: 825 is 8.25%. */
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    notes: text("notes"),
    paymentInstructions: text("payment_instructions"),
    convertedToId: text("converted_to_id"),
    sentAt: text("sent_at"),
    paidOn: text("paid_on"),
    paidMethod: text("paid_method"),
    paidNote: text("paid_note"),
    pdfPath: text("pdf_path"),
    ...stamps(),
  },
  (t) => [
    index("idx_documents_kind_status").on(t.kind, t.status),
    index("idx_documents_deal_id").on(t.dealId),
    index("idx_documents_contact_id").on(t.contactId),
    index("idx_documents_company_id").on(t.companyId),
    index("idx_documents_due_on").on(t.dueOn),
    index("idx_documents_deleted_at").on(t.deletedAt),
    uniqueIndex("idx_documents_kind_number").on(t.kind, t.number),
  ],
);

/**
 * A line on a quote or an invoice.
 *
 * Deliberately not a reference to `deal_items`: a document is a record of what
 * was sent, and editing the deal afterwards must not rewrite a document
 * somebody already has. The line is copied across and then stands alone, which
 * is why it carries no soft-delete column either - it lives and dies with its
 * document.
 */
export const documentItems = sqliteTable(
  "document_items",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    qty: integer("qty").notNull().default(1),
    unitCents: integer("unit_cents").notNull().default(0),
    taxable: integer("taxable", { mode: "boolean" }).notNull().default(false),
    /** 'one_time' | 'recurring'. */
    kind: text("kind").notNull().default("one_time"),
    /** 'month' | 'year', and NULL for a one-time line. */
    interval: text("interval"),
    position: real("position").notNull().default(0),
  },
  (t) => [
    index("idx_document_items_document_id").on(t.documentId),
    index("idx_document_items_position").on(t.position),
  ],
);

/**
 * The next number for each kind of document, one row per kind.
 *
 * A counter row rather than `max(number) + 1`: the numbers have a prefix, they
 * are text, and a voided invoice must not hand its number back out. The
 * repository bumps this inside the same transaction that writes the document.
 */
export const documentSequences = sqliteTable("document_sequences", {
  /** 'quote' | 'invoice'. */
  kind: text("kind").primaryKey(),
  nextNumber: integer("next_number").notNull().default(1),
});

/**
 * "Bill this deal every month": the recurring invoice schedule.
 *
 * Like `recurring_rules`, `next_issue_on` is the only state and nothing runs in
 * the background - a workspace that was closed for a year is correct the moment
 * it opens, because the query is evaluated against today.
 */
export const invoiceSchedules = sqliteTable(
  "invoice_schedules",
  {
    id: id(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    /** 'month' | 'year'. */
    interval: text("interval").notNull().default("month"),
    nextIssueOn: text("next_issue_on").notNull(),
    lastIssuedOn: text("last_issued_on"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...stamps(),
  },
  (t) => [
    index("idx_invoice_schedules_deal_id").on(t.dealId),
    index("idx_invoice_schedules_next_issue_on").on(t.nextIssueOn),
    index("idx_invoice_schedules_active").on(t.active),
    index("idx_invoice_schedules_deleted_at").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* workspace-level key/value, sync and bookkeeping                            */
/* -------------------------------------------------------------------------- */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: updatedAt(),
});

/** cursor is a single opaque TEXT produced by the site; never parsed here. */
export const leadSync = sqliteTable("lead_sync", {
  siteOrigin: text("site_origin").primaryKey(),
  cursor: text("cursor"),
  lastPolledAt: text("last_polled_at"),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
});

export const schemaMigrations = sqliteTable("schema_migrations", {
  version: text("version").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});

export const changeLog = sqliteTable(
  "change_log",
  {
    id: id(),
    at: text("at").notNull(),
    actorId: text("actor_id").notNull().default("owner"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    batchId: text("batch_id"),
  },
  (t) => [
    index("idx_change_log_entity").on(t.entityType, t.entityId),
    index("idx_change_log_batch_id").on(t.batchId),
    index("idx_change_log_at").on(t.at),
  ],
);

/**
 * Merge history: one row per merge so the Merges screen can reverse one for
 * 30 days (docs/PLAN.md item 15). The rows the merge moved are found by
 * batch_id in change_log.
 */
export const merges = sqliteTable(
  "merges",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    survivorId: text("survivor_id").notNull(),
    loserId: text("loser_id").notNull(),
    batchId: text("batch_id").notNull(),
    at: text("at").notNull(),
    reversedAt: text("reversed_at"),
    ...stamps(),
  },
  (t) => [
    index("idx_merges_survivor_id").on(t.survivorId),
    index("idx_merges_loser_id").on(t.loserId),
    index("idx_merges_batch_id").on(t.batchId),
    index("idx_merges_at").on(t.at),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
export type ContactPhone = typeof contactPhones.$inferSelect;
export type ContactEmail = typeof contactEmails.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type DealStageEvent = typeof dealStageEvents.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type TagLink = typeof tagLinks.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;
export type CustomValue = typeof customValues.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type RecurringRuleRow = typeof recurringRules.$inferSelect;
export type NewRecurringRuleRow = typeof recurringRules.$inferInsert;
export type TemplateRow = typeof templates.$inferSelect;
export type NewTemplateRow = typeof templates.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type DealItemRow = typeof dealItems.$inferSelect;
export type NewDealItemRow = typeof dealItems.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type DocumentItemRow = typeof documentItems.$inferSelect;
export type NewDocumentItemRow = typeof documentItems.$inferInsert;
export type DocumentSequenceRow = typeof documentSequences.$inferSelect;
export type InvoiceScheduleRow = typeof invoiceSchedules.$inferSelect;
export type NewInvoiceScheduleRow = typeof invoiceSchedules.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;
export type LeadSyncRow = typeof leadSync.$inferSelect;
export type ChangeLogRow = typeof changeLog.$inferSelect;
export type MergeRow = typeof merges.$inferSelect;
