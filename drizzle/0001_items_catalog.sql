CREATE TABLE `brand_item_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`changed_at` text DEFAULT (datetime('now')) NOT NULL,
	`change_type` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`source_run_id` integer,
	FOREIGN KEY (`item_id`) REFERENCES `brand_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`external_id` text,
	`source_url` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`tier_classification` text DEFAULT 'unclassified' NOT NULL,
	`tier_inferred_by` text,
	`tier_rationale` text,
	`base_price_usd` real,
	`per_size_data_json` text DEFAULT '{}' NOT NULL,
	`first_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_verified_at` text DEFAULT (datetime('now')) NOT NULL,
	`is_discontinued` integer DEFAULT false NOT NULL,
	`discontinued_at` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_items_brand_url_unique` ON `brand_items` (`brand_id`,`source_url`);