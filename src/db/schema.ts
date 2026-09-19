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
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    ...stamps(),
  },
  (t) => [
    index("idx_tasks_due_on").on(t.dueOn),
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
export type SettingRow = typeof settings.$inferSelect;
export type LeadSyncRow = typeof leadSync.$inferSelect;
export type ChangeLogRow = typeof changeLog.$inferSelect;
export type MergeRow = typeof merges.$inferSelect;
