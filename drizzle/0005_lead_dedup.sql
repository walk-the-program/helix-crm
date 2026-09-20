-- Idempotency for the lead poller (F-SEC-28, LR-OPS-W2).
--
-- src/features/leads/lib/applyLeads.ts has always decided "already have this
-- lead" by reading deals.external_id and writing only if nothing came back.
-- That is safe only because the app's single write lock happens to serialise
-- every writer that could race it - there was never a constraint that made a
-- duplicate impossible on its own. This migration adds one.
--
-- Existing data comes first. A workspace can already hold two LIVE deals that
-- share one external_id - most plausibly from the write-lock hole this same
-- packet's tests reproduce (src/db/writeLock.ts's module-level `txDepth`
-- lets an unrelated concurrent withTransaction skip the lock entirely when
-- another one is mid-transaction; see tests/repo/leads/pollerRace.test.ts).
-- A bare CREATE UNIQUE INDEX on such a workspace would fail outright, and a
-- failed migration is fatal to boot (src/db/migrator.ts treats it as an
-- all-or-nothing batch) - so the index cannot go in until any existing
-- violation is gone.
--
-- The rule: for each external_id with more than one live deal, keep the
-- OLDEST (created_at ASC, id ASC as a tie-break when two rows share an
-- instant) and soft-delete every later duplicate into the Trash. Nothing is
-- hard-deleted and nothing is merged - a merge would mean choosing which
-- edits and which activity timeline survive, and that is a product decision
-- this migration cannot make safely (LR-OPS-W2 packet, "STOP/ESCALATE" -
-- implement the most conservative option and flag it). The owner keeps every
-- record and can restore a wrongly-chosen duplicate out of Trash by hand; the
-- 30-day purge sweep is the only thing that ever makes this soft-delete
-- permanent, exactly like any other deleted deal.
UPDATE `deals`
SET `deleted_at` = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    `updated_at` = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
WHERE `deleted_at` IS NULL
  AND `external_id` IS NOT NULL
  AND `id` NOT IN (
    SELECT `id` FROM (
      SELECT `id`,
             ROW_NUMBER() OVER (
               PARTITION BY `external_id`
               ORDER BY `created_at` ASC, `id` ASC
             ) AS rn
      FROM `deals`
      WHERE `deleted_at` IS NULL AND `external_id` IS NOT NULL
    ) AS ranked
    WHERE rn = 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deals_external_id_unique` ON `deals` (`external_id`) WHERE "deals"."external_id" is not null and "deals"."deleted_at" is null;
