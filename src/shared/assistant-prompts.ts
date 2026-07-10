/**
 * 右鍵選單 Claude 助手：帶入文字模板與純函式工具。
 *
 * 「帶入文字」是使用者在 claude.ai 對話中看得到的指示句＋內容，
 * 以正體中文撰寫，透過 renderTemplate() 代入變數。
 * 本檔只放純函式與常數（可單元測試），不碰 chrome API 與 DOM。
 */
import { renderTemplate } from './experts';

/** 右鍵選單動作的識別碼 */
export type AssistantAction =
  | 'summarize-page'
  | 'summarize-selection'
  | 'ask-selection'
  | 'translate-selection'
  | 'translate-summarize';

/** 使用者自訂模板的儲存格式：只存有覆寫的動作（chrome.storage.sync 的 assistantPrompts key） */
export type AssistantPromptOverrides = Partial<Record<AssistantAction, string>>;

export const ASSISTANT_ACTIONS: AssistantAction[] = [
  'summarize-page',
  'summarize-selection',
  'ask-selection',
  'translate-selection',
  'translate-summarize',
];

/** 各動作的 UI 顯示名稱（右鍵選單標題與 options 分頁共用） */
export const ASSISTANT_ACTION_LABELS: Record<AssistantAction, string> = {
  'summarize-page': '請 Claude 摘要此頁',
  'summarize-selection': '請 Claude 摘要選取文字',
  'ask-selection': '將選取文字帶入 Claude',
  'translate-selection': '請 Claude 翻譯',
  'translate-summarize': '請 Claude 翻譯＋摘要',
};

/**
 * 預設模板。可用變數（白名單）：
 * {{content}}（必填）、{{page_url}}、{{page_title}}、{{target_lang_label}}。
 * 動作 3、4 的目標語言固定正體中文（需求明定）；動作 1 跟隨設定的目標語言。
 */
export const DEFAULT_ASSISTANT_PROMPTS: Record<AssistantAction, string> = {
  'summarize-page':
    '請以{{target_lang_label}}摘要以下網頁內容（一段總覽＋條列重點）。內容為程式自動擷取，可能夾雜選單、推薦連結、圖片說明等非本文文字，請自行判斷忽略。\n標題：{{page_title}}\n來源：{{page_url}}\n\n{{content}}',
  'summarize-selection':
    '請以{{target_lang_label}}摘要以下我從網頁選取的內容（一段總覽＋條列重點）。\n來源：{{page_url}}\n\n{{content}}',
  'ask-selection':
    '以下是我從網頁選取的內容（來源：{{page_url}}），請搭配我接著輸入的問題閱讀：\n\n{{content}}\n\n我的問題：',
  'translate-selection': '請將以下內容翻譯成正體中文（台灣用語），只輸出譯文：\n\n{{content}}',
  'translate-summarize':
    '請將以下內容翻譯成正體中文（台灣用語），譯文之後再以正體中文條列重點摘要，兩部分以標題分隔：\n\n{{content}}',
};

/**
 * 各動作是否自動送出（不開放使用者調整，行為歸屬動作本身而非模板）：
 * 動作 2 只填不送——使用者在引文後接著輸入自己的問題，一次送出。
 */
export const ASSISTANT_AUTO_SUBMIT: Record<AssistantAction, boolean> = {
  'summarize-page': true,
  'summarize-selection': true,
  'ask-selection': false,
  'translate-selection': true,
  'translate-summarize': true,
};

/** 單一自訂模板的長度上限（保護 sync 配額） */
export const MAX_TEMPLATE_CHARS = 500;
/** assistantMaxChars 設定的下限 */
export const MIN_ASSISTANT_MAX_CHARS = 500;
/** ?q= 備援路徑的保守長度上限（Task 0 定案；DOM 注入路徑不受此限） */
export const FALLBACK_QUERY_MAX_CHARS = 2000;
/** 內容被截斷時附加在文末的註記 */
export const TRUNCATION_NOTICE = '……（內容過長，已截斷）';

/**
 * 判斷文字是否「大致是中文」：非空白字元中漢字占比 ≥ 50%。
 * 動作 3、4（翻譯類）點擊後以此判斷是否需要 confirm 確認。
 */
export function isMostlyChinese(text: string): boolean {
  let total = 0;
  let han = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    total++;
    if (/\p{Script=Han}/u.test(ch)) han++;
  }
  if (total === 0) return false;
  return han / total >= 0.5;
}

/** 超長內容截斷：保留開頭、文末加註記；未超過上限時原樣回傳 */
export function truncateForHandoff(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + TRUNCATION_NOTICE;
}

/** 帶入文字的變數集合（key 對應模板中的 {{變數}} 名稱） */
export interface HandoffVars {
  content: string;
  page_url: string;
  page_title: string;
  target_lang_label: string;
}

/**
 * 組出最終帶入 claude.ai 的文字：先對 content 做截斷（避免極端長頁面
 * 讓輸入框卡死），再代入模板。截斷只作用於 content——若截整段渲染結果，
 * 「我的問題：」等模板尾巴會被切掉。
 */
export function buildHandoffText(template: string, vars: HandoffVars, maxChars: number): string {
  const limit = Math.max(maxChars, MIN_ASSISTANT_MAX_CHARS);
  return renderTemplate(template, {
    ...vars,
    content: truncateForHandoff(vars.content, limit),
  });
}

/** 備援路徑：DOM 注入失敗時改以 ?q= 預填（另套保守長度上限再截一次） */
export function buildFallbackUrl(text: string): string {
  const truncated = truncateForHandoff(text, FALLBACK_QUERY_MAX_CHARS);
  return `https://claude.ai/new?q=${encodeURIComponent(truncated)}`;
}

/**
 * 驗證使用者自訂模板；回傳錯誤訊息，合法時回傳 null。
 * 規則：必含 {{content}}（否則帶過去的是沒有內容的指示句）、長度 ≤ 500 字元。
 */
export function validateAssistantTemplate(template: string): string | null {
  if (!template.includes('{{content}}')) {
    return '模板必須包含 {{content}} 變數（實際帶入的內容本體），否則送出的只有指示句。';
  }
  if (template.length > MAX_TEMPLATE_CHARS) {
    return `模板長度上限 ${MAX_TEMPLATE_CHARS} 字元（目前 ${template.length} 字元）。`;
  }
  return null;
}
