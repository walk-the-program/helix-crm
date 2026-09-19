CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`contact_id` text,
	`company_id` text,
	`deal_id` text,
	`is_system` integer DEFAULT false NOT NULL,
	`actor_id` text DEFAULT 'owner' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_activities_contact_id` ON `activities` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_activities_company_id` ON `activities` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_activities_deal_id` ON `activities` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_activities_occurred_at` ON `activities` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_activities_deleted_at` ON `activities` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`file_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_entity` ON `attachments` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_deleted_at` ON `attachments` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor_id` text DEFAULT 'owner' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`batch_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_change_log_entity` ON `change_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_change_log_batch_id` ON `change_log` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_change_log_at` ON `change_log` (`at`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`phone_e164` text,
	`phone_raw` text,
	`address_json` text,
	`source_id` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_companies_source_id` ON `companies` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_companies_deleted_at` ON `companies` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_companies_name` ON `companies` (`name`);--> statement-breakpoint
CREATE INDEX `idx_companies_phone_e164` ON `companies` (`phone_e164`);--> statement-breakpoint
CREATE TABLE `contact_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`email_lower` text NOT NULL,
	`label` text DEFAULT 'work' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contact_emails_contact_id` ON `contact_emails` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_emails_email_lower` ON `contact_emails` (`email_lower`);--> statement-breakpoint
CREATE INDEX `idx_contact_emails_deleted_at` ON `contact_emails` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `contact_phones` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`raw` text NOT NULL,
	`e164` text,
	`label` text DEFAULT 'mobile' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contact_phones_contact_id` ON `contact_phones` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_phones_e164` ON `contact_phones` (`e164`);--> statement-breakpoint
CREATE INDEX `idx_contact_phones_deleted_at` ON `contact_phones` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`company_id` text,
	`address_json` text,
	`source_id` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_company_id` ON `contacts` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_contacts_source_id` ON `contacts` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_contacts_deleted_at` ON `contacts` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_contacts_last_name` ON `contacts` (`last_name`);--> statement-breakpoint
CREATE TABLE `custom_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`options_json` text,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_custom_fields_entity_type` ON `custom_fields` (`entity_type`);--> statement-breakpoint
CREATE INDEX `idx_custom_fields_position` ON `custom_fields` (`position`);--> statement-breakpoint
CREATE INDEX `idx_custom_fields_deleted_at` ON `custom_fields` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `custom_values` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`value_text` text,
	`value_num` real,
	`value_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`field_id`) REFERENCES `custom_fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_custom_values_field_id` ON `custom_values` (`field_id`);--> statement-breakpoint
CREATE INDEX `idx_custom_values_entity_id` ON `custom_values` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_custom_values_deleted_at` ON `custom_values` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `deal_stage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`from_stage_id` text,
	`to_stage_id` text NOT NULL,
	`at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_deal_stage_events_deal_id_at` ON `deal_stage_events` (`deal_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_deal_stage_events_from_stage_id` ON `deal_stage_events` (`from_stage_id`);--> statement-breakpoint
CREATE INDEX `idx_deal_stage_events_to_stage_id` ON `deal_stage_events` (`to_stage_id`);--> statement-breakpoint
CREATE INDEX `idx_deal_stage_events_deleted_at` ON `deal_stage_events` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`value_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`stage_id` text NOT NULL,
	`stage_entered_at` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`contact_id` text,
	`company_id` text,
	`source_id` text,
	`external_id` text,
	`expected_on` text,
	`closed_at` text,
	`outcome_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deals_stage_id` ON `deals` (`stage_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_stage_entered_at` ON `deals` (`stage_entered_at`);--> statement-breakpoint
CREATE INDEX `idx_deals_position` ON `deals` (`position`);--> statement-breakpoint
CREATE INDEX `idx_deals_contact_id` ON `deals` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_company_id` ON `deals` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_source_id` ON `deals` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_external_id` ON `deals` (`external_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_deleted_at` ON `deals` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_deals_stage_position` ON `deals` (`stage_id`,`position`);--> statement-breakpoint
CREATE TABLE `lead_sync` (
	`site_origin` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`last_polled_at` text,
	`last_error` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merges` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`survivor_id` text NOT NULL,
	`loser_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`at` text NOT NULL,
	`reversed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_merges_survivor_id` ON `merges` (`survivor_id`);--> statement-breakpoint
CREATE INDEX `idx_merges_loser_id` ON `merges` (`loser_id`);--> statement-breakpoint
CREATE INDEX `idx_merges_batch_id` ON `merges` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_merges_at` ON `merges` (`at`);--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_pipelines_deleted_at` ON `pipelines` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`query_json` text DEFAULT '{}' NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_saved_views_entity_type` ON `saved_views` (`entity_type`);--> statement-breakpoint
CREATE INDEX `idx_saved_views_position` ON `saved_views` (`position`);--> statement-breakpoint
CREATE INDEX `idx_saved_views_deleted_at` ON `saved_views` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`version` text PRIMARY KEY NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_sources_deleted_at` ON `sources` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `stages` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`name` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`color` text DEFAULT 'var(--stage-1)' NOT NULL,
	`quiet_days` integer DEFAULT 14 NOT NULL,
	`is_won` integer DEFAULT false NOT NULL,
	`is_lost` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_stages_pipeline_id` ON `stages` (`pipeline_id`);--> statement-breakpoint
CREATE INDEX `idx_stages_position` ON `stages` (`position`);--> statement-breakpoint
CREATE INDEX `idx_stages_deleted_at` ON `stages` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `tag_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tag_links_tag_id` ON `tag_links` (`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_tag_links_entity` ON `tag_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_tag_links_deleted_at` ON `tag_links` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'var(--stage-1)' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_tags_name` ON `tags` (`name`);--> statement-breakpoint
CREATE INDEX `idx_tags_deleted_at` ON `tags` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`due_on` text,
	`due_at` text,
	`done_at` text,
	`contact_id` text,
	`company_id` text,
	`deal_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_due_on` ON `tasks` (`due_on`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due_at` ON `tasks` (`due_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_done_at` ON `tasks` (`done_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_contact_id` ON `tasks` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_company_id` ON `tasks` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_deal_id` ON `tasks` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_deleted_at` ON `tasks` (`deleted_at`);