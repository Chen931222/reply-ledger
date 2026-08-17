export type Mode = "retail" | "clinic";
export type View = "workspace" | "knowledge" | "audit";

export type LedgerCase = {
  id: string;
  customer: string;
  title: string;
  waiting: string;
  tag: string;
  intent: string;
  urgency: string;
  risk: string;
  confidence: number;
  observation: string;
  draft: string;
  why: string;
  requiresHuman?: boolean;
  messages: { side: "customer" | "staff"; time: string; text: string }[];
  sources: { label: string; excerpt: string }[];
};

export const modeInfo = {
  retail: {
    name: "燈飾零售",
    short: "零售",
    status: "LINE 觀察中",
    note: "可以草擬商品與報價回覆；未知的安裝費與庫存不得猜測。",
  },
  clinic: {
    name: "診所觀察員",
    short: "診所",
    status: "只讀監測",
    note: "涉及醫療與客訴，AI 只能分析、提醒與草擬，永遠不能自行送出。",
  },
} as const;

export const casesByMode: Record<Mode, LedgerCase[]> = {
  retail: [
    {
      id: "R-018",
      customer: "王小姐",
      title: "餐桌吊燈諮詢",
      waiting: "6 分鐘",
      tag: "報價待確認",
      intent: "選品＋報價",
      urgency: "中",
      risk: "安裝費未知",
      confidence: 82,
      observation: "客戶同時詢問適配性與含安裝價格。價目表只有燈具售價，不能直接承諾安裝總價。",
      why: "尺寸與色溫建議可由選型手冊回答；安裝費受出線、固定方式與樓高影響，依規則必須先取得現場照片。",
      draft: "以 160 公分餐桌與 2.8 米天花來看，L-42 的尺寸比例合適；建議選 3000K 暖白光並搭配可調光版本，會比較不刺眼。燈具目前是 NT$8,600。安裝費需依現場出線與固定方式確認，我先不替你亂估；方便拍一張天花板出線位置給我嗎？確認後再給你完整價格。",
      messages: [
        { side: "customer", time: "10:24", text: "你好，想找餐桌上方的吊燈。桌子 160 公分，希望亮一點但不要刺眼，預算一萬內。" },
        { side: "staff", time: "10:31", text: "收到，我先替你確認尺寸與合適的光型。空間天花板大約多高呢？" },
        { side: "customer", time: "10:34", text: "大概 2 米 8。你們 L-42 那款適合嗎？含安裝多少？" },
      ],
      sources: [
        { label: "2026 零售價目表 · L-42", excerpt: "L-42 吊燈｜售價 NT$8,600｜可調光版另計" },
        { label: "餐桌吊燈選型手冊 · §3", excerpt: "燈體寬度建議為桌寬的 1/3–1/2；餐桌情境以 2700–3000K 為主。" },
        { label: "安裝報價規則 · 現場確認", excerpt: "未取得出線位置與固定面照片前，不提供安裝總價。" },
      ],
    },
    {
      id: "R-019",
      customer: "林先生",
      title: "軌道燈自行更換",
      waiting: "12 分鐘",
      tag: "一般詢問",
      intent: "產品操作",
      urgency: "低",
      risk: "電氣安全",
      confidence: 91,
      observation: "客戶想自行拆裝燈具。可以提供相容性資訊，但必須先提醒斷電，且不能遠端判斷現場線路狀況。",
      why: "產品手冊確認 T-10 採標準兩線式軌道頭；安全規則要求任何拆裝說明都必須先附斷電提醒。",
      draft: "T-10 採標準兩線式軌道頭，原則上可以自行更換。操作前請先關閉該迴路電源，確認燈具冷卻後再拆；如果軌道有鬆動、焦痕或不確定規格，請先不要操作，拍下軌道接頭與舊燈標示，我們替你確認。",
      messages: [
        { side: "customer", time: "10:18", text: "你們 T-10 軌道燈可以自己換嗎？還是一定要找水電？" },
        { side: "staff", time: "10:22", text: "我先確認你家使用的軌道規格。方便提供舊燈或軌道接頭的照片嗎？" },
        { side: "customer", time: "10:28", text: "看起來是一般兩條銅片那種，我只是想換同款。" },
      ],
      sources: [
        { label: "T-10 產品手冊 · 安裝", excerpt: "相容於標準兩線式軌道；額定電壓 AC 110V。" },
        { label: "客服安全規則 · 斷電", excerpt: "涉及拆裝、異味、焦痕時，回覆第一段必須提醒斷電。" },
      ],
    },
    {
      id: "R-020",
      customer: "張小姐",
      title: "新裝燈具閃爍",
      waiting: "18 分鐘",
      tag: "售後警示",
      intent: "故障排查",
      urgency: "高",
      risk: "需立即轉真人",
      confidence: 96,
      requiresHuman: true,
      observation: "安裝後持續閃爍可能涉及驅動器、調光器相容性或接線問題。不得要求客戶自行拆線檢查。",
      why: "售後安全規則將『閃爍伴隨異音、異味或發熱』列為人工接手事件；先停用再安排技師。",
      draft: "先請關閉這盞燈的電源，暫時不要自行拆開或重新接線。想確認閃爍時是否伴隨異音、異味或明顯發熱？我已把案件標記給售後人員，會由真人協助確認調光器與驅動器規格，並安排後續檢查。",
      messages: [
        { side: "customer", time: "09:58", text: "上週裝的客廳燈這兩天一直閃，有時候還會突然暗掉。" },
        { side: "staff", time: "10:02", text: "了解，我幫你查安裝紀錄。請問是整盞一起閃，還是其中一個燈泡？" },
        { side: "customer", time: "10:10", text: "整盞，剛剛還有一點滋滋聲。" },
      ],
      sources: [
        { label: "售後安全規則 · P1 事件", excerpt: "閃爍合併異音、異味或發熱：立即停用並轉交售後技師。" },
        { label: "安裝紀錄 · WO-260808", excerpt: "L-58 可調光吊燈；現場沿用原調光器。" },
      ],
    },
  ],
  clinic: [
    {
      id: "C-041",
      customer: "陳小姐",
      title: "拔牙後持續出血",
      waiting: "9 分鐘",
      tag: "醫療風險",
      intent: "術後症狀",
      urgency: "高",
      risk: "出血／需真人判斷",
      confidence: 97,
      requiresHuman: true,
      observation: "患者描述拔牙後持續滲血。AI 不應診斷或判定正常與否，需提醒依衛教先加壓並立即通知診所人員。",
      why: "診所規則將術後出血列為紅色事件；AI 僅能引用已核准衛教並收集必要資訊，不能提供診斷。",
      draft: "收到，我先請診所人員立刻協助判斷。請依術後衛教使用乾淨紗布在傷口處持續咬緊加壓，先不要頻繁吐口水或漱口。想確認目前是紗布持續被鮮血浸透，還是只有口水帶血？若出血量明顯增加、呼吸不適或感到暈眩，請立即就近就醫。",
      messages: [
        { side: "customer", time: "14:02", text: "我今天中午拔智齒，現在好像還一直流血，這樣正常嗎？" },
        { side: "staff", time: "14:05", text: "我先幫你通知護理人員。請問目前有按照衛教咬紗布嗎？" },
        { side: "customer", time: "14:11", text: "有，但換第二塊還是紅紅的，我有點擔心。" },
      ],
      sources: [
        { label: "拔牙術後衛教 · 核准版", excerpt: "使用乾淨紗布持續加壓；避免漱口與反覆吐口水。" },
        { label: "診所規則 · 紅色事件", excerpt: "持續出血、呼吸不適、暈眩：立即通知值班人員並提供就醫警示。" },
      ],
    },
    {
      id: "C-042",
      customer: "何先生",
      title: "更改回診時間",
      waiting: "14 分鐘",
      tag: "預約異動",
      intent: "更改預約",
      urgency: "低",
      risk: "需核對可約時段",
      confidence: 88,
      observation: "客戶希望改約。系統目前沒有即時診表權限，不能承諾指定時段，只能蒐集偏好後交櫃檯確認。",
      why: "預約規則規定：沒有取得排班系統即時結果時，只能說『協助確認』，不得說『已為你保留』。",
      draft: "可以，我先替你記下改約需求。你比較方便週三下午或週四上午呢？目前我還不能直接確認診表，收到偏好後會交由櫃檯核對，再由真人回覆確切時間；原預約在確認前會先保留。",
      messages: [
        { side: "customer", time: "13:44", text: "我明天下午的回診臨時不能去，可以改星期三嗎？" },
        { side: "staff", time: "13:47", text: "可以協助確認，請問星期三上午或下午哪個比較方便？" },
        { side: "customer", time: "13:50", text: "下午，最好三點後。" },
      ],
      sources: [
        { label: "預約異動規則 · §2", excerpt: "診表未同步時不得承諾時段；原預約保留至人工確認。" },
        { label: "櫃檯案例 014", excerpt: "先收集兩個可行區段，降低來回確認次數。" },
      ],
    },
    {
      id: "C-043",
      customer: "林媽媽",
      title: "兒童用藥詢問",
      waiting: "21 分鐘",
      tag: "用藥警示",
      intent: "劑量確認",
      urgency: "高",
      risk: "兒童用藥／不可推算",
      confidence: 99,
      requiresHuman: true,
      observation: "家長詢問兒童退燒藥劑量。AI 不得依體重自行換算，需核對藥袋並交由醫護人員。",
      why: "涉及兒童用藥、劑量與頻率，依診所禁止回答清單必須轉真人；草稿只收集藥袋與症狀資訊。",
      draft: "兒童用藥劑量需要依醫師處方與藥袋標示確認，我不會在這裡替孩子換算。請先不要自行增加劑量，方便拍下藥袋正反面並告訴我孩子目前體溫、最後一次服藥時間嗎？我會立刻交由診所人員核對。若孩子意識不清、呼吸困難或出現抽搐，請立即就近就醫。",
      messages: [
        { side: "customer", time: "11:03", text: "小朋友 18 公斤，退燒藥水一次要喝幾 cc？藥袋找不到了。" },
        { side: "staff", time: "11:07", text: "我先請護理人員協助，請問藥水瓶身上有名稱或濃度標示嗎？" },
        { side: "customer", time: "11:12", text: "只看到粉紅色的，現在又燒到 39 度。" },
      ],
      sources: [
        { label: "診所禁止回答清單 · 用藥", excerpt: "不得依體重推算兒童劑量；必須核對處方或由醫護人員回覆。" },
        { label: "兒科警示規則 · 核准版", excerpt: "意識不清、呼吸困難、抽搐：提供立即就醫警示。" },
      ],
    },
  ],
};

