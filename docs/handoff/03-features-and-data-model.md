# 03. Features and data model

Read 01 (product) and 02 (architecture) first. This document is the data model
and how each feature uses it, with the exact rules a change must not break.
Checked against `main` 2e9fb04, migrations `0000` to `0009`.

## Conventions every table follows

- Primary key `id` is a text UUID v7 (time-ordered; minted in JS by `newId()` in
  `src/lib/ids.ts`, never v4; built by hand in SQL for the payments backfill). Exceptions: `settings` (key), `lead_sync` (site
  origin), `document_sequences` (kind), `schema_migrations` (version).
- Timestamps: `created_at`, `updated_at`, ISO 8601 UTC instants, defaulted in SQL.
  Soft delete: nullable `deleted_at` (an instant). Days are local calendar strings
  `YYYY-MM-DD` (`due_on`, `paid_on`, `issued_on`, `expected_on`, `next_due_on`).
- Money is integer cents; tax rate is integer basis points (`tax_rate_bp`).
- Live rows are `deleted_at IS NULL`; every read filters on it.
- Where a table points at "whichever entity", it uses `entity_type` + `entity_id`
  with no foreign key (tag_links, custom_values, attachments, saved_views,
  change_log, merges, search_docs).

## Tables

The database has 33 tables defined in `src/db/schema.ts` (the `0009` drizzle
snapshot counts 33) plus two search tables created by hand-written SQL
(`search_docs`, and `search_index`, an FTS5 virtual table) and five report views.
That is 35 `CREATE TABLE` statements across `drizzle/0000` to `0009`. The launch
record's "30 tables" predates payments, automations and visits. Column lists below
come from the `CREATE TABLE` statements plus later `ALTER TABLE ... ADD`; the
migration that introduced each table is in brackets.

### Records (people, businesses, history)

- `contacts` [0000]: a person. `first_name`, `last_name`, `company_id`,
  `address_json` (`line1`, `line2`, `city`, `region`, `postal`, `country`), `source_id`,
  `notes`. Phones and emails are child rows, not columns.
- `contact_phones` [0000]: `contact_id`, `raw` (as typed), `e164` (normalized,
  NULL when unparseable; never rejected), `label`, `is_primary`. Cascade with the
  contact.
- `contact_emails` [0000]: `contact_id`, `email_lower` (the dedupe key), `label`,
  `is_primary`.
- `companies` [0000]: a business. `name`, `website`, `phone_e164`, `phone_raw`,
  `address_json`, `source_id`, `notes`.
- `activities` [0000]: the timeline. `kind` in `note | call | email | meeting | text
  | system`, `body`, `occurred_at`, links `contact_id`, `company_id`, `deal_id`,
  `is_system` (immutable system entries: stage change, task done, import, lead
  received, merge, automation fired, document status), `actor_id`.
- `tags` [0000] (`name`, `color`) and `tag_links` [0000] (`tag_id`, `entity_type` in
  contact/company/deal, `entity_id`; hard-deleted, never soft).
- `custom_fields` [0000]: `entity_type`, `name`, `kind` in `text | number | date |
  choice`, `options_json`, `position`. `custom_values` [0000]: `field_id`,
  `entity_id`, `value_text`, `value_num`, `value_date` (one row per field and
  entity, hard-deleted).
- `sources` [0000]: `name`, `kind` (default `manual`). Seeded: Website, Referral,
  Import, Manual. Onboarding presets add trade-specific ones.
