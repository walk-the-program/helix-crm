-- Payments as records (LR-PX decision PX-5).
--
-- Before this, an invoice was paid or it was not: `documents.status = 'paid'`
-- plus `paid_on`, `paid_method` and `paid_note`. `grep -rn payments src` came
-- back empty. That model cannot hold the two things a trade owner does every
-- week - take a deposit before the job and the balance after, and be paid in
-- four different ways on the same job - so both went into a spreadsheet next
-- to the CRM. A deposit needed two invoices (ruling R7), and "Collected" was
-- the total of the paid invoices rather than the money that actually landed.
--
-- The table is deliberately narrow: an amount, a day, how it was paid, a
-- reference and a note, hung off the invoice. `deal_id` is copied from the
-- document so the per-job money query needs one join fewer; the document
-- stays the truth. Both CHECK constraints are at the table because a bad
-- amount or an unknown method would otherwise reach the Revenue report.
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`deal_id` text,
	`amount_cents` integer NOT NULL,
	`paid_on` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_payments_amount_positive" CHECK("payments"."amount_cents" > 0),
	CONSTRAINT "ck_payments_method" CHECK("payments"."method" IN ('cash', 'check', 'card', 'transfer', 'other'))
);
--> statement-breakpoint
CREATE INDEX `idx_payments_document_id` ON `payments` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_deal_id` ON `payments` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_paid_on` ON `payments` (`paid_on`);--> statement-breakpoint
CREATE INDEX `idx_payments_deleted_at` ON `payments` (`deleted_at`);--> statement-breakpoint
-- The backfill, and the reason this migration is safe to run on a workspace
-- that has been invoicing for a year.
--
-- Every figure the product calls Collected becomes the sum of payments the
-- moment this lands. An existing workspace has no payments, so without this
-- INSERT every Revenue report, every deal strip and every customer card would
-- read $0 collected the first time the owner opened the app after upgrading -
-- the single worst thing a CRM upgrade can do to a money number. One payment
-- per already-paid invoice, for its own total, on its own `paid_on`, makes
-- every figure identical before and after; `tests/repo/payments/backfill.test.ts`
-- seeds a workspace on 0005, runs 0006, and compares money.ts figure by figure.
--
-- `method` is 'other' rather than `paid_method`, which is free text the owner
-- typed ("Venmo", "check 4412") and would fail the method CHECK. It is kept in
-- the note instead, so nothing he wrote is lost.
--
-- Soft-deleted invoices are backfilled too. Their money is excluded by the
-- queries, which all join `documents` and test `d.deleted_at IS NULL`, so
-- including them changes no figure and means restoring an invoice out of the
-- Trash brings its payment back with it.
--
-- An invoice with a zero or negative total is skipped: the CHECK forbids a
-- zero payment, and a zero-total invoice contributes zero to Collected either
-- way, so the numbers still match.
--
-- The id is UUID-v7-shaped by hand, because SQLite has no uuid function: the
-- first 48 bits are the invoice's own `created_at` in milliseconds, so the
-- backfilled rows sort in creation order exactly like every id the app mints,
-- and the rest is `randomblob`. A `created_at` SQLite cannot parse yields the
-- all-zero prefix, which is still unique because of the random tail.
INSERT INTO `payments` (
	`id`, `document_id`, `deal_id`, `amount_cents`, `paid_on`,
	`method`, `reference`, `note`, `created_at`, `updated_at`, `deleted_at`
)
SELECT
	lower(
		substr(printf('%012x', CAST((julianday(`d`.`created_at`) - 2440587.5) * 86400000.0 AS INTEGER)), 1, 8) || '-' ||
		substr(printf('%012x', CAST((julianday(`d`.`created_at`) - 2440587.5) * 86400000.0 AS INTEGER)), 9, 4) || '-7' ||
		substr(hex(randomblob(2)), 2, 3) || '-' ||
		substr('89ab', (abs(random()) % 4) + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
		hex(randomblob(6))
	),
	`d`.`id`,
	`d`.`deal_id`,
	`d`.`total_cents`,
	`d`.`paid_on`,
	'other',
	NULL,
	CASE
		WHEN `d`.`paid_method` IS NOT NULL AND trim(`d`.`paid_method`) <> ''
			THEN 'Recorded before payments existed (' || trim(`d`.`paid_method`) || ')'
		ELSE 'Recorded before payments existed'
	END,
	`d`.`updated_at`,
	`d`.`updated_at`,
	NULL
FROM `documents` `d`
WHERE `d`.`kind` = 'invoice'
  AND `d`.`status` = 'paid'
  AND `d`.`paid_on` IS NOT NULL
  AND `d`.`total_cents` > 0;
