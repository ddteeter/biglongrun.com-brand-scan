CREATE TABLE `brand_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`suggested_brand_name` text NOT NULL,
	`suggested_slug` text NOT NULL,
	`suggested_url` text,
	`source` text NOT NULL,
	`source_subreddit` text,
	`source_post_url` text,
	`source_post_title` text,
	`source_context` text,
	`plus_size_priority` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`suggested_at` text DEFAULT (datetime('now')) NOT NULL,
	`resolved_at` text,
	`resolved_brand_id` integer,
	`resolution_note` text,
	`rejection_reason` text,
	FOREIGN KEY (`resolved_brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_suggestions_pending_slug_unique` ON `brand_suggestions` (`suggested_slug`,`status`);