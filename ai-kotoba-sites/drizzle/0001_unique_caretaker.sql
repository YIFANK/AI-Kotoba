CREATE TABLE `shared_content` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `shared_content_creator_hash_idx` ON `shared_content` (`created_by`,`content_hash`);