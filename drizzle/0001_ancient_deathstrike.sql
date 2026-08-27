CREATE TABLE `line_conversations` (
	`source_id` text PRIMARY KEY NOT NULL,
	`source_type` text,
	`last_message_text` text,
	`last_message_direction` text NOT NULL,
	`last_message_at` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_line_conversations_activity` ON `line_conversations` (`last_message_at`);--> statement-breakpoint
CREATE INDEX `idx_line_conversations_status_activity` ON `line_conversations` (`status`,`last_message_at`);--> statement-breakpoint
WITH `all_messages` AS (
	SELECT
		`source_id`,
		`source_type`,
		COALESCE(`message_text`,
			CASE `message_type`
				WHEN 'image' THEN '［圖片］'
				WHEN 'video' THEN '［影片］'
				WHEN 'audio' THEN '［語音］'
				WHEN 'file' THEN '［檔案］'
				WHEN 'sticker' THEN '［貼圖］'
				WHEN 'location' THEN '［位置］'
				ELSE '［非文字訊息］'
			END
		) AS `message_text`,
		'inbound' AS `direction`,
		`event_timestamp` AS `message_timestamp`,
		`webhook_event_id` AS `stable_id`
	FROM `line_webhook_events`
	WHERE `source_id` IS NOT NULL
		AND `event_type` = 'message'
	UNION ALL
	SELECT
		`target_id` AS `source_id`,
		NULL AS `source_type`,
		`message_text`,
		'outbound' AS `direction`,
		CAST(strftime('%s', COALESCE(`sent_at`, `created_at`)) AS INTEGER) * 1000 AS `message_timestamp`,
		`request_id` AS `stable_id`
	FROM `line_outbound_messages`
	WHERE `status` = 'sent'
),
`ranked_messages` AS (
	SELECT *, ROW_NUMBER() OVER (
		PARTITION BY `source_id`
		ORDER BY `message_timestamp` DESC, `stable_id` DESC
	) AS `message_rank`
	FROM `all_messages`
)
INSERT INTO `line_conversations` (
	`source_id`, `source_type`, `last_message_text`, `last_message_direction`,
	`last_message_at`, `status`
)
SELECT
	`source_id`, `source_type`, `message_text`, `direction`, `message_timestamp`,
	CASE WHEN `direction` = 'inbound' THEN 'open' ELSE 'done' END
FROM `ranked_messages`
WHERE `message_rank` = 1;
