import LeadForm from "./LeadForm";

type LandingPageProps = {
  workspaceHref: string;
  signedIn: boolean;
};

export default function LandingPage({ workspaceHref, signedIn }: LandingPageProps) {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="公開網站導覽">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="landing-brand" href="/" aria-label="Reply Ledger 首頁">
          <span>R/L</span>
          <strong>REPLY LEDGER · 回覆帳簿</strong>
        </a>
        <div>
          <a href="#case-study">成果案例</a>
          <a href="#product-film">操作影片</a>
          <a className="landing-enter" href="#apply">申請 14 天試用</a>
        </div>
      </nav>

      <section className="landing-hero">
        <p className="landing-index">LINE SHARED INBOX · HUMAN-REVIEWED</p>
        <div className="landing-hero-title">
          <span>給燈飾門市與客服團隊</span>
          <h1>回得快，<br />更要回得有根據。</h1>
        </div>
        <div className="landing-hero-foot">
          <p>把 LINE 詢價、安裝與售後訊息集中在同一張工作桌。系統先找規則、標示未知與整理草稿，最後仍由真人確認送出。</p>
          <div className="landing-hero-actions">
            <a className="landing-primary" href="#apply">申請 14 天試用</a>
            <a className="landing-secondary" href="#apply">預約 Demo</a>
          </div>
        </div>
      </section>

      <section className="landing-outcomes" aria-label="產品成果">
        <p className="landing-index">01 / THE CONTROL LAYER</p>
        <div className="landing-outcomes-grid">
          <article><span>01</span><h2>收件不漏接</h2><p>真實 LINE 訊息集中排隊，可搜尋、分派、標示逾時；上百則也只分頁載入需要看的部分。</p></article>
          <article><span>02</span><h2>回覆不亂猜</h2><p>建議旁直接列出價目、安裝規則與限制。缺資料時先追問，不把未知寫成承諾。</p></article>
          <article><span>03</span><h2>決定有紀錄</h2><p>採用、修改、拒絕、轉交與 LINE 傳送結果都記帳，之後找得到誰在何時做了什麼。</p></article>
        </div>
      </section>

      <section className="landing-case" id="case-study">
        <div className="landing-case-head">
          <div>
            <p className="landing-index">02 / PRODUCT VALIDATION CASE</p>
            <h2>一則「含安裝多少？」<br />沒有被草率報成總價。</h2>
          </div>
          <p>產品驗證案例｜燈飾報價詢問</p>
        </div>
        <div className="landing-case-grid">
          <blockquote>
            <small>LINE 客戶 · 10:34</small>
            「大概 2 米 8。你們 L-42 那款適合嗎？含安裝多少？」
          </blockquote>
          <div className="landing-case-result">
            <p className="landing-index">REPLY LEDGER 的處理</p>
            <h3>報出已知售價，保留未知安裝費。</h3>
            <p>系統引用 L-42 售價 NT$8,600 與選型規則，同時發現缺少出線位置、固定方式與現場照片，因此草稿先請客戶補資料，再交由真人確認。</p>
            <ul>
              <li><strong>0</strong><span>次虛構安裝總價</span></li>
              <li><strong>3</strong><span>份根據放在草稿旁</span></li>
              <li><strong>0</strong><span>則未經真人確認送出</span></li>
            </ul>
          </div>
        </div>
        <p className="landing-disclosure">此為使用固定測試資料完成的產品驗證案例，不是客戶營收或轉換率案例。</p>
      </section>

      <section className="landing-film" id="product-film">
        <div className="landing-film-copy">
          <p className="landing-index">03 / REAL PRODUCT WALKTHROUGH</p>
          <h2>三分鐘，看一則訊息如何留下完整根據。</h2>
          <p>影片由實際運作中的 Reply Ledger 工作台錄製：從 LINE 收件、知識查核、真人覆核，到稽核紀錄。畫面不是設計稿。</p>
          <div className="landing-film-notes"><span>03:00</span><span>繁體中文字幕</span><span>真實產品畫面</span></div>
        </div>
        <div className="landing-video-frame">
          <video controls preload="metadata" poster="/reply-ledger-demo-poster.png">
            <source src="/reply-ledger-demo-3min.mp4" type="video/mp4" />
            <track kind="captions" src="/reply-ledger-demo-zh-TW.vtt" srcLang="zh-TW" label="繁體中文" default />
            你的瀏覽器不支援影片播放。
          </video>
        </div>
      </section>

      <section className="landing-apply" id="apply">
        <div className="landing-apply-copy">
          <p className="landing-index">04 / START WITH ONE REAL WORKFLOW</p>
          <h2>拿一種最常出錯的 LINE 詢問，先跑 14 天。</h2>
          <p>我們會先整理一組知識規則、接一個 LINE 官方帳號，並陪你驗證人工覆核流程。也可以先預約 30 分鐘 Demo。</p>
          <ol>
            <li><span>01</span>選一個高頻情境</li>
            <li><span>02</span>匯入可引用的規則</li>
            <li><span>03</span>接通 LINE 並由真人試跑</li>
          </ol>
        </div>
        <LeadForm />
      </section>

      <footer className="landing-footer">
        <div><span>R/L</span><strong>每一句建議，都留下根據。</strong></div>
        <p>公開頁不載入任何真實 LINE 資料；申請資料只用於聯絡試用或 Demo。工作台需登入後使用。</p>
        <a href={workspaceHref} target="_top">{signedIn ? "開啟客戶工作台" : "客戶登入"} →</a>
      </footer>
    </main>
  );
}