export const knowledgeByMode = {
  retail: [
    { title: "2026 零售價目表", type: "PRICE-LIST.MD", updated: "今天 09:10", scope: "86 項商品售價與版本差異" },
    { title: "燈具選型手冊", type: "PLAYBOOK.MD", updated: "8 月 15 日", scope: "尺寸、色溫、照度與空間建議" },
    { title: "安裝與售後規則", type: "GUARDRAILS.MD", updated: "8 月 12 日", scope: "報價邊界、安全提醒與轉真人條件" },
  ],
  clinic: [
    { title: "診所回覆規則", type: "CLINIC-RULES.MD", updated: "今天 08:40", scope: "可回答範圍、禁答項目與權限" },
    { title: "核准衛教資料", type: "EDUCATION.MD", updated: "8 月 16 日", scope: "12 份醫師核准的術前術後衛教" },
    { title: "老闆案例簿", type: "OWNER-CASES.MD", updated: "8 月 14 日", scope: "真人採用過的 31 則高風險案例" },
  ],
} as const;

export const seededAudit = [
  { id: "A-106", time: "10:18", actor: "林店長", action: "修改後採用", caseId: "R-014", detail: "將『保固一年』改為『依產品保固卡為準』" },
  { id: "A-105", time: "09:42", actor: "系統", action: "轉交真人", caseId: "R-012", detail: "偵測到焦味與發熱，觸發售後安全規則" },
  { id: "A-104", time: "09:10", actor: "陳護理師", action: "拒絕建議", caseId: "C-038", detail: "缺少患者處方資訊，不應產生用藥內容" },
];
