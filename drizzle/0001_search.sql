-- Custom migration: external-content FTS5 search (docs/PLAN.md item 7).
--
--   contacts ---+
--   phones -----+--> (rebuild trigger) --> search_docs --(content triggers)--> search_index
--   emails -----+                              ^                                   |
--   companies --+                              |                                   v
--   deals ------+                    one row per live entity            MATCH, join back on rowid
--   activities -+
--
-- Triggers own search_docs entirely: every AFTER INSERT/UPDATE deletes the
-- entity's row and re-inserts it only WHERE deleted_at IS NULL, so a soft
-- delete removes it from search and a restore brings it back with no
-- repository code involved.

CREATE TABLE `search_docs` (
	`rowid` INTEGER PRIMARY KEY,
	`entity_type` TEXT NOT NULL,
	`entity_id` TEXT NOT NULL,
	`text` TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_docs_entity` ON `search_docs` (`entity_type`,`entity_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(
	text,
	content='search_docs',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint

-- the three standard external-content sync triggers ------------------------
CREATE TRIGGER `search_docs_ai` AFTER INSERT ON `search_docs` BEGIN
	INSERT INTO `search_index`(`rowid`, `text`) VALUES (new.`rowid`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_docs_ad` AFTER DELETE ON `search_docs` BEGIN
	INSERT INTO `search_index`(`search_index`, `rowid`, `text`) VALUES ('delete', old.`rowid`, old.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_docs_au` AFTER UPDATE ON `search_docs` BEGIN
	INSERT INTO `search_index`(`search_index`, `rowid`, `text`) VALUES ('delete', old.`rowid`, old.`text`);
	INSERT INTO `search_index`(`rowid`, `text`) VALUES (new.`rowid`, new.`text`);
END;
--> statement-breakpoint

-- contacts: name + company name + every phone (raw and e164) + every email --
CREATE TRIGGER `search_contacts_ai` AFTER INSERT ON `contacts` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = new.`id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_contacts_au` AFTER UPDATE ON `contacts` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = new.`id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_contacts_ad` AFTER DELETE ON `contacts` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = old.`id`;
END;
--> statement-breakpoint

-- contact_phones: any change rebuilds the parent contact's row -------------
CREATE TRIGGER `search_contact_phones_ai` AFTER INSERT ON `contact_phones` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = new.`contact_id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = new.`contact_id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_contact_phones_au` AFTER UPDATE ON `contact_phones` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = new.`contact_id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = new.`contact_id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_contact_phones_ad` AFTER DELETE ON `contact_phones` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = old.`contact_id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = old.`contact_id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint

-- contact_emails: same rebuild -------------------------------------------
CREATE TRIGGER `search_contact_emails_ai` AFTER INSERT ON `contact_emails` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = new.`contact_id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = new.`contact_id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_contact_emails_au` AFTER UPDATE ON `contact_emails` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = new.`contact_id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = new.`contact_id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_contact_emails_ad` AFTER DELETE ON `contact_emails` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact' AND `entity_id` = old.`contact_id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`id` = old.`contact_id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint

-- companies: own row, and every contact that names this company -----------
CREATE TRIGGER `search_companies_ai` AFTER INSERT ON `companies` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'company' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'company', co.`id`, trim(
		coalesce(co.`name`, '') || ' ' || coalesce(co.`website`, '') || ' ' ||
		coalesce(co.`phone_raw`, '') || ' ' || coalesce(co.`phone_e164`, '') || ' ' ||
		coalesce(co.`notes`, '')
	)
	FROM `companies` co WHERE co.`id` = new.`id` AND co.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_companies_au` AFTER UPDATE ON `companies` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'company' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'company', co.`id`, trim(
		coalesce(co.`name`, '') || ' ' || coalesce(co.`website`, '') || ' ' ||
		coalesce(co.`phone_raw`, '') || ' ' || coalesce(co.`phone_e164`, '') || ' ' ||
		coalesce(co.`notes`, '')
	)
	FROM `companies` co WHERE co.`id` = new.`id` AND co.`deleted_at` IS NULL;
	DELETE FROM `search_docs` WHERE `entity_type` = 'contact'
		AND `entity_id` IN (SELECT `id` FROM `contacts` WHERE `company_id` = new.`id`);
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'contact', c.`id`, trim(
		coalesce(c.`first_name`, '') || ' ' || coalesce(c.`last_name`, '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = c.`company_id`), '') || ' ' ||
		coalesce((SELECT group_concat(p.`raw` || ' ' || coalesce(p.`e164`, ''), ' ') FROM `contact_phones` p WHERE p.`contact_id` = c.`id` AND p.`deleted_at` IS NULL), '') || ' ' ||
		coalesce((SELECT group_concat(e.`email_lower`, ' ') FROM `contact_emails` e WHERE e.`contact_id` = c.`id` AND e.`deleted_at` IS NULL), '') || ' ' ||
		coalesce(c.`notes`, '')
	)
	FROM `contacts` c WHERE c.`company_id` = new.`id` AND c.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_companies_ad` AFTER DELETE ON `companies` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'company' AND `entity_id` = old.`id`;
END;
--> statement-breakpoint

-- deals ------------------------------------------------------------------
CREATE TRIGGER `search_deals_ai` AFTER INSERT ON `deals` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'deal' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'deal', d.`id`, trim(
		coalesce(d.`title`, '') || ' ' ||
		coalesce((SELECT c.`first_name` || ' ' || c.`last_name` FROM `contacts` c WHERE c.`id` = d.`contact_id`), '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = d.`company_id`), '') || ' ' ||
		coalesce(d.`outcome_reason`, '')
	)
	FROM `deals` d WHERE d.`id` = new.`id` AND d.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_deals_au` AFTER UPDATE ON `deals` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'deal' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'deal', d.`id`, trim(
		coalesce(d.`title`, '') || ' ' ||
		coalesce((SELECT c.`first_name` || ' ' || c.`last_name` FROM `contacts` c WHERE c.`id` = d.`contact_id`), '') || ' ' ||
		coalesce((SELECT co.`name` FROM `companies` co WHERE co.`id` = d.`company_id`), '') || ' ' ||
		coalesce(d.`outcome_reason`, '')
	)
	FROM `deals` d WHERE d.`id` = new.`id` AND d.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_deals_ad` AFTER DELETE ON `deals` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'deal' AND `entity_id` = old.`id`;
END;
--> statement-breakpoint

-- activities --------------------------------------------------------------
CREATE TRIGGER `search_activities_ai` AFTER INSERT ON `activities` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'activity' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'activity', a.`id`, trim(coalesce(a.`kind`, '') || ' ' || coalesce(a.`body`, ''))
	FROM `activities` a WHERE a.`id` = new.`id` AND a.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_activities_au` AFTER UPDATE ON `activities` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'activity' AND `entity_id` = new.`id`;
	INSERT INTO `search_docs` (`entity_type`, `entity_id`, `text`)
	SELECT 'activity', a.`id`, trim(coalesce(a.`kind`, '') || ' ' || coalesce(a.`body`, ''))
	FROM `activities` a WHERE a.`id` = new.`id` AND a.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_activities_ad` AFTER DELETE ON `activities` BEGIN
	DELETE FROM `search_docs` WHERE `entity_type` = 'activity' AND `entity_id` = old.`id`;
END;
