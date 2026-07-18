CREATE TABLE `daily_usage` (
	`user_email` text NOT NULL,
	`bucket` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_email`, `bucket`, `day`)
);
--> statement-breakpoint
CREATE TABLE `user_states` (
	`user_email` text PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
