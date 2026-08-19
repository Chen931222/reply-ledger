CREATE TABLE `line_outbound_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`target_id` text NOT NULL,
	`message_text` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_email` text,
	`status` text NOT NULL,
	`line_request_id` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_line_outbound_request_id` ON `line_outbound_messages` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_line_outbound_target_created` ON `line_outbound_messages` (`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `line_webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`webhook_event_id` text NOT NULL,
	`destination` text NOT NULL,
	`event_type` text NOT NULL,
	`source_type` text,
	`source_id` text,
	`event_timestamp` integer NOT NULL,
	`is_redelivery` integer DEFAULT false NOT NULL,
	`message_type` text,
	`message_id` text,
	`message_text` text,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_line_events_webhook_event_id` ON `line_webhook_events` (`webhook_event_id`);--> statement-breakpoint
CREATE INDEX `idx_line_events_timestamp` ON `line_webhook_events` (`event_timestamp`);--> statement-breakpoint
CREATE INDEX `idx_line_events_source_timestamp` ON `line_webhook_events` (`source_id`,`event_timestamp`);
--> statement-breakpoint
PRAGMA optimize;
