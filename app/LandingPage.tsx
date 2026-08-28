type LandingPageProps = {
  workspaceHref: string;
  signedIn: boolean;
};

export default function LandingPage({ workspaceHref, signedIn }: LandingPageProps) {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="公開網站導覽">
        <Link className="landing-brand" href="/" aria-label="Reply Ledger 首頁">
          <span>R/L</span>
          <strong>REPLY LEDGER · 回覆帳簿</strong>
        </Link>
        <div>
          <a href="/intro.html">60 秒導覽</a>
          <a className="landing-enter" href={workspaceHref} target="_top">
            {signedIn ? "開啟工作台" : "登入工作台"} →
          </a>
        </div>
      </nav>

      <section className="landing-hero">
        <p className="landing-index">01 / HUMAN-REVIEWED LINE WORKSPACE</p>
        <h1>AI 不替你說話。<br />先把根據放上桌。</h1>
        <div className="landing-hero-foot">
          <p>為燈飾零售與高風險客服設計：讀懂 LINE 訊息、查核規則、提出草稿，最後仍由真人決定是否送出。</p>
          <a href={workspaceHref} target="_top">{signedIn ? "進入真實工作台" : "以 ChatGPT 登入"}</a>
        </div>
      </section>

      <section className="landing-proof" aria-label="產品運作方式">
        <article><span>01</span><p>VERIFIED INPUT</p><h2>只收通過 LINE 簽章的訊息</h2><strong>偽造事件不會進入工作台，重送事件也不會重複記帳。</strong></article>
        <article><span>02</span><p>GROUNDED DRAFT</p><h2>建議旁邊，直接列出根據</h2><strong>不知道的價格、安裝條件與醫療資訊，不靠猜測補齊。</strong></article>
        <article><span>03</span><p>HUMAN DECISION</p><h2>第二次確認後才傳送</h2><strong>採用、修改、拒絕與 LINE 結果，全部留下操作者紀錄。</strong></article>
      </section>

      <section className="landing-demo" aria-label="工作台示意">
        <div className="landing-demo-copy">
          <p className="landing-index">02 / ONE CONVERSATION, ONE DECISION</p>
          <h2>客服不是聊天框。<br />它是一張決策桌。</h2>
          <p>左邊看客戶說了什麼，中間保留完整往來，右邊只放現在需要決定的事。資訊不夠時，系統會先問問題，而不是假裝知道答案。</p>
          <a href="/intro.html">觀看產品導覽 ↗</a>
        </div>
        <div className="landing-workbench" aria-hidden="true">
          <header><span>LINE · 真實事件</span><b>待人工處理</b></header>
          <div className="landing-message customer"><small>客戶 · 10:34</small><p>大概 2 米 8。你們 L-42 那款適合嗎？含安裝多少？</p></div>
          <div className="landing-analysis"><span>NEXT ACTION</span><strong>先確認安裝條件，再提供完整價格</strong><p>風險：安裝費未知</p></div>
          <div className="landing-message staff"><small>建議草稿 · 尚未送出</small><p>尺寸比例適合；燈具售價為 NT$8,600。安裝費需依出線位置與固定方式確認，方便提供現場照片嗎？</p></div>
          <footer><span>根據 · 3 份</span><b>真人確認後送出</b></footer>
        </div>
      </section>

      <footer className="landing-footer">
        <div><span>R/L</span><strong>每一句建議，都留下根據。</strong></div>
        <p>公開頁不載入任何真實 LINE 資料；登入後才可進入受保護的客服工作台。</p>
        <a href={workspaceHref} target="_top">{signedIn ? "開啟工作台" : "登入工作台"} →</a>
      </footer>
    </main>
  );
}
import Link from "next/link";
