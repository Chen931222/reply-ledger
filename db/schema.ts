import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaceKnowledgeRules = sqliteTable("workspace_knowledge_rules", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdByEmail: text("created_by_email"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_workspace_rules_mode_active_updated").on(table.mode, table.active, table.updatedAt),
]);

export const workspaceAuditEvents = sqliteTable("workspace_audit_events", {
  id: text("id").primaryKey(),
  occurredAt: integer("occurred_at").notNull(),
  actorId: text("actor_id").notNull(),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  caseId: text("case_id").notNull(),
  detail: text("detail").notNull(),
}, (table) => [
  index("idx_workspace_audit_occurred").on(table.occurredAt),
]);

export const conversationAnalyses = sqliteTable("conversation_analyses", {
  sourceId: text("source_id").primaryKey(),
  inputMessageAt: integer("input_message_at").notNull(),
  intent: text("intent").notNull(),
  urgency: text("urgency").notNull(),
  risk: text("risk").notNull(),
  confidence: integer("confidence").notNull(),
  observation: text("observation").notNull(),
  rationale: text("rationale").notNull(),
  draft: text("draft").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const lineConversations = sqliteTable("line_conversations", {
  sourceId: text("source_id").primaryKey(),
  sourceType: text("source_type"),
  lastMessageText: text("last_message_text"),
  lastMessageDirection: text("last_message_direction").notNull(),
  lastMessageAt: integer("last_message_at").notNull(),
  status: text("status").notNull().default("open"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_line_conversations_activity").on(table.lastMessageAt),
  index("idx_line_conversations_status_activity").on(table.status, table.lastMessageAt),
]);

export const lineWebhookEvents = sqliteTable("line_webhook_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  webhookEventId: text("webhook_event_id").notNull(),
  destination: text("destination").notNull(),
  eventType: text("event_type").notNull(),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  eventTimestamp: integer("event_timestamp").notNull(),
  isRedelivery: integer("is_redelivery", { mode: "boolean" }).notNull().default(false),
  messageType: text("message_type"),
  messageId: text("message_id"),
  messageText: text("message_text"),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_line_events_webhook_event_id").on(table.webhookEventId),
  index("idx_line_events_timestamp").on(table.eventTimestamp),
  index("idx_line_events_source_timestamp").on(table.sourceId, table.eventTimestamp),
]);

export const lineOutboundMessages = sqliteTable("line_outbound_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: text("request_id").notNull(),
  targetId: text("target_id").notNull(),
  messageText: text("message_text").notNull(),
  actorId: text("actor_id").notNull(),
  actorEmail: text("actor_email"),
  status: text("status").notNull(),
  lineRequestId: text("line_request_id"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  sentAt: text("sent_at"),
}, (table) => [
  uniqueIndex("idx_line_outbound_request_id").on(table.requestId),
  index("idx_line_outbound_target_created").on(table.targetId, table.createdAt),
]);
