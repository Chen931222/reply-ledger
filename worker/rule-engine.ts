export type AnalysisMode = "retail" | "clinic";

export type AnalysisMessage = {
  speaker: string;
  text: string | null;
  timestamp?: number;
};

export type AnalysisKnowledgeRule = {
  title: string;
  body: string;
};

export type RuleAnalysis = {
  intent: string;
  urgency: "低" | "中" | "高";
  risk: string;
  confidence: number;
  observation: string;
  rationale: string;
  draft: string;
  evidence: string[];
};

const retailTerms = {
  dangerous: ["冒煙", "起火", "火花", "漏電", "觸電", "燒焦", "掉下", "掉落"],
  complaint: ["客訴", "投訴", "退款", "退貨", "很爛", "生氣", "不滿", "破損", "壞掉", "瑕疵"],
  afterSales: ["維修", "保固", "售後", "換貨", "更換", "不亮", "故障", "異音", "閃爍"],
  stock: ["庫存", "現貨", "缺貨", "到貨", "交期", "多久", "配送", "寄送", "運費"],
  install: ["安裝", "施工", "出線", "天花板", "固定", "含裝", "裝好", "師傅"],
  quote: ["價格", "價錢", "多少", "報價", "預算", "費用"],
  selection: ["推薦", "適合", "色溫", "尺寸", "大小", "亮度", "餐桌", "客廳", "房間", "型號", "吊燈"],
};

const clinicTerms = {
  emergency: ["呼吸困難", "喘不過氣", "意識不清", "昏倒", "抽搐", "大量出血", "大出血", "胸痛", "嘴唇發紫", "嚴重過敏", "喉嚨腫", "吞藥", "自殺", "不想活"],
  dosage: ["劑量", "幾cc", "幾 cc", "幾顆", "吃多少", "用多少", "體重", "兒童用藥", "小孩吃", "藥量"],
  symptoms: ["發燒", "咳嗽", "頭痛", "肚子痛", "腹痛", "嘔吐", "拉肚子", "過敏", "紅疹", "不舒服", "症狀"],
  diagnosis: ["是不是", "什麼病", "診斷", "嚴重嗎", "會不會", "正常嗎"],
  appointment: ["掛號", "預約", "看診", "門診", "營業時間", "幾點", "地址", "診所在哪"],
};

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function normalizeMessages(messages: AnalysisMessage[]) {
  return messages
    .filter((message) => typeof message.text === "string" && message.text.trim())
    .map((message) => ({ ...message, text: message.text!.trim() }));
}

function latestCustomerText(messages: AnalysisMessage[]) {
  const customerMessages = normalizeMessages(messages).filter((message) => message.speaker === "customer");
  return customerMessages.at(-1)?.text ?? normalizeMessages(messages).at(-1)?.text ?? "";
}

function pickEvidence(rules: AnalysisKnowledgeRule[], patterns: string[][], limit = 3) {
  const selected: string[] = [];
  for (const pattern of patterns) {
    const match = rules.find((rule) => pattern.some((term) => `${rule.title} ${rule.body}`.includes(term)));
    if (match && !selected.includes(match.title)) selected.push(match.title);
    if (selected.length >= limit) break;
  }
  return selected;
}

function findRule(rules: AnalysisKnowledgeRule[], evidenceTitle: string | undefined) {
  return evidenceTitle ? rules.find((rule) => rule.title === evidenceTitle) : undefined;
}