- `attachments` [0000]: `entity_type`, `entity_id`, `file_name` (the owner's name),
  `stored_name` (uuid file in `attachments/`), `bytes`, `mime`. Cap 50 MiB per file
  (Rust `copy_in`).
- `merges` [0000]: duplicate-merge history. `entity_type`, `survivor_id`,
  `loser_id`, `batch_id` (the `change_log` batch that moved the rows), `at`,
  `reversed_at`.
- `saved_views` [0000]: `entity_type`, `name`, `query_json` (opaque to the
  repository), `position`, `pinned` (pinned views show in the sidebar Views group).

### Pipeline (jobs)

- `pipelines` [0000]: `name`. Exactly one exists in v1, seeded at first boot.
- `stages` [0000]: `pipeline_id`, `name`, `position`, `color`, `quiet_days`
  (gone-quiet limit; 0 disables the rule), `is_won`, `is_lost`; [0008] adds
  `follow_up_days`, `follow_up_title` (per-stage automation, both nullable).
- `deals` [0000]: the job/deal/quote (labels vary, table never does). `title`,
  `value_cents`, `currency`, `stage_id`, `stage_entered_at`, `position`,
  `contact_id`, `company_id`, `source_id`, `external_id`, `expected_on`,
  `closed_at`, `outcome_reason` (required when moving to a lost stage). [0004] adds
  `one_time_cents`, `recurring_monthly_cents`, `recurring_started_on`,
  `recurring_ended_on`, `suggested_total_cents`. `external_id` is
  `"<site origin>:<lead id>"` for website leads and has a partial UNIQUE index
  `idx_deals_external_id_unique` (live rows with a non-null id) [0005].
- `deal_stage_events` [0000]: one row per stage move (`deal_id`, `from_stage_id`,
  `to_stage_id`, `at`). The reports' days-in-stage and conversion read these rather
  than the change log.
- `deal_items` [0004]: priced lines on a deal, copied from the catalog so a later
  price change does not rewrite an agreed job. `deal_id` (cascade), `product_id`
  (SET NULL), `name`, `description`, `kind` (`one_time | recurring`), `interval`
  (`month | year`), `qty`, `suggested_unit_cents` (catalog price), `actual_unit_cents`
  (what was charged), `taxable`, `position`.
- `products` [0004]: the services catalog. `name`, `description`, `kind`
  (`one_time | recurring`), `interval`, `unit_price_cents`, `taxable`, `active`,
  `position`.
- `lead_sync` [0000]: one row per site origin. `cursor` (opaque text from the site),
  `last_polled_at`, `last_error`. Hard-deleted on disconnect.

### Money (documents and payments)

- `documents` [0004]: quotes and invoices in one table. `kind` (`quote | invoice`),
  `number` (`INV-2026-0007`; prefix and year come from settings and issue date;
  counter per kind), `deal_id` (nullable in SQL, required by the repository's
  validation: every document belongs to a deal), `contact_id`, `company_id`,
  `status`, `issued_on`, `due_on`, `valid_until` (quotes), `subtotal_cents`,
  `tax_rate_bp`, `tax_cents`, `total_cents`, `notes`, `payment_instructions`,
  `converted_to_id` (quote to invoice), `sent_at`, `pdf_path`, and three cached
  columns `paid_on`, `paid_method`, `paid_note` that mirror the most recent payment
  (right for one invoice screen, never used for period totals).
- `document_items` [0004]: the lines as sent (copied, frozen after draft). `document_id`
  (cascade), `name`, `description`, `qty`, `unit_cents`, `taxable`, `kind`,
  `interval`, `position`. No soft-delete columns.
- `document_sequences` [0004]: `kind`, `next_number`. A counter row per kind, bumped
  in the same transaction as the document (a voided number is never reused).
- `invoice_schedules` [0004]: "bill this deal every month". `deal_id`, `interval`,
  `next_issue_on`, `last_issued_on`, `active`. A daily runner turns due schedules into
  DRAFT invoices (never sent by a timer), catching up one invoice per missed month.
- `payments` [0006]: money that actually arrived. `document_id` (ON DELETE
  RESTRICT), `deal_id` (copied from the document at write time, SET NULL),
  `amount_cents` (CHECK > 0), `paid_on` (local day), `method` (CHECK in `cash | check
  | card | transfer | other`), `reference`, `note`. Indexed on document, deal,
  paid_on, deleted_at. Migration 0006 backfilled one payment per already-paid invoice
  (method `other`, the old free-text method moved into the note).

### Tasks and schedule

- `tasks` [0000]: `title`, `due_on` (day; set whenever any due date exists), `due_at`
  (optional instant refinement), `done_at`, links `contact_id`, `company_id`,
  `deal_id`. [0007] adds `source` (`user | automation`, indexed, default `user`),
  `place`, `duration_minutes` (1 to 1440 or NULL). [0009] adds `notes`. Overdue is
  derived, never stored. A visit is simply a task with a time, a place and a length.
- `recurring_rules` [0003]: "every N weeks/months/years". `contact_id`, `company_id`,
  `title`, `every_n`, `unit` (`week | month | year`), `next_due_on`,
  `last_completed_on`, `active`. Done moves `next_due_on` forward by one interval;
  skip does the same without recording completion; pause sets inactive. Nothing runs
  in the background.
- `templates` [0003]: message templates. `kind` (`text | email`), `name`, `subject`
  (email only), `body` with `{{merge_fields}}`, `position`.

There is no `appointments` table and no `schedule_items` table (decision PX-6).

### Automations

- `automations` [0008]: one row per fixed rule, seeded by the migration. `kind`,
  `enabled`, `delay_minutes`, `title_template`. No soft delete.
- `automation_runs` [0008]: `kind`, `subject_id`, `task_id`; a unique (kind,
  subject_id) index guarantees each rule fires once per subject.

### System

- `settings` [0000]: `key`, `value_json`, `updated_at`. Typed registry in
  `src/db/repos/settings.ts`.
- `change_log` [0000]: undo trail (see 02). `entity_type`, `entity_id`, `op`,
  `before_json`, `after_json`, `batch_id`, `actor_id`, `at`. 90-day retention.
- `schema_migrations` [0000]: `version` (the journal tag), `applied_at`.
- `search_docs` [0001]: `rowid`, `entity_type`, `entity_id`, `text`; unique on
  (entity_type, entity_id). `search_index` [0001]: FTS5 external-content virtual table
  over `search_docs.text`. 21 triggers maintain them.
- Views [0002] (custom SQL): `v_report_pipeline_stage`, `v_report_closed_deals`,
  `v_report_deal_sources`, `v_report_stage_transitions`, `v_report_stage_dwell`. The
  period filter and final aggregation live in `src/db/repos/reports.ts`.

## Relationships

```
Company 1--* Contact                         contacts.company_id
Contact / Company 1--* Deal                  deals.contact_id, deals.company_id
Pipeline 1--* Stage 1--* Deal                stages.pipeline_id, deals.stage_id
Deal 1--* deal_stage_events                  one row per move
Deal 1--* deal_items *--0..1 Product         lines copied from the catalog
Deal 1--* Document (quote|invoice)           documents.deal_id
Document(quote) 0..1--> Document(invoice)    documents.converted_to_id
Document 1--* document_items                 frozen copies of the lines
Document(invoice) 1--* Payment               payments.document_id (RESTRICT)
Deal 1--* invoice_schedules                  recurring billing
Contact/Company/Deal 1--* Activity           activities.contact_id/company_id/deal_id
Contact/Company/Deal 1--* Task               tasks.contact_id/company_id/deal_id
Contact/Company 1--* recurring_rules         reminders
Any of contact/company/deal ---* tag_links, custom_values, attachments   (polymorphic)
```

Customer means a contact or a company. Money for a customer is summed across all its
deals' invoices (`customerMoney`, `customerBalanceCents`). Foreign-key delete
behaviors worth knowing: document lines and deal lines cascade with their parent;
`documents.deal_id` and `payments.deal_id` SET NULL; `payments.document_id` RESTRICT;
`deal_items.product_id` SET NULL. Trash purge order and the deal-with-a-sent-document
purge block are described under Trash below.

## The money model

Source of truth: `src/db/repos/money.ts` header. Every screen reads money from
there so the same word means the same thing on the deal page, the customer page and
the reports. `MoneyTotals` has six fields; the five named figures plus `open`:

| Figure | Definition | Clock (period reports) |
| --- | --- | --- |
| Quoted | `deals.value_cents`: the deal's lines at their actual (discounted) price, or the figure typed on a deal with no lines. It is the ANNUAL value: one-time plus 12 x monthly (yearly lines are normalized to monthly, divided by 12). | day the deal was created |
| Open | the same value, only while the deal is live: not in a won stage, not in a lost stage, no `closed_at`, not deleted (the pipeline figure) | day the deal was created |
| Won | `deals.value_cents` for deals sitting in a won stage | day the deal closed (`closed_at`) |
| Invoiced | invoice totals with status `sent`, `partial` or `paid`. Drafts and voids do not count. A part-paid invoice stays Invoiced for its whole life. | day issued (`issued_on`) |
| Collected | the sum of live PAYMENTS against live invoices | the payment's own `paid_on`, never the invoice's |
| Outstanding | totals of `sent` and `partial` invoices minus their payments (a part-paid invoice contributes only its balance) | over a period: invoices issued in the period that are still unpaid, at their CURRENT balance |

Consequences: a period's Collected can exceed its Invoiced (January's invoice paid in
February). Outstanding over a period is not `invoiced - collected`. Over a deal or a
customer (no period) the two definitions agree. The old document-based "Quoted" (sum of
quote documents) is gone; the filter is recorded as a comment if a "sent on paper"
figure is ever wanted, under a name that is not Quoted.

