"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { casesByMode, knowledgeByMode, modeInfo, seededAudit, type Mode, type View } from "./data";

type AuditRecord = (typeof seededAudit)[number];
type LearnedRule = { id: string; mode: Mode; title: string; body: string; createdAt: string };

const storageKey = "reply-ledger-v1";

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
  const auditCounter = useRef(200);

  const cases = casesByMode[mode];
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];

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
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ audit, learned }));
  }, [audit, hydrated, learned]);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setSelectedId(casesByMode[nextMode][0].id);
    setDraft(casesByMode[nextMode][0].draft);
    setEditing(false);
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

  function adoptDraft() {
    const wasEdited = draft.trim() !== selected.draft.trim();
    logAction(wasEdited ? "修改後採用" : "採用建議", `保留人工確認；未由 AI 自動送出。${wasEdited ? "修改內容已寫入案例簿。" : ""}`);
    if (wasEdited) {
      setLearned((items) => [{
        id: `L-${Date.now()}`,
        mode,
        title: `${selected.title} · 人工修正版`,
        body: draft,
        createdAt: "剛剛",
      }, ...items]);
    }
    setEditing(false);
    flash("已採用並送交真人確認；AI 沒有自行傳送訊息。");
  }

  function rejectDraft() {
    logAction("拒絕建議", "建議未送出；保留原始內容供後續檢討。 ");
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
            {paused ? "恢復觀察" : modeInfo[mode].status}
          </button>
        </div>
      </header>

      <nav className="view-nav" aria-label="主要頁面">
        {(["workspace", "knowledge", "audit"] as View[]).map((item, index) => (
          <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
            <span>0{index + 1}</span>{item === "workspace" ? "工作台" : item === "knowledge" ? "知識帳簿" : "稽核紀錄"}
          </button>
        ))}
        <a className="tour-link" href="/intro.html">觀看 60 秒導覽 ↗</a>
        <p>{modeInfo[mode].note}</p>
      </nav>

      {view === "workspace" && (
        <section className="workbench" aria-label="AI 客服觀察工作台">
          <aside className="queue-panel">
            <div className="section-label"><span>01</span><p>等待回覆</p><strong>{cases.length}</strong></div>
            {cases.map((item) => (
              <button className={`queue-item ${item.id === selected.id ? "active" : ""}`} key={item.id} onClick={() => { setSelectedId(item.id); setDraft(item.draft); setEditing(false); }}>
                <span className="queue-topline"><span className={item.requiresHuman ? "risk-tag" : ""}>{item.tag}</span><time>{item.waiting}</time></span>
                <strong>{item.customer}</strong>
                <span>{item.messages[item.messages.length - 1].text}</span>
              </button>
            ))}
            <footer className="queue-footer"><span>今日 18 件</span><span>平均等待 7m 42s</span></footer>
          </aside>

          <section className="conversation-panel">
            <div className="conversation-head">
              <div><p className="eyebrow">LINE · {selected.customer}</p><h2>{selected.title}</h2></div>
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
            <div className="section-label"><span>02</span><p>建議回覆</p><strong className="confidence">{selected.confidence}%</strong></div>
            {paused && <div className="pause-notice"><strong>AI 觀察已暫停</strong><p>既有分析仍保留，但不會產生新建議。</p></div>}
            <div className="analysis-grid">
              <div><span>意圖</span><strong>{selected.intent}</strong></div>
              <div><span>急迫度</span><strong>{selected.urgency}</strong></div>
              <div><span>風險</span><strong className="accent-text">{selected.risk}</strong></div>
            </div>
            <div className="draft-block">
              <p className="margin-label">DRAFT / HUMAN REVIEW REQUIRED</p>
              {editing ? (
                <textarea aria-label="修改建議回覆" value={draft} onChange={(event) => setDraft(event.target.value)} rows={11} />
              ) : <blockquote>{draft}</blockquote>}
            </div>
            <details className="sources" open>
              <summary>根據 · {selected.sources.length} 份</summary>
              {selected.sources.map((source, index) => (
                <div className="source-row" key={source.label}><strong>0{index + 1}</strong><span><b>{source.label}</b>{source.excerpt}</span></div>
              ))}
            </details>
            {selected.requiresHuman && <button className="handoff-banner" type="button" onClick={handToHuman}><strong>高風險事件</strong><span>交給真人處理 →</span></button>}
            <div className="decision-row" aria-label="回覆決策">
              <button type="button" className="primary-action" onClick={adoptDraft} disabled={paused}>採用，交真人確認</button>
              <button type="button" onClick={() => setEditing(!editing)}>{editing ? "完成修改" : "修改"}</button>
              <button type="button" onClick={rejectDraft}>拒絕</button>
            </div>
            <button className="quiet-handoff" type="button" onClick={handToHuman}>不使用建議，直接交給真人</button>
            <p className="send-lock">AI 不會自行送出。所有採用、修改與拒絕都會留下紀錄。</p>
          </aside>
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
