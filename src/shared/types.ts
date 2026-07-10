/**
 * 全域共用的型別定義。
 * 這裡集中定義「設定資料結構」與「跨 context 訊息協定」，
 * 讓 background / content script / popup / options 之間的通訊有一致的型別保障。
 */

/** 支援的 AI 翻譯服務供應商 */
export type ProviderId = 'claude' | 'openai';

/** 單一供應商的連線設定（BYOK：使用者自帶 API key） */
export interface ProviderSettings {
  /** 使用者的 API key，僅存在 chrome.storage，不經任何第三方伺服器 */
  apiKey: string;
  /** 模型名稱採自由輸入，不寫死清單，避免模型迭代後失效 */
  model: string;
}

/** 譯文樣式預設集的識別碼 */
export type StylePresetId = 'none' | 'dashed' | 'marker' | 'quote';

/** 譯文外觀設定（網頁譯文與 YouTube 字幕共用） */
export interface StyleSettings {
  preset: StylePresetId;
  /** 文字顏色，空字串代表不覆寫（沿用原文顏色） */
  textColor: string;
  /** 背景顏色，空字串代表不覆寫 */
  backgroundColor: string;
  /** 字體大小百分比，100 = 與原文相同 */
  fontSizePercent: number;
  /** 字型名稱，空字串代表不覆寫 */
  fontFamily: string;
}

/** 使用者自訂的 AI 專家（system prompt 模板） */
export interface ExpertTemplate {
  id: string;
  name: string;
  /** 可使用 {{source_lang}}、{{target_lang}} 變數；{{text}} 由系統在單段翻譯時帶入 */
  systemPrompt: string;
  /** 內建模板不可刪除／修改 */
  builtin: boolean;
}

/** 外掛完整設定（存於 chrome.storage.sync，可跨裝置同步） */
export interface Settings {
  provider: ProviderId;
  claude: ProviderSettings;
  openai: ProviderSettings;
  /** 目標語言代碼，例如 'zh-TW'（實際送給模型的名稱見 shared/languages.ts） */
  targetLang: string;
  /** 目前選用的 AI 專家 id（內建或自訂） */
  expertId: string;
  style: StyleSettings;
  /** 同時進行的 API 請求數上限，防止費用暴衝 */
  concurrency: number;
  /** 單一頁面最多翻譯的字元數上限 */
  maxCharsPerPage: number;
  /** YouTube 字幕每批翻譯的句數 */
  youtubeBatchSize: number;
  /**
   * 右鍵選單 Claude 助手：帶入 claude.ai 的內容字元上限
   * （避免極端長頁面讓輸入框卡死；下限 500，見 shared/assistant-prompts.ts）
   */
  assistantMaxChars: number;
}

/* 跨 context 訊息協定定義於 shared/messages.ts，此處 re-export 維持既有 import 相容 */
export type {
  BackgroundRequest,
  ContentRequest,
  ClaudeInjectRequest,
  AssistantFillResponse,
  TranslateBatchResponse,
  SimpleResponse,
} from './messages';
