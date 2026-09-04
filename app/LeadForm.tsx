"use client";

import { FormEvent, useState } from "react";

type RequestType = "trial" | "demo";

export default function LeadForm() {
  const [requestType, setRequestType] = useState<RequestType>("trial");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "送出失敗，請稍後再試。");
      setState("sent");
      setMessage(requestType === "trial" ? "申請已收到，我們會聯絡你安排 14 天試用。" : "預約已收到，我們會聯絡你確認 Demo 時間。");
      event.currentTarget.reset();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "送出失敗，請稍後再試。");
    }
  }

  return (
    <form className="lead-form" onSubmit={submit} aria-busy={state === "sending"}>
      <fieldset className="lead-choice">
        <legend>我想要</legend>
        <label className={requestType === "trial" ? "active" : ""}>
          <input type="radio" name="requestType" value="trial" checked={requestType === "trial"} onChange={() => setRequestType("trial")} />
          <span>申請 14 天試用</span>
          <small>用你的 LINE 情境實際驗證</small>
        </label>
        <label className={requestType === "demo" ? "active" : ""}>
          <input type="radio" name="requestType" value="demo" checked={requestType === "demo"} onChange={() => setRequestType("demo")} />
          <span>預約 Demo</span>
          <small>30 分鐘看完整工作流程</small>
        </label>
      </fieldset>

      <div className="lead-fields">
        <label><span>公司／品牌名稱 *</span><input name="companyName" required minLength={2} maxLength={120} autoComplete="organization" /></label>
        <label><span>聯絡人 *</span><input name="contactName" required minLength={2} maxLength={80} autoComplete="name" /></label>
        <label><span>工作 Email *</span><input name="email" type="email" required maxLength={180} autoComplete="email" /></label>
        <label><span>電話或 LINE ID</span><input name="phoneOrLine" maxLength={80} autoComplete="tel" /></label>
        <label className="lead-wide"><span>每月 LINE 詢問量</span><select name="monthlyVolume" defaultValue=""><option value="">尚不確定</option><option value="under-300">300 則以下</option><option value="300-1000">300–1,000 則</option><option value="1000-3000">1,000–3,000 則</option><option value="over-3000">3,000 則以上</option></select></label>
        <label className="lead-wide"><span>最想改善的問題</span><textarea name="note" maxLength={1000} rows={4} placeholder="例如：報價容易漏掉安裝條件、多人回覆沒有交接紀錄…" /></label>
        <label className="lead-honeypot" aria-hidden="true"><span>網站</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <div className="lead-submit-row">
        <button type="submit" disabled={state === "sending"}>{state === "sending" ? "送出中…" : requestType === "trial" ? "送出 14 天試用申請" : "送出 Demo 預約"}</button>
        <p>不需信用卡。正式串接前會先確認權限與資料範圍。</p>
      </div>
      {message ? <p className={`lead-feedback ${state}`} role="status">{message}</p> : null}
    </form>
  );
}
