/**
 * 設定的讀寫工具。
 * - 設定本體存 chrome.storage.sync（跨裝置同步）
 * - 自訂 AI 專家存另一個 key，避免單一項目超過 sync 的 8KB 上限
 */
import {
  ASSISTANT_ACTIONS,
  DEFAULT_ASSISTANT_PROMPTS,
  type AssistantAction,
  type AssistantPromptOverrides,
} from './assistant-prompts';
import type { ExpertTemplate, Settings } from './types';

const SETTINGS_KEY = 'settings';
const CUSTOM_EXPERTS_KEY = 'customExperts';
// Claude 助手模板獨立存一個 key（沿用 customExperts 避開單項 8KB 上限的先例）
const ASSISTANT_PROMPTS_KEY = 'assistantPrompts';

/** 預設設定：安裝後尚未設定任何東西時的初始值 */
export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude',
  claude: { apiKey: '', model: 'claude-opus-4-8' },
  openai: { apiKey: '', model: 'gpt-4o-mini' },
  targetLang: 'zh-TW',
  expertId: 'general',
  style: {
    preset: 'dashed',
    textColor: '',
    backgroundColor: '',
    fontSizePercent: 100,
    fontFamily: '',
  },
  concurrency: 3,
  maxCharsPerPage: 10000,
  youtubeBatchSize: 40,
  assistantMaxChars: 50000,
};

/**
 * 讀取設定，並與預設值合併。
 * 合併的目的：未來新增設定欄位時，舊用戶已儲存的資料不會缺欄位。
 */
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const saved = (stored[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    claude: { ...DEFAULT_SETTINGS.claude, ...saved.claude },
    openai: { ...DEFAULT_SETTINGS.openai, ...saved.openai },
    style: { ...DEFAULT_SETTINGS.style, ...saved.style },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

/** 讀取使用者自訂的 AI 專家清單 */
export async function loadCustomExperts(): Promise<ExpertTemplate[]> {
  const stored = await chrome.storage.sync.get(CUSTOM_EXPERTS_KEY);
  return (stored[CUSTOM_EXPERTS_KEY] ?? []) as ExpertTemplate[];
}

export async function saveCustomExperts(experts: ExpertTemplate[]): Promise<void> {
  await chrome.storage.sync.set({ [CUSTOM_EXPERTS_KEY]: experts });
}

/**
 * 讀取 Claude 助手的帶入文字模板（與預設模板合併後的完整四筆）。
 * 空字串／純空白／缺項一律退回預設，呼叫端不需再判斷。
 */
export async function loadAssistantPrompts(): Promise<Record<AssistantAction, string>> {
  const stored = await chrome.storage.sync.get(ASSISTANT_PROMPTS_KEY);
  const saved = (stored[ASSISTANT_PROMPTS_KEY] ?? {}) as AssistantPromptOverrides;
  const merged: Record<AssistantAction, string> = { ...DEFAULT_ASSISTANT_PROMPTS };
  for (const action of ASSISTANT_ACTIONS) {
    const value = saved[action];
    if (typeof value === 'string' && value.trim() !== '') merged[action] = value;
  }
  return merged;
}

/** 儲存 Claude 助手模板的覆寫（只存與預設不同的動作；驗證由呼叫端做，見 validateAssistantTemplate） */
export async function saveAssistantPrompts(overrides: AssistantPromptOverrides): Promise<void> {
  await chrome.storage.sync.set({ [ASSISTANT_PROMPTS_KEY]: overrides });
}

/**
 * 監聽設定變更（任何 context 都可用）。
 * 用途：例如樣式改變時，content script 立即更新譯文外觀，不需重新翻譯。
 */
export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[SETTINGS_KEY]) {
      // 重新走一次 loadSettings 以套用預設值合併邏輯
      void loadSettings().then(callback);
    }
  });
}
