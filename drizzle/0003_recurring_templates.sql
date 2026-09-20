-- Recurring service reminders and message templates (docs/PLAN.md D19).
--
-- Two plain tables, generated from src/db/schema.ts by drizzle-kit so the
-- snapshot in drizzle/meta stays honest and the next generate diffs against
-- the real shape rather than re-creating these tables.
--
-- recurring_rules: "remind me every spring" as a row. next_due_on is the only
-- state; there is no background timer, so a workspace that was closed for a
-- year is correct the moment it opens because the query is evaluated against
-- today. every_n + unit ('week' | 'month' | 'year') rather than an RRULE: an
-- owner setting "every 3 months" does not need RFC 5545, and a column pair can
-- be read in SQL. Both references are ON DELETE SET NULL, so purging a contact
-- leaves the reminder rather than a dangling id.
--
-- templates: kind is 'text' or 'email'; a text template has no subject. body
-- holds merge fields in double braces ({{first_name}}) and is rendered at send
-- time, so editing a template never changes what was already sent.

CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text,
	`company_id` text,
	`title` text NOT NULL,
	`every_n` integer DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'year' NOT NULL,
	`next_due_on` text NOT NULL,
	`last_completed_on` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_rules_contact_id` ON `recurring_rules` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_recurring_rules_company_id` ON `recurring_rules` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_recurring_rules_next_due_on` ON `recurring_rules` (`next_due_on`);--> statement-breakpoint
CREATE INDEX `idx_recurring_rules_active` ON `recurring_rules` (`active`);--> statement-breakpoint
CREATE INDEX `idx_recurring_rules_deleted_at` ON `recurring_rules` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`subject` text,
	`body` text DEFAULT '' NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_templates_kind` ON `templates` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_templates_position` ON `templates` (`position`);--> statement-breakpoint
CREATE INDEX `idx_templates_deleted_at` ON `templates` (`deleted_at`);
