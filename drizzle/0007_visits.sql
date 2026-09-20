-- Visits: a task can carry a time, a place and how long it takes (PX-6).
--
-- Decision PX-6 is that a visit is not a new kind of record. A site visit, an
-- estimate or a job appointment is a TASK with a time on it - tasks already
-- have due_at, already link to a contact, a company and a deal, already appear
-- on Today and in Trash and in undo, and already carry a timeline entry. A
-- second table would have duplicated all of that and then disagreed with it.
--
-- Three nullable-or-defaulted columns, so every existing row stays valid:
--
--   source            who created the task. 'user' for anything a person typed,
--                     'automation' for a task a rule wrote (Lead C's
--                     speed-to-lead, quote-sent follow-ups, stage rules). It is
--                     NOT NULL with a default so the backfill is the default:
--                     SQLite writes 'user' into every existing row as it adds
--                     the column, which is the truth - nothing but a person has
--                     ever created a task in this product.
--   place             free text: where the visit is. Prefilled from the linked
--                     contact's or company's address when a visit is created,
--                     then editable, because the van goes where the owner says
--                     it goes and that is often not the billing address.
--   duration_minutes  how long to allow. Used by the schedule agenda and by the
--                     .ics export's DTEND. NULL means "no length given", which
--                     is what every task written before today means.
--
-- Indexed on source because Lead C lists automation-created tasks; due_at
-- already has its index from 0000_init, which is what the schedule range scan
-- uses.
ALTER TABLE `tasks` ADD COLUMN `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `place` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `duration_minutes` integer;--> statement-breakpoint
CREATE INDEX `idx_tasks_source` ON `tasks` (`source`);
