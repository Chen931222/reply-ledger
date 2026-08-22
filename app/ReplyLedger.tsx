"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { casesByMode, knowledgeByMode, modeInfo, seededAudit, type LedgerCase, type Mode, type View } from "./data";

type AuditRecord = (typeof seededAudit)[number];
type LearnedRule = { id: string; mode: Mode; title: string; body: string; createdAt: string };
type LineStatus = {
  databaseReady: boolean;
  receiveReady: boolean;
  sendReady: boolean;
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
type WorkbenchCase = LedgerCase & {
  kind: "live" | "demo";
  sourceId?: string | null;
};
type SendState = "idle" | "confirming" | "sending" | "sent" | "error";

const storageKey = "reply-ledger-v1";

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function formatWaitingTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時`;
  return `${Math.floor(hours / 24)} 天`;
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
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("");
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [lineStatus, setLineStatus] = useState<LineStatus | null>(null);
  const [lineInbox, setLineInbox] = useState<LineInboxEvent[]>([]);
  const [lineLoading, setLineLoading] = useState(true);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState("");
  const auditCounter = useRef(200);
  const sendRequestId = useRef<string | null>(null);

  const liveCases = useMemo<WorkbenchCase[]>(() => {
    const conversations = new Map<string, LineInboxEvent[]>();
    for (const event of lineInbox) {
      if (event.eventType !== "message" || !event.messageText) continue;
      const key = event.sourceId ?? `unknown-${event.id}`;
      const messages = conversations.get(key) ?? [];
      messages.push(event);
      conversations.set(key, messages);
    }

    return Array.from(conversations.entries()).map(([sourceId, events]) => {
      const ordered = [...events].sort((left, right) => left.eventTimestamp - right.eventTimestamp);
      const latest = ordered[ordered.length - 1];
      return {
        id: `LIVE-${sourceId}`,
        kind: "live",
        sourceId: latest.sourceId,
        customer: `LINE 使用者 ${maskLineId(latest.sourceId)}`,
        title: "LINE 即時訊息",
        waiting: formatWaitingTime(latest.eventTimestamp),
        tag: "真實 LINE",
        intent: "待人工判讀",
        urgency: "待確認",
        risk: "尚未分類",
        confidence: 0,
        observation: "這是已通過 LINE 簽章驗證並寫入資料庫的真實訊息，目前尚未進行內容判讀。",
        why: "工作台只確認訊息來源與完整性；在資訊不足時，不會把單一句話猜成商品、報價或售後需求。",
        draft: `您好，已收到您的訊息「${latest.messageText}」。請問您想詢問燈具選購、報價、安裝，還是售後服務呢？`,
        messages: ordered.map((event) => ({
          side: "customer" as const,
          time: formatMessageTime(event.eventTimestamp),
          text: event.messageText ?? "（此事件沒有文字內容）",
        })),
        sources: [{
          label: "LINE 已驗證事件",
          excerpt: `${formatLineTime(latest.eventTimestamp)} 收到；來源 ${maskLineId(latest.sourceId)}。`,
        }],
      };
    }).sort((left, right) => {
      const leftTime = conversations.get(left.sourceId ?? "")?.at(-1)?.eventTimestamp ?? 0;
      const rightTime = conversations.get(right.sourceId ?? "")?.at(-1)?.eventTimestamp ?? 0;
      return rightTime - leftTime;
    });
  }, [lineInbox]);

  const demoCases = useMemo<WorkbenchCase[]>(() => casesByMode[mode].map((item) => ({ ...item, kind: "demo" })), [mode]);
  const cases = mode === "retail" && liveCases.length > 0 ? liveCases : demoCases;
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];
  const currentDraft = selected.id === selectedId ? draft : selected.draft;

  useEffect(() => {
    window.queueMicrotask(() => {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as { audit?: AuditRecord[]; learned?: LearnedRule[] };
          if (parsed.audit) setAudit(parsed.audit);
          if (parsed.learned) setLearned(parsed.learned);
        }
      } catch {
        // The ledger still works when browser storage is unavailable or malformed.
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLineData() {
      const [statusResult, inboxResult] = await Promise.all([
        fetch("/api/line/status", { headers: { accept: "application/json" } }).then(async (response) => response.ok ? await response.json() as LineStatus : null),
        fetch("/api/line/inbox?limit=50", { headers: { accept: "application/json" } }).then(async (response) => response.ok ? await response.json() as { events: LineInboxEvent[] } : null),
      ]);
      if (!active) return;
      if (statusResult) setLineStatus(statusResult);
      if (inboxResult?.events) setLineInbox(inboxResult.events);
      setLineLoading(false);
    }
    void loadLineData();
    const refreshTimer = window.setInterval(() => void loadLineData(), 10_000);
    return () => { active = false; window.clearInterval(refreshTimer); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ audit, learned }));
  }, [audit, hydrated, learned]);

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
    sendRequestId.current = crypto.randomUUID();
    setSendState("confirming");
  }

  async function confirmLineSend() {
    if (selected.kind !== "live" || !selected.sourceId || !sendRequestId.current) return;
    setSendState("sending");
    setSendError("");
    try {
      const response = await fetch("/api/line/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          to: selected.sourceId,
          text: currentDraft.trim(),
          requestId: sendRequestId.current,
        }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 409) throw new Error("這次傳送請求已處理過，請先到 LINE 確認是否收到，避免重複傳送。");
        throw new Error(result?.error ?? "LINE 沒有接受這則訊息。");
      }

      const wasEdited = currentDraft.trim() !== selected.draft.trim();
      logAction("已傳送 LINE", `${wasEdited ? "人工修改後傳送" : "採用建議後傳送"}；收件人 ${maskLineId(selected.sourceId)}。`);
      if (wasEdited) {
        setLearned((items) => [{
          id: `L-${Date.now()}`,
          mode,
          title: `${selected.title} · 人工修正版`,
          body: currentDraft.trim(),
          createdAt: "剛剛",
        }, ...items]);
      }
      setSendState("sent");
      flash("訊息已由 LINE 官方帳號成功傳送。");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "傳送失敗，請稍後再試。");
      setSendState("error");
    }
  }

  function rejectDraft() {
    logAction("拒絕建議", "建議未送出；保留原始內容供後續檢討。 ");
    setSendState("idle");
    setSendError("");
    sendRequestId.current = null;
    flash("已拒絕。這則建議不會被送出，也不會自動學習。");
  }

  function handToHuman() {
    logAction("轉交真人", selected.requiresHuman ? "命中高風險規則，已通知負責人。" : "由使用者主動要求人工接手。 ");
    flash(mode === "clinic" ? "已通知值班人員並保留完整理由。" : "已交給真人客服，AI 暫停這則對話的建議。 ");
  }

  function addRule() {
    if (!newRule.trim()) return;
    setLearned((items) => [{ id: `L-${Date.now()}`, mode, title: "人工新增規則", body: newRule.trim(), createdAt: "剛剛" }, ...items]);
    setNewRule("");
    setNewRuleOpen(false);
    flash("新規則已存入這個裝置的知識帳簿。");
  }

  const modeLearned = useMemo(() => learned.filter((item) => item.mode === mode), [learned, mode]);
  const lineState = lineStatus?.receiveReady ? (lineStatus.eventCount > 0 ? "live" : "ready") : "demo";
  const lineStateLabel = lineState === "live" ? "LINE 已連線" : lineState === "ready" ? "LINE 待測試" : modeInfo[mode].status;

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
            <p className="eyebrow">REPLY LEDGER · 回覆帳簿</p>
            <h1>每一句建議，都留下根據。</h1>
          </div>
        </button>
        <div className="masthead-actions">
          <div className="mode-switch" aria-label="產業模式">
            <button className={mode === "retail" ? "active" : ""} onClick={() => changeMode("retail")}>燈飾零售</button>
            <button className={mode === "clinic" ? "active" : ""} onClick={() => changeMode("clinic")}>診所觀察員</button>
          </div>
          <button className={`pause-button ${paused ? "paused" : ""}`} type="button" onClick={() => { setPaused(!paused); flash(paused ? "AI 觀察已恢復。" : "AI 觀察已暫停，真人仍可查看既有內容。"); }}>
            <span className="live-dot" aria-hidden="true" />
            {paused ? "恢復觀察" : lineStateLabel}
          </button>
        </div>
      </header>

      <nav className="view-nav" aria-label="主要頁面">
        {(["workspace", "line", "knowledge", "audit"] as View[]).map((item, index) => (
          <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
            <span>0{index + 1}</span>{item === "workspace" ? "工作台" : item === "line" ? "LINE 收件匣" : item === "knowledge" ? "知識帳簿" : "稽核紀錄"}
          </button>
        ))}
        <a className="tour-link" href="/intro.html">觀看 60 秒導覽 ↗</a>
        <p>{modeInfo[mode].note}</p>
      </nav>

      <button className={`integration-strip state-${lineState}`} type="button" onClick={() => setView("line")}>
        <span className="integration-kicker">CONNECTION</span>
        <strong>{lineLoading ? "目前顯示 Demo 資料，正在確認 LINE 狀態" : lineState === "live" ? `已收到 ${lineStatus?.eventCount ?? 0} 個真實事件` : lineState === "ready" ? "Webhook 已設定，等待第一則真實訊息" : "目前顯示 Demo 資料，尚未連接 LINE 官方帳號"}</strong>
        <span>{lineStatus?.sendReady ? "人工傳送已備妥" : "傳送功能鎖定"} →</span>
      </button>

      {view === "workspace" && (
        <section className="workbench" aria-label="AI 客服觀察工作台">
          <aside className="queue-panel">
            <div className="section-label"><span>01</span><p>{cases[0]?.kind === "live" ? "真實待回覆" : "示範案例"}</p><strong>{cases.length}</strong></div>
            {cases.map((item) => (
              <button className={`queue-item ${item.id === selected.id ? "active" : ""}`} key={item.id} onClick={() => { setSelectedId(item.id); setDraft(item.draft); setEditing(false); setSendState("idle"); setSendError(""); sendRequestId.current = null; }}>
                <span className="queue-topline"><span className={item.requiresHuman ? "risk-tag" : ""}>{item.tag}</span><time>{item.waiting}</time></span>
                <strong>{item.customer}</strong>
                <span>{item.messages[item.messages.length - 1].text}</span>
              </button>
            ))}
            <footer className="queue-footer"><span>{cases[0]?.kind === "live" ? `真實 LINE · ${cases.length} 位` : "DEMO · 非真實訊息"}</span><span>{cases[0]?.kind === "live" ? "即時同步" : "示範模式"}</span></footer>
          </aside>

          <section className="conversation-panel">
            <div className="conversation-head">
              <div><p className="eyebrow">{selected.kind === "live" ? "LIVE LINE" : "DEMO LINE"} · {selected.customer}</p><h2>{selected.title}</h2></div>
              <span className="case-number">CASE {selected.id}</span>
            </div>
            <div className="messages">
              {selected.messages.map((message, index) => (
                <div className={`message-row ${message.side}`} key={`${selected.id}-${index}`}>
                  <time>{message.time}</time><p>{message.text}</p>
                </div>
              ))}
            </div>
            <div className="observation-note"><span>觀察</span>{selected.observation}</div>
            <div className="why-note"><span>為什麼</span><p>{selected.why}</p></div>
          </section>

          <aside className={`advice-panel ${paused ? "is-paused" : ""}`}>
            <div className="section-label"><span>02</span><p>建議回覆</p><strong className="confidence">{selected.kind === "live" ? "待判讀" : `${selected.confidence}%`}</strong></div>
            {paused && <div className="pause-notice"><strong>AI 觀察已暫停</strong><p>既有分析仍保留，但不會產生新建議。</p></div>}
            <div className="analysis-grid">
              <div><span>意圖</span><strong>{selected.intent}</strong></div>
              <div><span>急迫度</span><strong>{selected.urgency}</strong></div>
              <div><span>風險</span><strong className="accent-text">{selected.risk}</strong></div>
            </div>
            <div className="draft-block">
              <p className="margin-label">DRAFT / HUMAN REVIEW REQUIRED</p>
              {editing ? (
                <textarea aria-label="修改建議回覆" value={currentDraft} onChange={(event) => { if (selected.id !== selectedId) setSelectedId(selected.id); setDraft(event.target.value); setSendState("idle"); setSendError(""); sendRequestId.current = null; }} rows={11} />
              ) : <blockquote>{currentDraft}</blockquote>}
            </div>
            <details className="sources" open>
              <summary>根據 · {selected.sources.length} 份</summary>
              {selected.sources.map((source, index) => (
                <div className="source-row" key={source.label}><strong>0{index + 1}</strong><span><b>{source.label}</b>{source.excerpt}</span></div>
              ))}
            </details>
            {selected.requiresHuman && <button className="handoff-banner" type="button" onClick={handToHuman}><strong>高風險事件</strong><span>交給真人處理 →</span></button>}
            {(sendState === "confirming" || sendState === "sending" || sendState === "error") && (
              <section className="send-confirmation" role="alertdialog" aria-labelledby="send-confirmation-title" aria-describedby="send-confirmation-copy">
                <p className="margin-label">FINAL CHECK · THIS WILL SEND</p>
                <h3 id="send-confirmation-title">確認傳送給 {maskLineId(selected.sourceId ?? null)}</h3>
                <p id="send-confirmation-copy" className="send-confirmation-copy">{currentDraft.trim()}</p>
                {sendError && <p className="send-error" role="alert">{sendError}</p>}
                <div className="send-confirmation-actions">
                  <button type="button" onClick={() => { setSendState("idle"); setSendError(""); sendRequestId.current = null; }} disabled={sendState === "sending"}>返回修改</button>
                  <button type="button" className="primary-action" onClick={confirmLineSend} disabled={sendState === "sending"}>{sendState === "sending" ? "傳送中…" : sendState === "error" ? "重新確認傳送" : "確認，現在傳送"}</button>
                </div>
              </section>
            )}
            <div className="decision-row" aria-label="回覆決策">
              <button type="button" className="primary-action" onClick={prepareLineSend} disabled={paused || selected.kind !== "live" || sendState === "sending" || sendState === "sent"}>{sendState === "sent" ? "已傳送到 LINE" : selected.kind === "live" ? "確認並傳送到 LINE" : "示範案例不可傳送"}</button>
              <button type="button" onClick={() => { if (selected.id !== selectedId) { setSelectedId(selected.id); setDraft(selected.draft); } setSendState("idle"); setSendError(""); sendRequestId.current = null; setEditing(!editing); }}>{editing ? "完成修改" : "修改"}</button>
              <button type="button" onClick={rejectDraft}>拒絕</button>
            </div>
            <button className="quiet-handoff" type="button" onClick={handToHuman}>不使用建議，直接交給真人</button>
            <p className="send-lock">只有真人完成第二次確認後才會傳送；LINE 結果與操作者會留下紀錄。</p>
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
        </section>
      )}

      {view === "knowledge" && (
        <section className="page-sheet knowledge-view">
          <div className="page-title"><div><p className="eyebrow">KNOWLEDGE LEDGER · {modeInfo[mode].name}</p><h2>回答以前，先知道根據在哪。</h2></div><button className="ink-button" onClick={() => setNewRuleOpen(!newRuleOpen)}>＋ 新增規則</button></div>
          {newRuleOpen && <div className="rule-composer"><label htmlFor="new-rule">寫下一條 AI 必須遵守的規則</label><textarea id="new-rule" value={newRule} onChange={(event) => setNewRule(event.target.value)} placeholder={mode === "clinic" ? "例如：遇到兒童用藥問題，一律不推算劑量並轉交護理人員。" : "例如：沒有看到現場照片前，不得承諾安裝總價。"}/><div><button onClick={() => setNewRuleOpen(false)}>取消</button><button className="primary-action" onClick={addRule}>存入帳簿</button></div></div>}
          <div className="knowledge-grid">
            {knowledgeByMode[mode].map((item, index) => <article key={item.title}><span>0{index + 1}</span><p>{item.type}</p><h3>{item.title}</h3><strong>{item.scope}</strong><footer>最後更新 · {item.updated}</footer></article>)}
          </div>
          <div className="learned-section"><div className="section-heading"><p>人工修正案例</p><span>{modeLearned.length} 則自這個裝置累積</span></div>{modeLearned.length === 0 ? <div className="empty-state">採用修改過的回覆後，它會以案例形式出現在這裡；AI 不會因單次修改自動改寫全部規則。</div> : modeLearned.map((item) => <article className="learned-row" key={item.id}><span>{item.createdAt}</span><div><h3>{item.title}</h3><p>{item.body}</p></div></article>)}</div>
        </section>
      )}

      {view === "audit" && (
        <section className="page-sheet audit-view">
          <div className="page-title"><div><p className="eyebrow">AUDIT TRAIL · APPEND ONLY</p><h2>好的決定與壞消息，都留得住。</h2></div><span className="audit-count">{audit.length} EVENTS</span></div>
          <div className="audit-table" aria-label="稽核紀錄">
            <div className="audit-row audit-head"><span>時間</span><span>案件</span><span>操作者</span><span>動作與理由</span></div>
            {audit.map((item) => <article className="audit-row" key={item.id}><time>{item.time}</time><strong>{item.caseId}</strong><span>{item.actor}</span><div><b>{item.action}</b><p>{item.detail}</p></div></article>)}
          </div>
        </section>
      )}

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}
