CREATE TABLE `run_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text,
	`rubric_key` text NOT NULL,
	`pass` integer NOT NULL,
	`labeler` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