Rules every payments query follows: join `documents d`, require `d.deleted_at IS NULL`
and `p.deleted_at IS NULL`; pre-aggregate payments per document before joining so a
deal with three invoices does not triple its value (the fan-out trap). Everything is
read-only and integer cents.

Exports from `money.ts`: `dealMoney`, `customerMoney`, `customerBalanceCents`,
`invoiceBalances` / `invoiceBalanceCents`, `periodMoney(from, to)`,
`paymentsByMethod`, `statementRows` (behind the Statement PDF), `perDealMoney`.
Related: `receivables.ts` aging buckets `current`, `1-30`, `31-60`, `61-90`, `90+`
(days past `due_on`, inclusive as written, summing balances).

### Document statuses

From `TRANSITIONS` in `src/db/repos/documents.ts`:

- Quote statuses: `draft`, `sent`, `accepted`, `declined`, `void`.
  draft to sent or void; sent to accepted, declined or void; accepted, declined to
  void; void is final.
- Invoice statuses: `draft`, `sent`, `partial`, `paid`, `void`.
  draft to sent or void; sent to partial, paid or void; partial to sent, paid or void;
  paid to partial, sent or void; void is final.
- Status is derived, never typed, for the payment states: `deriveInvoiceStatus(total,
  paid)` gives `paid` when payments >= total, `partial` when 0 < payments < total,
  `sent` at zero. `recomputeInvoiceStatus` writes it in the same transaction as every
  payment create, edit, delete and restore.
