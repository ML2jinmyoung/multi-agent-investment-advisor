CREATE TABLE `ledger_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`broker` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'brokerage' NOT NULL,
	`cash_krw` real DEFAULT 0 NOT NULL,
	`cash_usd` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_accounts_user_idx` ON `ledger_accounts` (`user_id`);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real,
	`fee` real,
	`traded_at` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`voided_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_user_idx` ON `ledger_entries` (`user_id`);
