CREATE TABLE `sales_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`request_type` text NOT NULL,
	`company_name` text NOT NULL,
	`contact_name` text NOT NULL,
	`email` text NOT NULL,
	`phone_or_line` text,
	`monthly_volume` text,
	`note` text,
	`source` text DEFAULT 'landing' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sales_leads_status_created` ON `sales_leads` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sales_leads_email_created` ON `sales_leads` (`email`,`created_at`);