- Sending stamps `sent_at`, and on an invoice with no due date sets one
  (`invoices.dueDays`, default 14). Once a document leaves draft, nothing but its
  status can change.
- Accepting a quote (`accept`) marks it accepted and, if it has one-time lines,
  creates an invoice from them (`converted_to_id`); recurring lines are not copied to
  that invoice. `createDeposit` and the Deposit dialog still exist for an owner who
  prefers two documents, but a deposit is now normally a partial payment on the one
  invoice.
- Every write of a status change adds a timeline line, and
  `documents.onDocumentStatusChanged(listener)` calls listeners inside the same write
  (used by the quote-sent automation; a throwing listener fails the write).

### Payments rules

`src/db/repos/payments.ts`, `docs/CONTRACTS.md` "Payments and the money model":

- Payments belong to invoices only. Refused (a `ValidationError` naming the fix) when:
  the document is a quote; the invoice is a draft or void; the amount is zero or
  negative; the amount exceeds the remaining balance (unless `allowOverpayment: true`);
  `paid_on` is in the future.
- "Mark paid" is `payments.recordFullPayment(id)` (a payment for the balance dated
  today); "Mark unpaid" is `payments.clearForDocument(id)`. `documents.markPaid` and
  `markUnpaid` no longer exist.
- Undo of a payment is `payments.restore`, not `undoBatch`; `payment` is deliberately
  not in `changeLog`'s `TABLE_FOR_ENTITY` (payments do not enter the Cmd+Z stack,
  though ordinary change_log rows are written).
- Soft delete of an invoice does NOT cascade to its payments (checked in
  `documents.softDelete`: `softDeleteRow` only). They stay, invisible because money
  queries join live documents, and a restore brings them back. A stale comment in
  `trash.ts` says soft delete cascades; the code does not. Purge deletes the payments
  first, by hand (`documents.purgePaymentsOf`), because of the RESTRICT key.
