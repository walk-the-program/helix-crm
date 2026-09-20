-- Revenue: the services catalog, deal line items, quotes and invoices (D20).
--
-- Generated from src/db/schema.ts by drizzle-kit, the same way 0003 was, so the
-- snapshot in drizzle/meta stays honest and the next generate diffs against the
-- real shape rather than re-creating these tables.
--
-- products: what the business sells, with the price it usually charges. kind is
-- 'one_time' or 'recurring'; a recurring service carries interval 'month' or
-- 'year' and a one-time service leaves it NULL. The price is the SUGGESTED
-- price - a deal line copies it and the owner may override the copy, which is
-- what makes a discount visible instead of lost.
--
-- deal_items: one line of what a deal is for. It copies the product's name,
-- kind, interval and price rather than reading through the reference, because a
-- price list changes and a deal agreed at last year's price is still that deal.
-- product_id is ON DELETE SET NULL for the same reason.
--
-- deals gains five nullable columns. value_cents stays the deal's one stored
-- number and is now defined as the ANNUAL value: one_time_cents + 12 x
-- recurring_monthly_cents, rewritten by dealItems.recompute in the same
-- transaction as any line change. Everything that already sorts, filters, sums
-- or charts on value_cents keeps working. recurring_monthly_cents is
-- normalised: a yearly line is divided by 12 and rounded, so MRR is one sum
-- with no CASE in it. They are nullable with a 0/NULL default because they
-- arrive on a table that already holds rows.
--
-- documents: a quote or an invoice, one table and two kinds, because they are
-- the same document with different words and a different status set (quote:
-- draft/sent/accepted/declined; invoice: draft/sent/paid/void). number is
-- unique per kind and comes from document_sequences - a counter row rather than
-- max(number)+1, because the numbers carry a prefix and a voided invoice must
-- not hand its number back out. Tax is basis points (1% = 100) so no float ever
-- touches money.
--
-- document_items deliberately carry no stamps and no reference back to
-- deal_items: a document records what was sent, and editing the deal afterwards
-- must not rewrite a document somebody already has.
--
-- invoice_schedules: "bill this deal every month". Like recurring_rules,
-- next_issue_on is the only state and nothing runs in the background, so a
-- workspace closed for a year is correct the moment it opens.

CREATE TABLE `deal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`product_id` text,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'one_time' NOT NULL,
	`interval` text,
	`qty` integer DEFAULT 1 NOT NULL,
	`suggested_unit_cents` integer DEFAULT 0 NOT NULL,
	`actual_unit_cents` integer DEFAULT 0 NOT NULL,
	`taxable` integer DEFAULT false NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deal_items_deal_id` ON `deal_items` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_deal_items_product_id` ON `deal_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_deal_items_position` ON `deal_items` (`position`);--> statement-breakpoint
CREATE INDEX `idx_deal_items_deleted_at` ON `deal_items` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `document_items` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`qty` integer DEFAULT 1 NOT NULL,
	`unit_cents` integer DEFAULT 0 NOT NULL,
	`taxable` integer DEFAULT false NOT NULL,
	`kind` text DEFAULT 'one_time' NOT NULL,
	`interval` text,
	`position` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_items_document_id` ON `document_items` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_items_position` ON `document_items` (`position`);--> statement-breakpoint
CREATE TABLE `document_sequences` (
	`kind` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`number` text NOT NULL,
	`deal_id` text,
	`contact_id` text,
	`company_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`issued_on` text,
	`due_on` text,
	`valid_until` text,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`payment_instructions` text,
	`converted_to_id` text,
	`sent_at` text,
	`paid_on` text,
	`paid_method` text,
	`paid_note` text,
	`pdf_path` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_documents_kind_status` ON `documents` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `idx_documents_deal_id` ON `documents` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_contact_id` ON `documents` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_company_id` ON `documents` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_due_on` ON `documents` (`due_on`);--> statement-breakpoint
CREATE INDEX `idx_documents_deleted_at` ON `documents` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_documents_kind_number` ON `documents` (`kind`,`number`);--> statement-breakpoint
CREATE TABLE `invoice_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`interval` text DEFAULT 'month' NOT NULL,
	`next_issue_on` text NOT NULL,
	`last_issued_on` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_invoice_schedules_deal_id` ON `invoice_schedules` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_invoice_schedules_next_issue_on` ON `invoice_schedules` (`next_issue_on`);--> statement-breakpoint
CREATE INDEX `idx_invoice_schedules_active` ON `invoice_schedules` (`active`);--> statement-breakpoint
CREATE INDEX `idx_invoice_schedules_deleted_at` ON `invoice_schedules` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'one_time' NOT NULL,
	`interval` text,
	`unit_price_cents` integer DEFAULT 0 NOT NULL,
	`taxable` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_products_kind` ON `products` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_products_active` ON `products` (`active`);--> statement-breakpoint
CREATE INDEX `idx_products_position` ON `products` (`position`);--> statement-breakpoint
CREATE INDEX `idx_products_deleted_at` ON `products` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `deals` ADD `one_time_cents` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `deals` ADD `recurring_monthly_cents` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `deals` ADD `recurring_started_on` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `recurring_ended_on` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `suggested_total_cents` integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX `idx_deals_recurring_started_on` ON `deals` (`recurring_started_on`);--> statement-breakpoint
CREATE INDEX `idx_deals_recurring_ended_on` ON `deals` (`recurring_ended_on`);
