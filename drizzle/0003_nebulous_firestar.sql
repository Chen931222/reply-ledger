CREATE TABLE `conversation_internal_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`note_text` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_email` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_notes_source_created` ON `conversation_internal_notes` (`source_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `line_conversations` ADD `assigned_actor_id` text;--> statement-breakpoint
ALTER TABLE `line_conversations` ADD `assigned_actor_email` text;--> statement-breakpoint
ALTER TABLE `line_conversations` ADD `assigned_at` integer;--> statement-breakpoint
CREATE INDEX `idx_line_conversations_assignee_status_activity` ON `line_conversations` (`assigned_actor_id`,`status`,`last_message_at`);