- Payments are not indexed for search.
- The Statement PDF (`src/features/invoices/lib/statementFile.ts`,
  `saveStatementPdf`) lists every invoice and payment for a period for a contact or
  company; the invoice and quote PDFs are drawn by `pdf/renderDocument.ts` with
  pdf-lib and embedded Zilla Slab and Lato faces (`pdf/fonts/`), one filled block in
  the totals ("Balance due" once a payment exists).

## Vocabulary

`settings.vocabulary` in `deals | jobs | quotes` changes labels only ("Deal/Deals/New
deal", "Job/Jobs/New job", "Quote/Quotes/New quote"). The DB, routes, code and query keys
always say deal. Pure table in `src/lib/vocabulary.ts`; React reads in
`src/app/vocabulary.ts`; repositories pair `settings.get("vocabulary")` with
`vocabularyFor` so a validation message uses the owner's word. Each trade preset picks a
default (landscaping: jobs). The sidebar pipeline row is contributed through
`navProvider` for the same reason.

## Tasks as visits

A visit is a task whose `due_at` is set, with `place` (prefilled from the linked
contact's or company's address, editable), `duration_minutes` and `notes`. Today's
buckets, the Tasks screen, Trash, undo, the timeline entry and search apply to a visit
unchanged. `tasks.list` filters on `source` and on a timed-only flag. Screens:
`/schedule` (week), the "Schedule a visit" dialog (command `schedule-visit`, mounted as
an overlay), and the record pages. Any schedule item can be exported one at a time as
a standard `.ics` file (`src/lib/ics.ts`, `src/features/schedule/lib/calendar.ts`; UID
from the item id so a second export replaces the first, DTEND from the duration or one
hour).

## Schedule feed

`scheduleItems(range, deps?)` in `src/features/schedule/lib/feed.ts` derives the list on
every read and writes nothing. Sources (five repositories): open tasks by `due_on`, open
deals by `expected_on`, active recurring rules by `next_due_on`, invoices `sent` or
`partial` by `due_on`, active invoice schedules by `next_issue_on`. One `ScheduleItem`
shape with six kinds: `visit`, `task`, `deal-expected`, `recurring-due`, `invoice-due`,
`invoice-issue`. Within a day: timed items first by time, then all-day items by kind
order. Range endpoints are inclusive local days compared as strings. The week starts on
Monday, always (`src/features/schedule/lib/week.ts`); there is no setting.

## Automations

Helix has no job queue and no scheduler. An automation runs synchronously inside the
transaction of the write that triggered it and produces an ordinary task with
`tasks.source = 'automation'`. Three fixed rules, rows in `automations`, switchable and
re-wordable in Settings, Automations:

| kind | trigger | default | title template |
| --- | --- | --- | --- |
| `lead_arrived` | a website lead becomes a deal (inside `applyLeadPage`'s per-page transaction) | on, 60 minutes | `Call {name} about their request` |
| `quote_sent` | a quote's status becomes `sent` (via `onDocumentStatusChanged`) | on, 4320 minutes (3 days) | `Follow up on quote {number} with {name}` |
| `invoice_overdue` | the sweep finds a `sent` or `partial` invoice past due | OFF, 4320 minutes | `Invoice {number} is overdue: check in with {name}` |

A fourth kind belongs to a stage: `stages.follow_up_days` and `follow_up_title`. It fires
from `deals.moveToStage` / `moveManyToStage` on a real stage change only (a deal already
in the target stage fires nothing; deleting a stage via `stages.remove` fires no stage
rules). Title tokens: `{name}` (customer), `{number}` (document number), `{job}` (deal
title); an unknown token is left alone.

Exactly-once: the unique (kind, subject_id) index on `automation_runs`, checked before a
runner does any work. Subject ids: deal id (`lead_arrived`); document id (`quote_sent`);
`<dealId>:<stageId>:<YYYY-MM-DD>` (stage rule); `<documentId>:<YYYY-MM-DD>`
(`invoice_overdue`). Runners: `runLeadArrived`, `runQuoteSent`, `runStageEntered`,
`runInvoiceOverdue` (all assume the caller holds the lock) and `automationSweep` (opens
its own transaction). `startAutomations()` in
`src/features/settings/lib/automationBoot.ts` registers the quote-sent listener and runs
the sweep at boot then every 24 hours, skipping ticks while `timersPaused()`. Each firing
writes a timeline entry on the record saying which rule acted and where to switch it off.
Importing a spreadsheet never fires any rule (`tests/repo/onboarding/importDoesNotAutomate.test.ts`).

## Website leads (the poller)

`src/features/leads/poller.ts`. Every 5 minutes while open, only for the open
workspace, only if a site is configured. It pages with `leads_fetch(cursor, 200)` and saves
the cursor after each page. Each page is applied in ONE `withTransaction`
(`applyLeadPage`): per lead, drop it if it has no usable id; skip if already claimed in the
page; look up `deals.external_id = "<origin>:<lead id>"` (a re-poll leaves the deal alone,
but a changed field writes one update activity); find a contact by email then phone, else
create one; create the deal in the first stage with source Website; write one immutable
system activity holding the original message; fire `lead_arrived`. States: 401/403 stops
the poller with a "check the token" banner; keychain trouble stops it with "save the token
again"; 404 shows "the site has no lead feed" at once and retries; 400 drops the cursor;
other HTTP errors retry with a banner; no answer backs off 1, 2, 4, 8 minutes with a banner
after 3 failures in a row (`FAILURES_BEFORE_BANNER`) and a disconnect hint after 12.
`tools/fake-site` (`npm run fake-site -- --seed 25`, port 4711, flags `--slow`, `--fail`)
stands in for a site in dev and tests. Site contract (`docs/CONTRACTS.md`):
`GET /api/crm/leads?after=<cursor>&limit=<n>`, bearer token, 200 gives `{ leads:
[{ id, createdAt, name, email, phone, service, message, pageUrl }], nextCursor }`, order by
(createdAt, id), cursor is `base64url("<createdAt>|<id>")`, limit capped at 200.

## Bulk actions

On the Contacts list and the deals list (not the board): a click and a shift-click select
a run (`src/lib/selection.ts`: pure, keyed by id not row index, `reconcile` drops ids a
refilter removed). `src/ui/BulkBar.tsx` shows tag, retag company, change source, trash for
contacts and deals (`src/db/repos/bulk.ts`), and move stage for deals
(`deals.moveManyToStage(ids, toStageId, options) => { moved, batchId }`). Each operation is
ONE transaction with ONE `change_log` batch id, so one Cmd+Z reverses it. A deal that fails
validation in a move takes every other deal in the call back with it. The board has no
multi-select on purpose (the card is both drag source and open target).

## Import and export

Import (`src/features/data/import`, `src/features/data/lib`):

- Entry: `/import` or command "Import a CSV". Four types (`IMPORT_TYPES`): Contacts,
  Companies, Deals, Services (Services write to `products`). Vendor exports covered by
  fixtures: HubSpot, Zoho, Pipedrive, Google Contacts, Excel Save-as (`tests/fixtures/`),
  plus malformed cases (BOM, CRLF, semicolons, ragged rows, headers only) and a generator
  for a 100k-row file.
- Decoding: BOM stripped; UTF-8 or Windows-1252 (`src/lib/csv.ts`); delimiter sniffed among
  `,` `;` tab `|`. Column mapping is guessed and shown in a preview before anything is
  written ("the first 20 of N rows"; the count reflects the whole file). Mapping can be
  remembered.
- Duplicate policy (`DedupePolicy`): `skip`, `update` ("Fill in the blanks": adds missing
  emails, phones and details, overwrites nothing), `duplicate` ("Import anyway"). Matching is
  by email first, then phone. Rows are written in batches of 500 (`BATCH_ROWS`).
- Contact fields: First name, Last name, Company, Email, Phone, Street, City, State, Postal
  code, Country, Tags, Notes, Source (plus custom fields). Deal fields include Deal (title),
  Value, Upfront, Monthly, Stage (matched to stage names ignoring case; an unknown name lands
  in the first stage), Expected close.
- Limits: file size 100 MiB (`MAX_IMPORT_FILE_BYTES`, `filePick.ts`); 250,000 rows
  (`MAX_IMPORT_ROWS`, `importRun.ts`); a warning per row is kept, up to a ceiling, for a
  "save warnings" CSV; skipped rows likewise. Result counts on the 2,997-row
  `tests/fixtures/messy-3000.csv`: 2,991 created, 0 updated, 6 skipped, 61 warnings
  (`docs/LAUNCH-ACCEPTANCE.md` J2.3, asserted in `tests/repo/la-w1/importCounts.test.ts`).
- Safety: an automatic `pre-import` backup is taken before anything is written; if it fails,
  the import stops. The result screen names that backup and links to Backups.

Export (`src/features/data/export`, `src/features/data/lib/exportRun.ts`):

- "By list" exports one CSV: `contacts`, `companies`, `deals`, `tasks`, `activities`,
  `services`, `invoices`, `payments` (`EXPORT_ENTITIES`, 8).
- "Everything" writes `helix-export-<date>.zip` holding 19 CSV files (contacts, companies,
  deals, deal_items, tasks, activities, documents, document_items, services, payments,
  invoice_schedules, tags, tag_links, custom_fields, custom_values, recurring_rules,
  templates, saved_views, attachments) plus `helix-export.json`. The zip carries an attachments
  manifest (stored name to owner's name and customer) but not the attached files.
- Formula guard (`src/features/data/lib/exportCsv.ts`): a cell whose first character is one of
  `= + - @ TAB CR LF` is prefixed with a single quote before quoting; a cell where `= + - @`
  appears first after leading whitespace (plain space, tab, any Unicode space) is guarded too.
- Exports are plain, unencrypted files (a disclosed limit).

## Trash, purge and retention numbers

| Rule | Number | Where |
| --- | --- | --- |
| Trash retention before automatic purge | 30 days (`PURGE_AFTER_DAYS`) | `src/db/repos/trash.ts` |
| Purge sweep cadence | once after boot, then every 24 h while open | `src/features/data/trash/purgeSweep.ts` |
| Deal with a sent or paid document | never purged while that document refers to it (`deals.purgeBlockedBy`) | `trash.ts` |
| Purged quote/invoice PDF | removed only if it is inside the workspace's own `documents/` folder | `purgeSweep.ts` |
| `change_log` rows | 90 days (`CHANGE_LOG_RETENTION_DAYS`) | `lib/retention.ts` |
| Merge reversal window | 30 days (`MERGE_REVERSAL_DAYS`) | `src/db/repos/merge.ts` |
| Backups kept | all from the last 24 h; newest per day for 30 days; always the newest | `planRetention` |
| Backup timing | on launch if last is over 1 h old; every 6 h | `retention.ts` |
| Undo stack depth | 20; undo toast 10 s; stack cleared on every db_open | `src/app/undo.ts`, `src/ui/toast.ts` |
| Attachment size | 50 MiB per file | `files.rs` |
| Lead poll | every 5 min; page of 200; body 5 MiB; timeout 15 s | `backoff.ts`, `leads.rs` |
| Duplicate scan | every 24 h | `src/features/data/lib/duplicates.ts` |
| Reminders on Today | shown 7 days ahead (`COMING_UP_DAYS`) | `src/features/recurring/lib/hooks.ts` |
| Gone quiet | open deal with no stage entry or activity for more than the stage's `quiet_days`; 0 disables. Seed default 14 on New, Contacted, Quoted, Scheduled; presets set their own | `deals.goneQuiet` |
| Logs | 7 files, 4 MiB each, older than 7 days swept | `src-tauri/src/lib.rs` |

Trash mechanics (`src/db/repos/trash.ts`): `restore` clears `deleted_at`; `purge` is a
hard delete in a fixed order inside one transaction: attachment FILES first (the caller
deletes those on disk), then `custom_values`, `tag_links`, attachment rows, and the row
itself; foreign keys carry the rest (`contact_phones`, `contact_emails`,
`deal_stage_events` cascade; optional references null out); `change_log` rows are kept
until their own 90-day sweep. A purged invoice's payments are deleted first.

## Duplicates and merge

`src/features/data/duplicates`: a daily scanner finds candidate pairs (contacts: two live
contacts sharing an `email_lower` or an E.164 phone; companies: same name ignoring case, or
the same E.164 phone; `findContactPairs` / `findCompanyPairs`), `/duplicates` lists pairs
and the merges history, `MergeDialog` lets the owner pick one side per field. `src/db/repos/merge.ts` moves
everything the loser owned (activities, tasks, deals, tags, custom values, attachments, and a
contact's phones and emails) to the survivor and soft-deletes the loser for 30 days. Every
moved row is in `change_log` under one batch id; `merge.reverse(mergeId)` puts each row back
(refused after 30 days). A merge is not on the Cmd+Z stack.

## Sample data

Onboarding screen 3 offers "Show me an example" (and the command `remove-sample-data`).
Ten sample sets, one per trade preset including "Something else"
(`src/features/onboarding/sample/`), covering companies, contacts, deals, activities, tasks
and optional documents (`SampleDocument`, status `sent` or `paid`; a paid one carries how many
days ago the money arrived and a method).
Every row a load writes gets a link to one tag named `Sample` (`SAMPLE_TAG`), so removal
never guesses which rows were the example. The base rows (company, contact, deal, activity, task, tags, links) load in one
transaction built from statements. Deal pricing lines and the documents (and a paid document's
payment) are then raised afterwards through the repositories (`createFromDeal`, `send`,
`recordFullPayment`), each as its own write, and a failure there is logged and skipped rather
than undoing the load. Removal is one transaction and is a purge, not a soft delete. Today shows the way out of the sample data even when the workspace is otherwise
non-empty. Trade presets (`src/features/onboarding/presets/*.ts`) supply vocabulary, stages
with quiet days and won/lost flags, sources, custom fields, and a price list.

## Other data-bearing features

- Saved views: named filter and sort per entity type, optionally pinned to the sidebar.
  Library in `src/features/today/views`; Contacts is the reference adoption
  (`ViewsToolbar`, `queryFromState`, `stateFromQuery`). A pinned view arrives as `?view=<id>`.
- Message templates: `{{first_name}}`, `{{last_name}}`, `{{company}}`, `{{deal_title}}`,
  `{{deal_value}}`, `{{owner_name}}`, `{{business_name}}` only (`MERGE_FIELDS`); no filters or
  expressions; rendered at send time (`src/features/templates/lib/merge.ts`).
- Attachments: copied next to the data; images show a thumbnail through the asset protocol.
- Reports (`src/db/repos/reports.ts`, `sourceReport.ts`): pipeline value by stage, wins and
  losses over time, leads by source (count, win rate, won value, time to close), conversion
  between stages, average time in stage; revenue figures from `money.ts`; receivables aging;
  each with a period picker (`src/lib/periods.ts`).
- Optional AI (`src/features/ai`): settings keys `aiEnabled`, `aiModel`, `aiKeyState`,
  `aiKeySuffix`, `aiBaseUrl`; buttons stay visible but disabled with a one-line reason when off
  or when the key is missing or rejected.

Verified against: `drizzle/0000_init.sql` to `0009_visit_note.sql`,
`drizzle/meta/*_snapshot.json`, `src/db/repos/{money,documents,payments,receivables,trash,
merge,automations,deals,dealItems,tasks,recurring,settings,seed,bulk}.ts`,
`src/db/changeLog.ts`, `src/lib/vocabulary.ts`, `src/features/schedule/lib/{feed,types,week}.ts`,
`src/features/leads/poller.ts`, `src/features/leads/lib/{applyLeads,backoff,leadsFetch}.ts`,
`src/features/settings/lib/automationBoot.ts`, `src/features/data/import/fields/*.ts`,
`src/features/data/lib/{importRun,filePick,exportRun,exportCsv,retention}.ts`,
`src/features/data/trash/purgeSweep.ts`, `src/features/onboarding/{presets,sample,lib}`,
`src/features/templates/lib/merge.ts`, `src-tauri/src/{files,leads}.rs`,
`docs/CONTRACTS.md` "Payments, schedule and automations", `docs/LAUNCH-ACCEPTANCE.md`,
`tests/fixtures/README.md`.