function analyzeRetail(messages: AnalysisMessage[], rules: AnalysisKnowledgeRule[]): RuleAnalysis {
  const latest = latestCustomerText(messages);
  const conversation = normalizeMessages(messages).map((message) => message.text).join("\n");
  const dangerous = includesAny(conversation, retailTerms.dangerous);
  const complaint = includesAny(conversation, retailTerms.complaint);
  const afterSales = includesAny(conversation, retailTerms.afterSales);
  const stock = includesAny(latest, retailTerms.stock);
  const install = includesAny(latest, retailTerms.install);
  const quote = includesAny(latest, retailTerms.quote);
  const selection = includesAny(latest, retailTerms.selection) || /L-\d+/i.test(latest);
  const model = latest.match(/L-\d+/i)?.[0]?.toUpperCase();

  let intent = "一般詢問／資訊不足";
  if (dangerous) intent = "電氣安全事件";
  else if (complaint) intent = "客訴與退換貨";
  else if (afterSales) intent = "售後維修";
  else if (stock) intent = "庫存、交期或配送";
  else if (install && quote) intent = "商品與安裝報價";
  else if (install) intent = "安裝條件確認";
  else if (quote) intent = "商品報價";
  else if (selection) intent = "燈具選購";

  const evidencePatterns: string[][] = [];
  if (model) evidencePatterns.push([model]);
  if (install || dangerous) evidencePatterns.push(["安裝報價規則", "現場確認", "出線位置"]);
  if (selection) evidencePatterns.push(["選型手冊", "餐桌", "色溫"]);
  const evidence = pickEvidence(rules, evidencePatterns);
  const productRule = findRule(rules, evidence.find((title) => model && title.includes(model)));
  const price = productRule?.body.match(/NT\$[\d,]+/)?.[0];

  let urgency: RuleAnalysis["urgency"] = "低";
  if (dangerous) urgency = "高";
  else if (complaint || afterSales || install) urgency = "中";

  let risk = "資訊不足，需先釐清需求";
  if (dangerous) risk = "可能涉及用電或掉落安全";
  else if (install && quote) risk = "安裝條件與費用尚未確認";
  else if (stock) risk = "庫存與交期尚未確認";
  else if (complaint || afterSales) risk = "產品狀況與訂單資料尚未確認";
  else if (quote && !price) risk = "價格沒有可引用的帳簿根據";
  else if (quote) risk = "需區分燈具售價與安裝費";
  else if (selection) risk = "空間尺寸與安裝條件不足";

  let draft = "您好，已收到您的訊息。為了避免提供錯誤資訊，請問您想詢問燈具選購、報價、安裝、庫存，還是售後服務呢？";
  if (dangerous) {
    draft = "您好，安全優先。請先停止使用該燈具；若能安全操作，請關閉相關電源，並避免自行拆修。請提供異常狀況與現場照片，我們會立即轉交真人確認。";
  } else if (complaint || afterSales) {
    draft = "您好，抱歉造成困擾。我們先替您確認售後處理方式，請提供訂單資訊、產品型號，以及故障或破損照片；收到後會交由真人客服確認保固、維修或退換貨流程。";
  } else if (stock) {
    draft = "您好，庫存與交期需要依型號、數量及配送地區即時確認。請提供完整型號、需要數量與配送縣市，我們確認後再回覆，不先猜測現貨或到貨日期。";
  } else if (install && quote) {
    const productSentence = model && price ? `依目前價目表，${model} 燈具售價為 ${price}。` : model ? `已記下您詢問的 ${model}。` : "已收到您的燈具與安裝報價需求。";
    draft = `${productSentence} 安裝費仍需依出線位置、天花板材質與固定方式確認；方便提供現場照片與天花板高度嗎？確認後再提供完整價格。`;
  } else if (install) {
    draft = "您好，安裝方式需要先確認出線位置、天花板材質、固定方式與高度。方便提供現場照片及預計安裝的燈具型號嗎？確認前我們不會先承諾安裝方式或總價。";
  } else if (quote) {
    draft = model && price
      ? `您好，依目前價目表，${model} 燈具售價為 ${price}；安裝費另需依現場條件確認。請問您也需要安裝服務嗎？`
      : "您好，為了提供正確價格，請告訴我們完整燈具型號與需要數量；若包含安裝，也請一併提供現場照片，我們確認後再回覆。";
  } else if (selection) {
    draft = "您好，可以協助選燈。請提供空間用途、主要尺寸、天花板高度，以及希望的亮度或色溫；若方便附上現場照片，我們會依條件提出較可靠的建議。";
  }

  const signalCount = [dangerous, complaint, afterSales, stock, install, quote, selection].filter(Boolean).length;
  const confidence = dangerous ? 96 : signalCount >= 2 ? 88 : signalCount === 1 ? 76 : 42;
  const observation = latest
    ? `最新訊息命中「${intent}」規則；系統只採用可辨識的字詞與知識帳簿內容。`
    : "目前沒有可供判讀的文字訊息。";
  const rationale = evidence.length > 0
    ? `命中 ${evidence.length} 份知識規則；${risk}，因此草稿保留限制並要求補充資料。`
    : `沒有足夠的知識規則可直接支持完整答案；${risk}，因此草稿只做需求釐清。`;

  return { intent, urgency, risk, confidence, observation, rationale, draft, evidence };
}

