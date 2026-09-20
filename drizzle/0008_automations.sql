-- Automations: three fixed rules plus per-stage follow-ups (PX-4, PX-1C).
--
-- Coordinator decision PX-4 is binding: an automation runs SYNCHRONOUSLY
-- inside the write that triggers it (a lead arriving, a quote being sent, a
-- deal moving stage, the daily overdue sweep) and creates an ordinary task.
-- There is no job queue and no background scheduler beyond what already
-- exists. `automations` is the switchboard: one row per fixed rule, enabled
-- or not, with the delay and the title the owner can edit in Settings.
--
-- `automation_runs` is why this migration adds a second table instead of one
-- flag on `tasks`. A rule must fire once and only once for a given subject -
-- the same lead cannot get two "call them" tasks because the write retried,
-- and the same quote cannot get two follow-ups because it was opened twice.
-- Three reasons that marker cannot live on `tasks`, all of them permanent:
--
--   1. the marker must survive the owner deleting the task the rule created.
--      A soft-deleted or purged task is still a task the rule already fired
--      for - `tasks` is owned by Lead B and a purge already removes the row
--      outright (`_base.purgeRow`), which would erase the "already ran" fact
--      along with the task and let the rule fire again.
--   2. it must not depend on the rendered title. The owner can rename any
--      task after the fact ("Call Dana Reyes" -> "Call Dana back"), and a
--      lookup keyed on title text would stop recognising its own task the
--      moment he edits it, or worse, collide with an unrelated task he typed
--      by hand with the same wording.
--   3. a `tasks` column shared between three unrelated rule kinds (lead
--      arrival, quote sent, per-stage) would need three different subject
--      shapes in one place Lead B does not own the meaning of. A dedicated
--      ledger keyed on (kind, subject_id) says exactly what fired and for
--      what, independent of the task's own lifecycle.
--
-- The idempotency guard is `idx_automation_runs_unique` on (kind, subject_id),
-- checked by every runner before it does any work and relied on as the real
-- guard under a race: the runner's SELECT is a fast path, the unique index is
-- what makes a second, concurrent attempt fail outright rather than double-
-- fire (docs/CONTRACTS.md, write-lock notes on why a check-then-write alone
-- is never enough).
ALTER TABLE `stages` ADD COLUMN `follow_up_days` integer;--> statement-breakpoint
ALTER TABLE `stages` ADD COLUMN `follow_up_title` text;--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL UNIQUE,
	`enabled` integer DEFAULT 0 NOT NULL,
	`delay_minutes` integer DEFAULT 0 NOT NULL,
	`title_template` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "ck_automations_kind" CHECK("automations"."kind" IN ('lead_arrived', 'quote_sent', 'invoice_overdue'))
);
--> statement-breakpoint
-- Seeded idempotently with INSERT ... SELECT ... WHERE NOT EXISTS rather than
-- INSERT OR IGNORE: this repository's migrations are checked statement by
-- statement (tests/repo/migrations.test.ts) against the set of transaction-
-- safe DDL/DML forms every other migration already uses, and this form is one
-- of them. A second application of this file (which never happens in
-- practice - `schema_migrations` marks a tag done - but is what makes the
-- statement itself idempotent rather than merely "run once by convention")
-- inserts nothing the second time, exactly as OR IGNORE would.
INSERT INTO `automations` (`id`, `kind`, `enabled`, `delay_minutes`, `title_template`, `created_at`, `updated_at`)
SELECT 'auto_lead_arrived', 'lead_arrived', 1, 60, 'Call {name} about their request',
	strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM `automations` WHERE `kind` = 'lead_arrived');
--> statement-breakpoint
INSERT INTO `automations` (`id`, `kind`, `enabled`, `delay_minutes`, `title_template`, `created_at`, `updated_at`)
SELECT 'auto_quote_sent', 'quote_sent', 1, 4320, 'Follow up on quote {number} with {name}',
	strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM `automations` WHERE `kind` = 'quote_sent');
--> statement-breakpoint
INSERT INTO `automations` (`id`, `kind`, `enabled`, `delay_minutes`, `title_template`, `created_at`, `updated_at`)
SELECT 'auto_invoice_overdue', 'invoice_overdue', 0, 4320, 'Invoice {number} is overdue: check in with {name}',
	strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM `automations` WHERE `kind` = 'invoice_overdue');
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`task_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_runs_unique` ON `automation_runs` (`kind`,`subject_id`);
