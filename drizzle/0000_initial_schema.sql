CREATE TABLE `admin_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_token_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_session_token_hash_unique` ON `admin_sessions` (`session_token_hash`);--> statement-breakpoint
CREATE TABLE `brand_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`url` text NOT NULL,
	`source_type` text NOT NULL,
	`cadence_seconds_override` integer,
	`last_etag` text,
	`last_modified_header` text,
	`last_fetch_hash` text,
	`last_fetched_at` text,
	`last_changed_at` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_sources_brand_url_unique` ON `brand_sources` (`brand_id`,`url`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`primary_url` text NOT NULL,
	`category_tag` text DEFAULT 'running' NOT NULL,
	`audience_tags` text DEFAULT '[]' NOT NULL,
	`current_size_chart_version_id` integer,
	`divergence_flag` integer DEFAULT false NOT NULL,
	`predicted_next_change_at` text,
	`cadence_learned_at` text,
	`observed_change_intervals` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_slug_unique` ON `brands` (`slug`);--> statement-breakpoint
CREATE TABLE `brand_size_chart_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`brand_source_id` integer NOT NULL,
	`extracted_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_run_id` integer,
	`size_chart_json` text NOT NULL,
	`confidence_score` real NOT NULL,
	`confidence_breakdown_json` text NOT NULL,
	`status` text NOT NULL,
	`accepted_at` text,
	`accepted_by` text,
	`rejection_reason` text,
	`supersedes_version_id` integer,
	`delta_from_prior_json` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `brand_size_chart_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `brand_score_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`computed_at` text DEFAULT (datetime('now')) NOT NULL,
	`scoring_config_version` text NOT NULL,
	`cohort_summary_id` integer NOT NULL,
	`scores_json` text NOT NULL,
	`inputs_json` text NOT NULL,
	FOREIGN KEY (`cohort_summary_id`) REFERENCES `cohort_summaries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `brand_score_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`snapshot_at` text DEFAULT (datetime('now')) NOT NULL,
	`promoted_from_history_id` integer NOT NULL,
	`cohort_summary_id` integer NOT NULL,
	`scores_json` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`promoted_from_history_id`) REFERENCES `brand_score_history`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cohort_summary_id`) REFERENCES `cohort_summaries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cohort_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`computed_at` text DEFAULT (datetime('now')) NOT NULL,
	`scoring_config_version` text NOT NULL,
	`brand_count` integer NOT NULL,
	`summary_json` text NOT NULL,
	`trigger` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_usage_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`run_id` integer,
	`units_used` real NOT NULL,
	`units_kind` text NOT NULL,
	`estimated_cost_usd` real NOT NULL,
	`occurred_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`scheduled_for` text DEFAULT (datetime('now')) NOT NULL,
	`picked_at` text,
	`heartbeat_at` text,
	`heartbeat_interval_secs` integer,
	`finished_at` text,
	`error_json` text,
	`run_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key_unique` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `run_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_path` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`summary_json` text,
	`cost_usd_estimate` real,
	`firecrawl_pages_used` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
