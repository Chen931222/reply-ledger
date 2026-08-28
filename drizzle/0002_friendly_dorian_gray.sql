CREATE TABLE `conversation_analyses` (
	`source_id` text PRIMARY KEY NOT NULL,
	`input_message_at` integer NOT NULL,
	`intent` text NOT NULL,
	`urgency` text NOT NULL,
	`risk` text NOT NULL,
	`confidence` integer NOT NULL,
	`observation` text NOT NULL,
	`rationale` text NOT NULL,
	`draft` text NOT NULL,
	`evidence_json` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor_id` text NOT NULL,
	`actor_email` text,
	`action` text NOT NULL,
	`case_id` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_audit_occurred` ON `workspace_audit_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `workspace_knowledge_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_by_email` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_rules_mode_active_updated` ON `workspace_knowledge_rules` (`mode`,`active`,`updated_at`);--> statement-breakpoint
INSERT INTO `workspace_knowledge_rules`
	(`id`, `mode`, `title`, `body`, `active`, `created_by`)
VALUES
	('SEED-RET-001', 'retail', '2026 零售價目表 · L-42', 'L-42 吊燈燈具售價為 NT$8,600；可調光版本另計。此價格不包含安裝費。', 1, 'system'),
	('SEED-RET-002', 'retail', '餐桌吊燈選型手冊 · §3', '燈體寬度通常建議約為餐桌寬度的三分之一至二分之一；餐桌情境可優先考慮 2700K–3000K 暖白光。實際比例仍需依空間與燈型確認。', 1, 'system'),
	('SEED-RET-003', 'retail', '安裝報價規則 · 現場確認', '未取得出線位置、天花板材質、固定方式或現場照片前，不提供安裝總價，也不承諾一定能以特定方式固定。', 1, 'system'),
	('SEED-CLI-001', 'clinic', '症狀觀察規則 · 不代替診斷', '回覆可以整理患者已描述的症狀與時間，但不得下診斷、保證無礙或取代醫師判斷。', 1, 'system'),
	('SEED-CLI-002', 'clinic', '用藥安全規則 · 不推算劑量', '資訊不足時不得推算兒童或成人藥物劑量；需請合格醫療人員依處方、年齡、體重與病史確認。', 1, 'system'),
	('SEED-CLI-003', 'clinic', '緊急徵象規則 · 立即轉介', '若訊息涉及呼吸困難、意識改變、嚴重過敏反應、持續大量出血或其他急性惡化徵象，應立即轉交真人並建議尋求緊急醫療協助。', 1, 'system');
