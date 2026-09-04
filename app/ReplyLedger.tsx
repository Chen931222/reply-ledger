"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { casesByMode, knowledgeByMode, modeInfo, seededAudit, type LedgerCase, type Mode, type View } from "./data";

type AuditRecord = { id: string; time: string; actor: string; action: string; caseId: string; detail: string };
type LearnedRule = { id: string; mode: Mode; title: string; body: string; createdTimestamp: number; updatedTimestamp: number };
type ConversationAnalysis = {
  sourceId: string;
  inputMessageAt: number;
  intent: string;
  urgency: string;
  risk: string;
  confidence: number;
  observation: string;
  rationale: string;
  draft: string;
  evidence: string[];
  engine: "openai" | "rules";
  model: string;
  status: string;
  updatedTimestamp: number;
};
type LineStatus = {
  databaseReady: boolean;
  receiveReady: boolean;
  sendReady: boolean;
  aiReady: boolean;
  analysisReady: boolean;
  analysisMode: "openai" | "rules";
  workspaceMode: string;
  eventCount: number;
  lastEventAt: number | null;
};
type LineInboxEvent = {
  id: number;
  webhookEventId: string;
  sourceType: string | null;
  sourceId: string | null;
  eventType: string;
  messageType: string | null;
  messageText: string | null;
  eventTimestamp: number;
  isRedelivery: boolean;
};
type LineOutboxMessage = {
  requestId: string;
  targetId: string;
  messageText: string;
  actorId: string;
  actorEmail: string | null;
  status: "pending" | "sent" | "failed" | "rejected";
  lineRequestId: string | null;
  errorMessage: string | null;
  createdTimestamp: number;
  sentTimestamp: number | null;
};
type LineConversationSummary = {
  sourceId: string;
  sourceType: string | null;
  lastMessageText: string | null;
  lastMessageDirection: "inbound" | "outbound";
  lastMessageAt: number;
  status: "open" | "done";
  assignedActorId: string | null;
  assignedActorEmail: string | null;
  assignedAt: number | null;
};
type ConversationInternalNote = {
  id: string;
  sourceId: string;
  noteText: string;
  actorId: string;
  actorEmail: string | null;
  createdTimestamp: number;
};
type ConversationCounts = { all: number; open: number; done: number };
type QueueStatus = "open" | "done" | "all";
type QueueSort = "oldest" | "newest";
type QueueScope = "all" | "mine" | "unassigned" | "overdue";
type AdviceTab = "suggestion" | "evidence" | "customer";
type LineConversationMessage = {
  direction: "inbound" | "outbound";
  messageKey: string;
  messageText: string;
  messageTimestamp: number;
  status: string;
};
type WorkbenchCase = LedgerCase & {
  kind: "live" | "demo";
  sourceId?: string | null;
  revision?: string;
  latestActivityTimestamp?: number;
  pendingReply?: boolean;
  overdue?: boolean;
  assignedActorId?: string | null;
  assignedActorEmail?: string | null;
  assignedAt?: number | null;
};
type SendState = "idle" | "confirming" | "sending" | "sent" | "error";
type AnalysisState = "idle" | "loading" | "ready" | "unavailable" | "error";

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function formatWaitingTime(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時`;
  return `${Math.floor(hours / 24)} 天`;
}

function conversationSearchParams(status: QueueStatus, sort: QueueSort, scope: QueueScope, query: string, limit = 40, cursor?: string | null) {
  const params = new URLSearchParams({ status, sort, scope, limit: String(limit) });
  if (query.trim()) params.set("q", query.trim());
  if (cursor) params.set("cursor", cursor);
  return params;
}

function sortConversationSummaries(items: LineConversationSummary[], sort: QueueSort) {
  return [...items].sort((left, right) => {
    const timeOrder = sort === "oldest" ? left.lastMessageAt - right.lastMessageAt : right.lastMessageAt - left.lastMessageAt;
    return timeOrder || left.sourceId.localeCompare(right.sourceId);
  });
}

async function fetchLineSnapshot(status: QueueStatus, sort: QueueSort, scope: QueueScope, query: string) {
  try {
    const conversationQuery = conversationSearchParams(status, sort, scope, query);
    const [statusResponse, conversationsResponse, outboxResponse] = await Promise.all([
      fetch("/api/workspace/status", { headers: { accept: "application/json" } }),
      fetch(`/api/workspace/conversations?${conversationQuery}`, { headers: { accept: "application/json" } }),
      fetch("/api/workspace/outbox?limit=50", { headers: { accept: "application/json" } }),
    ]);
    const status = statusResponse.ok ? await statusResponse.json() as LineStatus : null;
    const conversations = conversationsResponse.ok
      ? await conversationsResponse.json() as { conversations: LineConversationSummary[]; nextCursor: string | null; counts?: ConversationCounts }
      : null;
    const outbox = outboxResponse.ok ? await outboxResponse.json() as { messages: LineOutboxMessage[] } : null;
    const failed = [statusResponse, conversationsResponse, outboxResponse].filter((response) => !response.ok);
    return {
      status,
      conversations: conversations?.conversations ?? null,
      conversationCursor: conversations?.nextCursor ?? null,
      conversationCounts: conversations?.counts ?? null,
      outbox: outbox?.messages ?? null,
      error: failed.length > 0 ? "部分 LINE 資料暫時無法更新；目前保留上次成功讀取的內容。" : "",
    };
  } catch {
    return { status: null, conversations: null, conversationCursor: null, conversationCounts: null, outbox: null, error: "LINE 連線暫時中斷；目前保留上次成功讀取的內容。" };
  }
}

async function fetchConversationMessages(sourceId: string, cursor?: string | null) {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/workspace/conversations/${encodeURIComponent(sourceId)}/messages?${query}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("無法讀取這位聯絡人的歷史訊息。");
  return response.json() as Promise<{ messages: LineConversationMessage[]; nextCursor: string | null }>;
}

async function fetchConversationNotes(sourceId: string) {
  const response = await fetch(`/api/workspace/conversations/${encodeURIComponent(sourceId)}/notes`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("無法讀取團隊備註。");
  return response.json() as Promise<{ notes: ConversationInternalNote[] }>;
}

async function fetchLineInbox() {
  const response = await fetch("/api/workspace/inbox?limit=50", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("無法讀取 LINE 事件帳簿。");
  return response.json() as Promise<{ events: LineInboxEvent[] }>;
}

async function fetchWorkspaceState() {
  const [retailResponse, clinicResponse, auditResponse] = await Promise.all([
    fetch("/api/workspace/knowledge?mode=retail", { headers: { accept: "application/json" } }),
    fetch("/api/workspace/knowledge?mode=clinic", { headers: { accept: "application/json" } }),
    fetch("/api/workspace/audit?limit=200", { headers: { accept: "application/json" } }),
  ]);
  if (!retailResponse.ok || !clinicResponse.ok || !auditResponse.ok) throw new Error("工作區資料暫時無法同步。");
  const retail = await retailResponse.json() as { rules: LearnedRule[] };
  const clinic = await clinicResponse.json() as { rules: LearnedRule[] };
  const auditResult = await auditResponse.json() as {
    events: Array<{ id: string; occurredAt: number; actorId: string; actorEmail: string | null; action: string; caseId: string; detail: string }>;
  };
  return {
    rules: [...retail.rules, ...clinic.rules],
    audit: auditResult.events.map((event): AuditRecord => ({
      id: event.id,
      time: formatMessageTime(event.occurredAt),
      actor: event.actorEmail ?? event.actorId,
      action: event.action,
      caseId: event.caseId,
      detail: event.detail,
    })),
  };
}

export default function ReplyLedger() {
  const [mode, setMode] = useState<Mode>("retail");
  const [view, setView] = useState<View>("workspace");
  const [selectedId, setSelectedId] = useState(casesByMode.retail[0].id);
  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(casesByMode.retail[0].draft);
  const [audit, setAudit] = useState<AuditRecord[]>(seededAudit);
  const [learned, setLearned] = useState<LearnedRule[]>([]);
  const [toast, setToast] = useState("");
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [newRuleTitle, setNewRuleTitle] = useState("");
  const [newRule, setNewRule] = useState("");
  const [lineStatus, setLineStatus] = useState<LineStatus | null>(null);
  const [lineInbox, setLineInbox] = useState<LineInboxEvent[]>([]);
  const [lineOutbox, setLineOutbox] = useState<LineOutboxMessage[]>([]);
  const [lineConversations, setLineConversations] = useState<LineConversationSummary[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [conversationCounts, setConversationCounts] = useState<ConversationCounts>({ all: 0, open: 0, done: 0 });
  const [queueStatus, setQueueStatus] = useState<QueueStatus>("open");
  const [queueSort, setQueueSort] = useState<QueueSort>("oldest");
  const [queueScope, setQueueScope] = useState<QueueScope>("all");
  const [queueSearch, setQueueSearch] = useState("");
  const [debouncedQueueSearch, setDebouncedQueueSearch] = useState("");
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [clockNow, setClockNow] = useState(0);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, LineConversationMessage[]>>({});
  const [messageCursorByConversation, setMessageCursorByConversation] = useState<Record<string, string | null>>({});
  const [analysisByConversation, setAnalysisByConversation] = useState<Record<string, ConversationAnalysis>>({});
  const [analysisStateByConversation, setAnalysisStateByConversation] = useState<Record<string, AnalysisState>>({});
  const [notesByConversation, setNotesByConversation] = useState<Record<string, ConversationInternalNote[]>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [adviceTab, setAdviceTab] = useState<AdviceTab>("suggestion");
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [lineLoading, setLineLoading] = useState(true);
  const [lineError, setLineError] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState("");
  const [sendRetryable, setSendRetryable] = useState(false);
  const auditCounter = useRef(200);
  const sendRequestId = useRef<string | null>(null);
  const selectedRevision = useRef("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastAutoScrolledConversation = useRef("");

  useEffect(() => {
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const liveCases = useMemo<WorkbenchCase[]>(() => {
    return lineConversations.map((conversation) => {
      const analysis = analysisByConversation[conversation.sourceId];
      const storedMessages = messagesByConversation[conversation.sourceId] ?? [];
      const timeline = (storedMessages.length > 0 ? storedMessages : [{
        direction: conversation.lastMessageDirection,
        messageKey: `SUMMARY-${conversation.sourceId}`,
        messageText: conversation.lastMessageText ?? "（此訊息沒有文字內容）",
        messageTimestamp: conversation.lastMessageAt,
        status: conversation.status,
      }]).map((message) => ({
        side: message.direction === "outbound" ? "staff" as const : "customer" as const,
        time: formatMessageTime(message.messageTimestamp),
        text: message.messageText,
        timestamp: message.messageTimestamp,
        key: message.messageKey,
      })).sort((left, right) => left.timestamp - right.timestamp || left.key.localeCompare(right.key));
      const pendingReply = conversation.status === "open" && conversation.lastMessageDirection === "inbound";
      const overdue = pendingReply && clockNow > 0 && clockNow - conversation.lastMessageAt >= 30 * 60_000;
      return {
        id: `LIVE-${conversation.sourceId}`,
        kind: "live",
        sourceId: conversation.sourceId,
        revision: `${conversation.lastMessageAt}:${conversation.lastMessageDirection}:${analysis?.updatedTimestamp ?? 0}`,
        latestActivityTimestamp: conversation.lastMessageAt,
        pendingReply,
        customer: `LINE 使用者 ${maskLineId(conversation.sourceId)}`,
        title: "LINE 即時訊息",
        waiting: formatWaitingTime(conversation.lastMessageAt, clockNow || conversation.lastMessageAt),
        tag: pendingReply ? overdue ? "逾時待回" : "待回覆" : "已回覆",
        overdue,
        assignedActorId: conversation.assignedActorId,
        assignedActorEmail: conversation.assignedActorEmail,
        assignedAt: conversation.assignedAt,
        intent: analysis?.intent ?? "待人工判讀",
        urgency: analysis?.urgency ?? "待確認",
        risk: analysis?.risk ?? "尚未分類",
        confidence: analysis?.confidence ?? 0,
        observation: analysis?.observation ?? "這是已通過 LINE 簽章驗證並寫入資料庫的真實訊息，目前尚未進行內容判讀。",
        why: analysis?.rationale ?? "工作台只確認訊息來源與完整性；在資訊不足時，不會把單一句話猜成商品、報價或售後需求。",
        draft: analysis?.draft ?? `您好，已收到您的訊息「${conversation.lastMessageText ?? ""}」。請問您想詢問燈具選購、報價、安裝，還是售後服務呢？`,
        messages: timeline.map(({ side, time, text }) => ({ side, time, text })),
        sources: analysis?.evidence.length
          ? analysis.evidence.map((item) => ({ label: analysis.engine === "rules" ? "規則命中" : "AI 引用根據", excerpt: item }))
          : [{
              label: "LINE 已驗證對話",
              excerpt: `${formatLineTime(conversation.lastMessageAt)} 更新；來源 ${maskLineId(conversation.sourceId)}。`,
            }],
      };
    });
  }, [analysisByConversation, clockNow, lineConversations, messagesByConversation]);

  const demoCases = useMemo<WorkbenchCase[]>(() => casesByMode[mode].map((item) => ({ ...item, kind: "demo" })), [mode]);
  const hasLiveWorkspace = mode === "retail" && ((lineStatus?.eventCount ?? 0) > 0 || lineConversations.length > 0 || conversationCounts.all > 0);
  const emptyLiveCase = useMemo<WorkbenchCase>(() => ({
    id: "LIVE-EMPTY", kind: "live", sourceId: null, pendingReply: false, customer: "LINE 收件匣", title: "沒有符合條件的對話",
    waiting: "—", tag: "佇列已清空", intent: "無", urgency: "低", risk: "無", confidence: 100,
    observation: "目前的搜尋與篩選條件下沒有對話。訊息仍持續寫入資料庫，新訊息會自動出現在左側佇列。",
    why: "工作台只載入目前需要看的資料頁，避免上百則對話同時擠進畫面並拖慢操作。", draft: "",
    messages: [{ side: "staff", time: "—", text: "可以調整左側篩選條件，或清除搜尋文字查看其他對話。" }], sources: [],
  }), []);
  const queueCases = hasLiveWorkspace ? liveCases : demoCases;
  const cases = queueCases.length > 0 ? queueCases : [emptyLiveCase];
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];
  const currentDraft = selected.id === selectedId ? draft : selected.draft;
  const pendingCount = hasLiveWorkspace ? conversationCounts.open : cases.filter((item) => item.kind === "live" && item.pendingReply).length;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQueueSearch(queueSearch), 280);
    return () => window.clearTimeout(timer);
  }, [queueSearch]);

  useEffect(() => {
    let active = true;
    void fetchWorkspaceState().then((result) => {
      if (!active) return;
      setLearned(result.rules);
      setAudit(result.audit);
    }).catch(() => {
      if (active) setLineError("工作區知識與稽核紀錄暫時無法同步；目前顯示安全的示範內容。");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLineData(replace: boolean) {
      const result = await fetchLineSnapshot(queueStatus, queueSort, queueScope, debouncedQueueSearch);
      if (!active) return;
      if (result.status) setLineStatus(result.status);
      if (result.conversations) {
        setLineConversations((current) => {
          if (replace) return result.conversations!;
          const targetSize = Math.max(40, current.length);
          const merged = new Map(current.map((item) => [item.sourceId, item]));
          for (const item of result.conversations!) merged.set(item.sourceId, item);
          return sortConversationSummaries([...merged.values()], queueSort).slice(0, targetSize);
        });
      }
      setConversationCursor(result.conversationCursor);
      if (result.conversationCounts) setConversationCounts(result.conversationCounts);
      if (result.outbox) setLineOutbox(result.outbox);
      setLineError(result.error);
      setLineLoading(false);
    }
    void loadLineData(true);
    const refreshTimer = window.setInterval(() => void loadLineData(false), 10_000);
    return () => { active = false; window.clearInterval(refreshTimer); };
  }, [debouncedQueueSearch, queueScope, queueSort, queueStatus]);

  const refreshLineData = useCallback(async () => {
    const result = await fetchLineSnapshot(queueStatus, queueSort, queueScope, debouncedQueueSearch);
    if (result.status) setLineStatus(result.status);
    if (result.conversations) setLineConversations(result.conversations);
    setConversationCursor(result.conversationCursor);
    if (result.conversationCounts) setConversationCounts(result.conversationCounts);
    if (result.outbox) setLineOutbox(result.outbox);
    setLineError(result.error);
    setLineLoading(false);
  }, [debouncedQueueSearch, queueScope, queueSort, queueStatus]);

  useEffect(() => {
    if (view !== "line") return;
    let active = true;
    void fetchLineInbox().then((result) => {
      if (active) setLineInbox(result.events);
    }).catch(() => {
      if (active) setLineError("LINE 事件帳簿暫時無法更新；工作台對話仍保留上次成功讀取的內容。");
    });
    return () => { active = false; };
  }, [view, lineStatus?.eventCount]);

  useEffect(() => {
    if (selected.kind !== "live" || !selected.sourceId) return;
    const sourceId = selected.sourceId;
    let active = true;
    async function loadMessages() {
      try {
        const result = await fetchConversationMessages(sourceId);
        if (!active) return;
        setMessagesByConversation((current) => ({ ...current, [sourceId]: result.messages }));
        setMessageCursorByConversation((current) => ({ ...current, [sourceId]: result.nextCursor }));
      } catch (error) {
        if (active) setLineError(error instanceof Error ? error.message : "無法讀取對話紀錄。");
      }
    }
    void loadMessages();
    const refreshTimer = window.setInterval(() => void loadMessages(), 10_000);
    return () => { active = false; window.clearInterval(refreshTimer); };
  }, [selected.kind, selected.sourceId, selected.revision]);

  useEffect(() => {
    if (selected.kind !== "live" || !selected.sourceId) return;
    const sourceId = selected.sourceId;
    let active = true;
    void fetchConversationNotes(sourceId).then((result) => {
      if (active) setNotesByConversation((current) => ({ ...current, [sourceId]: result.notes }));
    }).catch((error) => {
      if (active) setLineError(error instanceof Error ? error.message : "無法讀取團隊備註。");
    });
    return () => { active = false; };
  }, [selected.kind, selected.sourceId]);

  useEffect(() => {
    if (paused || selected.kind !== "live" || !selected.sourceId) return;
    const sourceId = selected.sourceId;
    if (!lineStatus?.analysisReady) return;
    const currentAnalysis = analysisByConversation[sourceId];
    if (currentAnalysis && currentAnalysis.inputMessageAt >= (selected.latestActivityTimestamp ?? 0)) return;
    let active = true;
    window.queueMicrotask(() => {
      if (active) setAnalysisStateByConversation((current) => ({ ...current, [sourceId]: "loading" }));
    });
    void fetch("/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sourceId }),
    }).then(async (response) => {
      const result = await response.json().catch(() => null) as { analysis?: ConversationAnalysis; configured?: boolean; error?: string } | null;
      if (!active) return;
      if (!response.ok || !result?.analysis) {
        setAnalysisStateByConversation((current) => ({ ...current, [sourceId]: result?.configured === false ? "unavailable" : "error" }));
        return;
      }
      setAnalysisByConversation((current) => ({ ...current, [sourceId]: result.analysis! }));
      setAnalysisStateByConversation((current) => ({ ...current, [sourceId]: "ready" }));
    }).catch(() => {
      if (active) setAnalysisStateByConversation((current) => ({ ...current, [sourceId]: "error" }));
    });
    return () => { active = false; };
  }, [analysisByConversation, lineStatus?.analysisReady, paused, selected.kind, selected.latestActivityTimestamp, selected.sourceId]);

  async function loadMoreConversations() {
    if (!conversationCursor) return;
    setLoadingMoreConversations(true);
    try {
      const query = conversationSearchParams(queueStatus, queueSort, queueScope, debouncedQueueSearch, 40, conversationCursor);
      const response = await fetch(`/api/workspace/conversations?${query}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("無法載入更多聯絡人。");
      const result = await response.json() as { conversations: LineConversationSummary[]; nextCursor: string | null; counts?: ConversationCounts };
      setLineConversations((current) => {
        const merged = new Map(current.map((item) => [item.sourceId, item]));
        for (const item of result.conversations) merged.set(item.sourceId, item);
        return sortConversationSummaries([...merged.values()], queueSort);
      });
      setConversationCursor(result.nextCursor);
      if (result.counts) setConversationCounts(result.counts);
    } catch (error) {
      setLineError(error instanceof Error ? error.message : "無法載入更多聯絡人。");
    } finally { setLoadingMoreConversations(false); }
  }

  async function loadOlderMessages() {
    if (selected.kind !== "live" || !selected.sourceId) return;
    const sourceId = selected.sourceId;
    const cursor = messageCursorByConversation[sourceId];
    if (!cursor) return;
    setLoadingOlderMessages(true);
    try {
      const result = await fetchConversationMessages(sourceId, cursor);
      setMessagesByConversation((current) => {
        const merged = new Map((current[sourceId] ?? []).map((item) => [item.messageKey, item]));
        for (const item of result.messages) merged.set(item.messageKey, item);
        return { ...current, [sourceId]: [...merged.values()] };
      });
      setMessageCursorByConversation((current) => ({ ...current, [sourceId]: result.nextCursor }));
    } catch (error) {
      setLineError(error instanceof Error ? error.message : "無法載入較舊訊息。");
    } finally { setLoadingOlderMessages(false); }
  }

  function jumpToLatestMessage() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  useEffect(() => {
    if (!selected.sourceId || selected.messages.length === 0 || lastAutoScrolledConversation.current === selected.sourceId) return;
    lastAutoScrolledConversation.current = selected.sourceId;
    const frame = window.requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ block: "end" }));
    return () => window.cancelAnimationFrame(frame);
  }, [selected.messages.length, selected.sourceId]);

  useEffect(() => {
    const revision = `${selected.id}:${selected.revision ?? "demo"}`;
    if (selectedRevision.current === revision) return;
    selectedRevision.current = revision;
    setSelectedId(selected.id);
    setDraft(selected.draft);
    setEditing(false);
    setSendState("idle");
    setSendError("");
    setSendRetryable(false);
    setAdviceTab("suggestion");
    setNoteDraft("");
    sendRequestId.current = null;
  }, [selected.draft, selected.id, selected.revision]);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    const nextCases = nextMode === "retail" && liveCases.length > 0
      ? liveCases
      : casesByMode[nextMode].map((item) => ({ ...item, kind: "demo" as const }));
    setSelectedId(nextCases[0].id);
    setDraft(nextCases[0].draft);
    setEditing(false);
    setSendState("idle");
    setSendError("");
    setSendRetryable(false);
    sendRequestId.current = null;
    setView("workspace");
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function logAction(action: string, detail: string) {
    const now = new Date();
    const record: AuditRecord = {
      id: `A-${++auditCounter.current}`,
      time: now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }),
      actor: "目前使用者",
      action,
      caseId: selected.id,
      detail,
    };
    setAudit((current) => [record, ...current]);
    void fetch("/api/workspace/audit", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action, caseId: selected.id, detail }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("audit write failed");
      const result = await response.json() as { event: { id: string; occurredAt: number; actorId: string; actorEmail: string | null } };
      setAudit((current) => current.map((item) => item.id === record.id ? {
        ...item,
        id: result.event.id,
        time: formatMessageTime(result.event.occurredAt),
        actor: result.event.actorEmail ?? result.event.actorId,
      } : item));
    }).catch(() => flash("動作已完成，但稽核紀錄暫時無法同步。"));
  }

  function prepareLineSend() {
    if (selected.kind !== "live" || !selected.sourceId) {
      flash("示範案例沒有真實 LINE 收件人，不能傳送。");
      return;
    }
    if (!lineStatus?.sendReady) {
      flash("LINE 傳送功能尚未就緒，請先檢查 Access Token。");
      return;
    }
    if (!currentDraft.trim()) {
      flash("訊息內容不能是空白。");
      return;
    }
    setEditing(false);
    setSendError("");
    setSendRetryable(false);
    sendRequestId.current = crypto.randomUUID();
    setSendState("confirming");
  }

  async function confirmLineSend() {
    if (selected.kind !== "live" || !selected.sourceId || !sendRequestId.current) return;
    setSendState("sending");
    setSendError("");
    try {
      const response = await fetch("/api/workspace/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          to: selected.sourceId,
          text: currentDraft.trim(),
          requestId: sendRequestId.current,
        }),
      });
      const result = await response.json().catch(() => null) as { error?: string; retryable?: boolean } | null;
      if (!response.ok) {
        if (response.status === 409) throw new Error("這次傳送請求已處理過，請先到 LINE 確認是否收到，避免重複傳送。");
        const failure = new Error(result?.error ?? "LINE 沒有接受這則訊息。") as Error & { retryable?: boolean };
        failure.retryable = result?.retryable === true;
        throw failure;
      }

      const wasEdited = currentDraft.trim() !== selected.draft.trim();
      logAction("確認並傳送", wasEdited ? "真人修改 AI 草稿後確認傳送。" : "真人覆核 AI 草稿後確認傳送。");
      setSendState("sent");
      setSendRetryable(false);
      await refreshLineData();
      flash("訊息已由 LINE 官方帳號成功傳送。");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "傳送失敗，請稍後再試。");
      setSendRetryable(Boolean(error && typeof error === "object" && "retryable" in error && error.retryable));
      setSendState("error");
    }
  }

  function rejectDraft() {
    logAction("拒絕建議", "建議未送出；保留原始內容供後續檢討。 ");
    setSendState("idle");
    setSendError("");
    setSendRetryable(false);
    sendRequestId.current = null;
    flash("已拒絕。這則建議不會被送出，也不會自動學習。");
  }

  async function updateAssignment(action: "self" | "unassign") {
    if (selected.kind !== "live" || !selected.sourceId) {
      flash("示範案例無法指派。");
      return;
    }
    setAssignmentSaving(true);
    try {
      const response = await fetch(`/api/workspace/conversations/${encodeURIComponent(selected.sourceId)}/assignment`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => null) as { assignment?: { assignedActorId: string | null; assignedActorEmail: string | null; assignedAt: number | null }; error?: string } | null;
      if (!response.ok || !result?.assignment) throw new Error(result?.error ?? "無法更新負責人。");
      setLineConversations((items) => items.map((item) => item.sourceId === selected.sourceId ? { ...item, ...result.assignment! } : item));
      flash(action === "self" ? "這則對話已由你接手。" : "已解除指派，回到團隊佇列。");
    } catch (error) {
      flash(error instanceof Error ? error.message : "無法更新負責人。");
    } finally {
      setAssignmentSaving(false);
    }
  }

  function handToHuman() {
    void updateAssignment("self");
  }

  async function addInternalNote() {
    if (selected.kind !== "live" || !selected.sourceId || !noteDraft.trim()) return;
    setNoteSaving(true);
    try {
      const response = await fetch(`/api/workspace/conversations/${encodeURIComponent(selected.sourceId)}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ note: noteDraft.trim() }),
      });
      const result = await response.json().catch(() => null) as { note?: ConversationInternalNote; error?: string } | null;
      if (!response.ok || !result?.note) throw new Error(result?.error ?? "無法儲存備註。");
      setNotesByConversation((current) => ({
        ...current,
        [selected.sourceId!]: [result.note!, ...(current[selected.sourceId!] ?? [])],
      }));
      setNoteDraft("");
      flash("內部備註已儲存，不會傳送到 LINE。");
    } catch (error) {
      flash(error instanceof Error ? error.message : "無法儲存備註。");
    } finally {
      setNoteSaving(false);
    }
  }

  async function addRule() {
    if (!newRuleTitle.trim() || !newRule.trim()) {
      flash("請填寫規則名稱與內容。");
      return;
    }
    try {
      const response = await fetch("/api/workspace/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ mode, title: newRuleTitle.trim(), body: newRule.trim() }),
      });
      const result = await response.json().catch(() => null) as { rule?: LearnedRule; error?: string } | null;
      if (!response.ok || !result?.rule) throw new Error(result?.error ?? "規則無法儲存。");
      setLearned((items) => [result.rule!, ...items]);
      setNewRuleTitle("");
      setNewRule("");
      setNewRuleOpen(false);
      flash("新規則已存入工作區知識帳簿，可跨裝置使用。");
    } catch (error) {
      flash(error instanceof Error ? error.message : "規則無法儲存。");
    }
  }

  const modeLearned = useMemo(() => learned.filter((item) => item.mode === mode), [learned, mode]);
  const auditEntries = useMemo<AuditRecord[]>(() => {
    const durableTargets = new Set(lineOutbox.map((message) => `LIVE-${message.targetId}`));
    const localEntries = audit.filter((entry) => !(entry.action === "已傳送 LINE" && durableTargets.has(entry.caseId)));
    const durableEntries = lineOutbox.map((message) => {
      const timestamp = message.sentTimestamp ?? message.createdTimestamp;
      const action = message.status === "sent"
        ? "已傳送 LINE"
        : message.status === "rejected"
          ? "LINE 拒絕訊息"
          : message.status === "failed"
            ? "LINE 傳送失敗"
            : "LINE 傳送中";
      return {
        id: `OUT-${message.requestId}`,
        time: formatMessageTime(timestamp),
        actor: message.actorEmail ?? message.actorId,
        action,
        caseId: `LIVE-${message.targetId}`,
        detail: message.status === "sent"
          ? `真人確認後送出；收件人 ${maskLineId(message.targetId)}。`
          : message.errorMessage ?? "等待 LINE 回應。",
      };
    });
    return [...durableEntries, ...localEntries];
  }, [audit, lineOutbox]);
  const lineState = lineStatus?.receiveReady ? (lineStatus.eventCount > 0 ? "live" : "ready") : "demo";
  const lineStateLabel = lineState === "live" ? "LINE 已連線" : lineState === "ready" ? "LINE 待測試" : modeInfo[mode].status;
  const selectedAnalysis = selected.kind === "live" && selected.sourceId ? analysisByConversation[selected.sourceId] : undefined;
  const selectedAnalysisState = selected.kind === "live" && selected.sourceId
    ? !lineStatus?.analysisReady
      ? "unavailable"
      : selectedAnalysis
        ? "ready"
        : analysisStateByConversation[selected.sourceId] ?? "idle"
    : "ready";
  const selectedNotes = selected.kind === "live" && selected.sourceId ? notesByConversation[selected.sourceId] ?? [] : [];
  const assignmentLabel = selected.assignedActorEmail ?? selected.assignedActorId ?? "尚未指派";
  const confidenceLabel = selected.kind !== "live"
    ? `${selected.confidence}%`
    : selectedAnalysisState === "ready"
      ? `${selectedAnalysis?.engine === "rules" ? "規則 " : ""}${selected.confidence}%`
      : selectedAnalysisState === "loading"
        ? "判讀中"
        : selectedAnalysisState === "unavailable"
          ? "判讀未就緒"
          : selectedAnalysisState === "error"
            ? "判讀失敗"
            : "需覆核";

  function maskLineId(value: string | null) {
    if (!value) return "未知來源";
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }

  function formatLineTime(timestamp: number) {
    return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
  }

  return (
    <main className={`ledger-shell mode-${mode}`}>
      <header className="masthead">
        <button className="brand-block" type="button" onClick={() => setView("workspace")} aria-label="回到工作台">
          <span className="brand-mark">R/L</span>
          <div>
            <h1>Reply Ledger</h1>
            <p>真人覆核客服台</p>
          </div>
        </button>
        <div className="masthead-actions">
          <div className="mode-switch" aria-label="產業模式">
            <button className={mode === "retail" ? "active" : ""} onClick={() => changeMode("retail")}>燈飾零售</button>
            <button className={mode === "clinic" ? "active" : ""} onClick={() => changeMode("clinic")}>診所觀察員</button>
          </div>
          <button className={`pause-button ${paused ? "paused" : ""}`} type="button" onClick={() => { setPaused(!paused); flash(paused ? "自動判讀已恢復。" : "自動判讀已暫停，真人仍可查看既有內容。"); }}>
            <span className="live-dot" aria-hidden="true" />
            {paused ? "恢復觀察" : lineStateLabel}
          </button>
        </div>
      </header>

      <nav className="view-nav" aria-label="主要頁面">
        {(["workspace", "line", "knowledge", "audit"] as View[]).map((item) => (
          <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
            {item === "workspace" ? "工作台" : item === "line" ? "LINE 收件匣" : item === "knowledge" ? "知識帳簿" : "稽核紀錄"}
          </button>
        ))}
        <a className="tour-link" href="/intro.html">觀看 60 秒導覽 ↗</a>
      </nav>

      <button className={`integration-strip state-${lineState}`} type="button" onClick={() => setView("line")}>
        <span className="integration-kicker"><span className="live-dot" aria-hidden="true" /> LINE</span>
        <strong>{lineError || (lineLoading ? "目前顯示 Demo 資料，正在確認 LINE 狀態" : lineState === "live" ? `已收到 ${lineStatus?.eventCount ?? 0} 個真實事件` : lineState === "ready" ? "Webhook 已設定，等待第一則真實訊息" : "目前顯示 Demo 資料，尚未連接 LINE 官方帳號")}</strong>
        <span>{lineStatus?.sendReady ? "人工傳送已備妥" : "傳送功能鎖定"} →</span>
      </button>

      {view === "workspace" && (
        <section className="workbench" aria-label="客服判讀與回覆工作台">
          <aside className="queue-panel">
            <div className="section-label"><div><p>{hasLiveWorkspace ? "收件匣" : "示範案例"}</p><small>{hasLiveWorkspace ? `${pendingCount} 則等待回覆` : "安全示範資料"}</small></div><strong aria-live="polite">{hasLiveWorkspace ? pendingCount : cases.length}</strong></div>
            <div className={`queue-status-tabs ${hasLiveWorkspace ? "" : "demo-tabs"}`} aria-label="案件狀態">
              {hasLiveWorkspace ? (["open", "done", "all"] as QueueStatus[]).map((status) => (
                <button type="button" className={queueStatus === status ? "active" : ""} key={status} onClick={() => { setQueueStatus(status); setConversationCursor(null); }}>
                  {status === "open" ? "待處理" : status === "done" ? "已完成" : "全部"}<b>{conversationCounts[status]}</b>
                </button>
              )) : <><span className="active">待處理 <b>{cases.length}</b></span><span>已完成 <b>0</b></span></>}
            </div>
            {hasLiveWorkspace && <div className="queue-saved-views" aria-label="智能檢視">
              {(["all", "mine", "unassigned", "overdue"] as QueueScope[]).map((scope) => <button key={scope} type="button" className={queueScope === scope ? "active" : ""} onClick={() => { setQueueScope(scope); setConversationCursor(null); }}>{scope === "all" ? "全部" : scope === "mine" ? "我的" : scope === "unassigned" ? "未指派" : "逾時"}</button>)}
            </div>}
            {hasLiveWorkspace && <div className="queue-tools">
              <label className="queue-search"><span>搜尋</span><input type="search" value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="訊息內容或 LINE ID" aria-label="搜尋 LINE 對話" /></label>
              <label className="queue-sort"><span>排序</span><select value={queueSort} onChange={(event) => setQueueSort(event.target.value as QueueSort)} aria-label="對話排序"><option value="oldest">最久等待</option><option value="newest">最新訊息</option></select></label>
              <p>目前載入 {queueCases.length} 則</p>
            </div>}
            {queueCases.length === 0 && <div className="queue-empty"><strong>沒有符合條件的對話</strong><span>清除搜尋，或切換上方狀態。</span></div>}
            {queueCases.map((item) => (
              <button className={`queue-item ${item.id === selected.id ? "active" : ""} ${item.overdue ? "overdue" : ""}`} key={item.id} onClick={() => { setSelectedId(item.id); setDraft(item.draft); setEditing(false); setSendState("idle"); setSendError(""); setSendRetryable(false); sendRequestId.current = null; }}>
                <span className="queue-topline"><span className={item.requiresHuman ? "risk-tag" : ""}>{item.tag}</span><time>{item.waiting}</time></span>
                <strong>{item.kind === "live" ? "LINE 聯絡人" : item.customer}</strong>
                {item.kind === "live" && <small className="queue-identity">{maskLineId(item.sourceId ?? null)}</small>}
                <span className="queue-preview">{item.messages[item.messages.length - 1].text}</span>
                {item.kind === "live" && <span className="queue-owner">{item.assignedActorId ? `負責人 · ${item.assignedActorEmail ?? "目前使用者"}` : "未指派"}</span>}
              </button>
            ))}
            {hasLiveWorkspace && conversationCursor && (
              <button className="pagination-button" type="button" onClick={loadMoreConversations} disabled={loadingMoreConversations}>{loadingMoreConversations ? "正在載入…" : "再載入 40 則對話"}</button>
            )}
            <footer className="queue-footer"><span>{hasLiveWorkspace ? `真實 LINE · 共 ${conversationCounts.all} 位` : "DEMO · 非真實訊息"}</span><span>{hasLiveWorkspace ? "40 筆分頁載入" : "示範模式"}</span></footer>
          </aside>

          <section className="conversation-panel">
            <div className="conversation-head">
              <div>
                <div className="conversation-status"><span className="channel-chip">{selected.kind === "live" ? "LINE" : "DEMO"}</span><span className={selected.pendingReply === false ? "resolved-chip" : "waiting-chip"}>{selected.pendingReply === false ? "已處理" : "待人工處理"}</span></div>
                <h2>{selected.kind === "live" ? "LINE 聯絡人" : selected.title}</h2>
                <p className="conversation-identity">{selected.kind === "live" ? `${maskLineId(selected.sourceId ?? null)} · ${assignmentLabel}` : selected.customer}</p>
              </div>
              {selected.kind === "live" && <button className="assign-button" type="button" disabled={assignmentSaving} onClick={() => void updateAssignment(selected.assignedActorId ? "unassign" : "self")}>{assignmentSaving ? "處理中…" : selected.assignedActorId ? "解除指派" : "由我接手"}</button>}
            </div>
            <div className="messages">
              {selected.kind === "live" && selected.sourceId && <div className="timeline-toolbar"><span>已載入 {selected.messages.length} 則</span><button type="button" onClick={jumpToLatestMessage}>跳到最新 ↓</button></div>}
              {selected.kind === "live" && selected.sourceId && messageCursorByConversation[selected.sourceId] && (
                <button className="older-messages-button" type="button" onClick={loadOlderMessages} disabled={loadingOlderMessages}>{loadingOlderMessages ? "正在載入…" : "↑ 載入前 50 則訊息"}</button>
              )}
              {selected.messages.map((message, index) => (
                <div className={`message-row ${message.side}`} key={`${selected.id}-${index}`}>
                  <span className="message-avatar" aria-hidden="true">{message.side === "staff" ? "B" : "客"}</span>
                  <div className="message-content">
                    <div className="message-meta"><strong>{message.side === "staff" ? "BREME" : selected.kind === "live" ? "LINE 客戶" : selected.customer}</strong><time>{message.time}</time></div>
                    <p>{message.text}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} className="messages-end" aria-hidden="true" />
            </div>
            {selected.kind === "live" && <section className="team-composer" aria-label="團隊內部備註">
              {selectedNotes.length > 0 && <div className="internal-notes-list">
                {selectedNotes.slice(0, 3).map((note) => <article key={note.id}><div><strong>內部備註</strong><time>{formatLineTime(note.createdTimestamp)}</time></div><p>{note.noteText}</p><small>{note.actorEmail ?? note.actorId}</small></article>)}
              </div>}
              <div className="composer-tabs"><span className="active">內部備註</span><span>只供團隊查看，不會傳送給客戶</span></div>
              <div className="note-compose-row"><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={2} maxLength={3000} placeholder="記下追蹤事項、交班資訊或客戶偏好…" aria-label="新增內部備註"/><button type="button" disabled={noteSaving || !noteDraft.trim()} onClick={() => void addInternalNote()}>{noteSaving ? "儲存中…" : "新增備註"}</button></div>
            </section>}
          </section>

          <aside className={`advice-panel ${paused ? "is-paused" : ""}`}>
            <div className="copilot-head"><div><p>回覆助手</p><span>{paused ? "已暫停" : confidenceLabel}</span></div><nav aria-label="助手資訊"><button className={adviceTab === "suggestion" ? "active" : ""} onClick={() => setAdviceTab("suggestion")}>建議</button><button className={adviceTab === "evidence" ? "active" : ""} onClick={() => setAdviceTab("evidence")}>根據</button><button className={adviceTab === "customer" ? "active" : ""} onClick={() => setAdviceTab("customer")}>客戶</button></nav></div>
            {adviceTab === "suggestion" && <>
              {paused && <div className="pause-notice"><strong>自動判讀已暫停</strong><p>既有分析仍保留，但不會產生新建議。</p></div>}
              {selected.kind === "live" && selectedAnalysisState === "unavailable" && <div className="pause-notice ai-unavailable"><strong>判讀服務尚未就緒</strong><p>目前顯示安全草稿；訊息仍會正常保存。</p></div>}
              {selected.kind === "live" && selectedAnalysisState === "error" && <div className="pause-notice ai-unavailable"><strong>本次判讀失敗</strong><p>請由真人確認內容後再回覆。</p></div>}
              <div className={`attention-panel ${selected.pendingReply === false ? "resolved" : ""}`}><span>{selected.pendingReply === false ? "已完成" : "下一步"}</span><strong>{selected.pendingReply === false ? "最新訊息已經回覆" : selected.requiresHuman ? "先確認風險，再決定是否回覆" : "檢查草稿後即可傳送"}</strong><p>{selected.pendingReply === false ? "傳送結果已保存在稽核紀錄。" : `風險：${selected.risk}`}</p></div>
              <div className="analysis-grid"><div><span>意圖</span><strong>{selected.intent}</strong></div><div><span>急迫度</span><strong>{selected.urgency}</strong></div><div><span>風險</span><strong className="accent-text">{selected.risk}</strong></div></div>
              <div className="draft-block">
                <div className="draft-heading"><p>建議回覆</p><span>真人覆核後送出</span></div>
                {editing ? <textarea aria-label="修改建議回覆" value={currentDraft} onChange={(event) => { if (selected.id !== selectedId) setSelectedId(selected.id); setDraft(event.target.value); setSendState("idle"); setSendError(""); setSendRetryable(false); sendRequestId.current = null; }} rows={9} /> : <div className="draft-copy"><p>{currentDraft}</p></div>}
              </div>
              <div className="reason-summary"><span>判讀摘要</span><p>{selected.observation}</p></div>
              {selected.requiresHuman && <button className="handoff-banner" type="button" onClick={handToHuman}><strong>高風險事件</strong><span>由我接手 →</span></button>}
            </>}
            {adviceTab === "evidence" && <div className="copilot-tab-body"><div className="reason-card"><span>判讀理由</span><p>{selected.why}</p></div><div className="source-list"><h3>引用根據 · {selected.sources.length}</h3>{selected.sources.map((source, index) => <article key={source.label}><b>0{index + 1}</b><div><strong>{source.label}</strong><p>{source.excerpt}</p></div></article>)}</div></div>}
            {adviceTab === "customer" && <div className="copilot-tab-body customer-card"><dl><div><dt>渠道</dt><dd>{selected.kind === "live" ? "LINE 官方帳號" : "示範"}</dd></div><div><dt>識別碼</dt><dd>{selected.kind === "live" ? maskLineId(selected.sourceId ?? null) : selected.customer}</dd></div><div><dt>等待時間</dt><dd>{selected.waiting}</dd></div><div><dt>負責人</dt><dd>{assignmentLabel}</dd></div></dl>{selected.kind === "live" && <button type="button" disabled={assignmentSaving} onClick={() => void updateAssignment(selected.assignedActorId ? "unassign" : "self")}>{selected.assignedActorId ? "解除指派" : "由我接手"}</button>}</div>}
            {adviceTab === "suggestion" && <>{(sendState === "confirming" || sendState === "sending" || sendState === "error") && (
              <section className="send-confirmation" role="alertdialog" aria-labelledby="send-confirmation-title" aria-describedby="send-confirmation-copy">
                <p className="margin-label">FINAL CHECK · THIS WILL SEND</p>
                <h3 id="send-confirmation-title">確認傳送給 {maskLineId(selected.sourceId ?? null)}</h3>
                <p id="send-confirmation-copy" className="send-confirmation-copy">{currentDraft.trim()}</p>
                {sendError && <p className="send-error" role="alert">{sendError}</p>}
                <div className="send-confirmation-actions">
                  <button type="button" onClick={() => { setSendState("idle"); setSendError(""); setSendRetryable(false); sendRequestId.current = null; }} disabled={sendState === "sending"}>返回修改</button>
                  {(sendState !== "error" || sendRetryable) && <button type="button" className="primary-action" onClick={confirmLineSend} disabled={sendState === "sending"}>{sendState === "sending" ? "傳送中…" : sendState === "error" ? "使用相同金鑰安全重試" : "確認，現在傳送"}</button>}
                </div>
              </section>
            )}
            <div className="decision-row" aria-label="回覆決策">
              <button type="button" className="primary-action" onClick={prepareLineSend} disabled={paused || selected.kind !== "live" || selected.pendingReply === false || sendState === "sending" || sendState === "sent"}>{sendState === "sent" ? "已傳送到 LINE" : selected.kind === "live" && selected.pendingReply === false ? "最新訊息已回覆" : selected.kind === "live" ? "確認並傳送到 LINE" : "示範案例不可傳送"}</button>
              <button type="button" onClick={() => { if (selected.id !== selectedId) { setSelectedId(selected.id); setDraft(selected.draft); } setSendState("idle"); setSendError(""); setSendRetryable(false); sendRequestId.current = null; setEditing(!editing); }}>{editing ? "完成修改" : "修改"}</button>
              <button type="button" onClick={rejectDraft}>拒絕</button>
            </div>
            <button className="quiet-handoff" type="button" onClick={handToHuman}>不使用建議，直接交給真人</button>
            <p className="send-lock">只有真人完成第二次確認後才會傳送；LINE 結果與操作者會留下紀錄。</p></>}
          </aside>
        </section>
      )}

      {view === "line" && (
        <section className="page-sheet line-view">
          <div className="page-title">
            <div><p className="eyebrow">LIVE INBOX · VERIFIED WEBHOOKS ONLY</p><h2>真實訊息與示範資料，分開記帳。</h2></div>
            <span className={`connection-stamp state-${lineState}`}>{lineState === "live" ? "CONNECTED" : lineState === "ready" ? "READY" : "NOT CONNECTED"}</span>
          </div>
          <div className="connection-ledger">
            <article><span>01</span><p>資料庫</p><strong>{lineStatus?.databaseReady ? "持久化已就緒" : "尚未建立"}</strong></article>
            <article><span>02</span><p>接收</p><strong>{lineStatus?.receiveReady ? "簽章驗證已備妥" : "等待 Channel secret"}</strong></article>
            <article><span>03</span><p>傳送</p><strong>{lineStatus?.sendReady ? "人工確認後可送出" : "等待 Access token"}</strong></article>
            <article><span>04</span><p>判讀引擎</p><strong>{lineStatus?.aiReady ? "OpenAI + Rules 備援" : lineStatus?.analysisReady ? "Rules v1 已備妥" : "尚未就緒"}</strong></article>
          </div>
          <div className="live-inbox-head"><p>已驗證事件</p><span>{lineInbox.length} / 最近 50 筆</span></div>
          {lineLoading ? <div className="empty-state">正在讀取連線狀態。</div> : lineInbox.length === 0 ? (
            <div className="empty-state">尚未收到真實 LINE 訊息。完成 LINE Developers 設定後，從測試帳號傳一則訊息，會出現在這裡。</div>
          ) : (
            <div className="live-inbox-list">
              {lineInbox.map((event) => <article className="live-inbox-row" key={event.webhookEventId}>
                <time>{formatLineTime(event.eventTimestamp)}</time>
                <span>{maskLineId(event.sourceId)}</span>
                <div><b>{event.messageType === "text" ? "文字訊息" : event.eventType}</b><p>{event.messageText ?? "（此事件沒有文字內容）"}</p></div>
                {event.isRedelivery && <em>REDELIVERY</em>}
              </article>)}
            </div>
          )}
          <p className="privacy-note">僅保存營運所需欄位，不保存 LINE Webhook 原始內容或 reply token。診所模式在完成個資與醫療流程審查前，不應接入真實患者資料。</p>
          <div className="live-inbox-head outbox-head"><p>真人確認後送出</p><span>{lineOutbox.length} / 最近 50 筆</span></div>
          {lineOutbox.length === 0 ? <div className="empty-state">尚未留下正式傳送紀錄。</div> : (
            <div className="live-inbox-list">
              {lineOutbox.map((message) => <article className="live-inbox-row outbox-row" key={message.requestId}>
                <time>{formatLineTime(message.sentTimestamp ?? message.createdTimestamp)}</time>
                <span>{maskLineId(message.targetId)}</span>
                <div><b>BREME 卡片回覆</b><p>{message.messageText}</p></div>
                <em className={`outbox-status status-${message.status}`}>{message.status === "sent" ? "SENT" : message.status.toUpperCase()}</em>
              </article>)}
            </div>
          )}
        </section>
      )}

      {view === "knowledge" && (
        <section className="page-sheet knowledge-view">
          <div className="page-title"><div><p className="eyebrow">KNOWLEDGE LEDGER · {modeInfo[mode].name}</p><h2>回答以前，先知道根據在哪。</h2></div><button className="ink-button" onClick={() => setNewRuleOpen(!newRuleOpen)}>＋ 新增規則</button></div>
          {newRuleOpen && <div className="rule-composer"><label htmlFor="new-rule-title">規則名稱</label><input id="new-rule-title" value={newRuleTitle} onChange={(event) => setNewRuleTitle(event.target.value)} placeholder={mode === "clinic" ? "例如：兒童用藥轉交規則" : "例如：安裝報價前置條件"}/><label htmlFor="new-rule">寫下一條 AI 必須遵守的規則</label><textarea id="new-rule" value={newRule} onChange={(event) => setNewRule(event.target.value)} placeholder={mode === "clinic" ? "例如：遇到兒童用藥問題，一律不推算劑量並轉交護理人員。" : "例如：沒有看到現場照片前，不得承諾安裝總價。"}/><div><button onClick={() => setNewRuleOpen(false)}>取消</button><button className="primary-action" onClick={() => void addRule()}>存入帳簿</button></div></div>}
          <div className="knowledge-grid">
            {(modeLearned.length > 0 ? modeLearned : knowledgeByMode[mode].map((item, index) => ({ id: `fallback-${index}`, mode, title: item.title, body: item.scope, createdTimestamp: 0, updatedTimestamp: 0 }))).map((item, index) => <article key={item.id}><span>0{index + 1}</span><p>{item.id.startsWith("fallback-") ? "內建示範" : "工作區規則"}</p><h3>{item.title}</h3><strong>{item.body}</strong><footer>{item.updatedTimestamp ? `最後更新 · ${new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit" }).format(new Date(item.updatedTimestamp))}` : "等待資料庫同步"}</footer></article>)}
          </div>
          <div className="learned-section"><div className="section-heading"><p>儲存原則</p><span>{modeLearned.length} 則工作區共用規則</span></div><div className="empty-state">規則會寫入工作區資料庫，可跨裝置讀取；單次修改回覆只寫入稽核紀錄，不會偷偷改寫全域規則。</div></div>
        </section>
      )}

      {view === "audit" && (
        <section className="page-sheet audit-view">
          <div className="page-title"><div><p className="eyebrow">AUDIT TRAIL · APPEND ONLY</p><h2>好的決定與壞消息，都留得住。</h2></div><span className="audit-count">{auditEntries.length} EVENTS</span></div>
          <div className="audit-table" aria-label="稽核紀錄">
            <div className="audit-row audit-head"><span>時間</span><span>案件</span><span>操作者</span><span>動作與理由</span></div>
            {auditEntries.map((item) => <article className="audit-row" key={item.id}><time>{item.time}</time><strong>{item.caseId}</strong><span>{item.actor}</span><div><b>{item.action}</b><p>{item.detail}</p></div></article>)}
          </div>
        </section>
      )}

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}
