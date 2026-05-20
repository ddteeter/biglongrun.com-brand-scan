CREATE TABLE `author_brand_assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`author_slug` text NOT NULL,
	`assessment_date` text DEFAULT (date('now')) NOT NULL,
	`ratings_json` text NOT NULL,
	`prose_markdown` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