function analyzeClinic(messages: AnalysisMessage[], rules: AnalysisKnowledgeRule[]): RuleAnalysis {
  const latest = latestCustomerText(messages);
  const conversation = normalizeMessages(messages).map((message) => message.text).join("\n");
  const emergency = includesAny(conversation, clinicTerms.emergency);
  const dosage = includesAny(latest, clinicTerms.dosage);
  const symptoms = includesAny(latest, clinicTerms.symptoms);
  const diagnosis = includesAny(latest, clinicTerms.diagnosis);
  const appointment = includesAny(latest, clinicTerms.appointment);

  let intent = "一般詢問／資訊不足";
  if (emergency) intent = "緊急症狀轉介";
  else if (dosage) intent = "用藥與劑量詢問";
  else if (symptoms || diagnosis) intent = "症狀與診斷詢問";
  else if (appointment) intent = "掛號與門診資訊";

  const evidencePatterns: string[][] = [];
  if (emergency) evidencePatterns.push(["緊急徵象", "立即轉介"]);
  if (dosage) evidencePatterns.push(["用藥安全", "不推算劑量"]);
  if (symptoms || diagnosis) evidencePatterns.push(["症狀觀察", "不代替診斷"]);
  const evidence = pickEvidence(rules, evidencePatterns);

  const urgency: RuleAnalysis["urgency"] = emergency ? "高" : dosage || symptoms || diagnosis ? "中" : "低";
  let risk = "資訊不足，需由真人確認需求";
  if (emergency) risk = "可能出現需緊急處理的徵象";
  else if (dosage) risk = "不可依片段資訊推算用藥劑量";
  else if (symptoms || diagnosis) risk = "不可在線上訊息中下診斷或保證無礙";
  else if (appointment) risk = "門診時間與名額需即時確認";

  let draft = "您好，已收到您的訊息。請問您想詢問掛號、門診資訊、症狀回報，還是用藥問題？涉及醫療判斷的內容會轉交合格人員確認。";
  if (emergency) {
    draft = "您好，您描述的情況可能需要立即由醫療人員評估。若目前有呼吸困難、意識改變、大量出血或症狀快速惡化，請立即撥打 119 或前往急診，不要等待線上回覆；我們也會將訊息轉交真人處理。";
  } else if (dosage) {
    draft = "您好，用藥劑量不能只依這段訊息推算。請先不要自行增減藥量，並聯絡開立處方的醫師、診所或藥師；確認時請準備藥名、處方內容、年齡、體重與過敏史。";
  } else if (symptoms || diagnosis) {
    draft = "您好，已收到您的症狀描述，但僅憑訊息無法安全判斷診斷或嚴重程度。請補充症狀開始時間、變化、體溫及其他不適，我們會轉交醫療人員確認；若症狀快速惡化，請直接就醫。";
  } else if (appointment) {
    draft = "您好，掛號名額與門診時間需要即時確認。請提供希望的日期、時段與科別，我們會由真人協助確認，不先承諾尚未查核的名額。";
  }

  const signalCount = [emergency, dosage, symptoms, diagnosis, appointment].filter(Boolean).length;
  const confidence = emergency ? 97 : signalCount >= 2 ? 88 : signalCount === 1 ? 78 : 40;
  const observation = latest
    ? `最新訊息命中「${intent}」規則；規則引擎不進行診斷或劑量計算。`
    : "目前沒有可供判讀的文字訊息。";
  const rationale = evidence.length > 0
    ? `命中 ${evidence.length} 份安全規則；${risk}，因此草稿採取轉介或補充資訊的保守處理。`
    : `沒有足夠的知識規則可直接回答；${risk}，因此保留給真人確認。`;

  return { intent, urgency, risk, confidence, observation, rationale, draft, evidence };
}

export function analyzeWithRules(mode: AnalysisMode, messages: AnalysisMessage[], rules: AnalysisKnowledgeRule[]) {
  return mode === "clinic" ? analyzeClinic(messages, rules) : analyzeRetail(messages, rules);
}
