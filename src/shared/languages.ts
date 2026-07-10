/**
 * 目標語言清單。
 * - code:  存在設定裡的識別碼
 * - label: UI 顯示名稱
 * - promptName: 送進 prompt 給模型看的語言名稱（用英文描述最穩定）
 */
export interface LanguageOption {
  code: string;
  label: string;
  promptName: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'zh-TW', label: '繁體中文', promptName: 'Traditional Chinese (Taiwan)' },
  { code: 'zh-CN', label: '簡體中文', promptName: 'Simplified Chinese' },
  { code: 'en', label: 'English', promptName: 'English' },
  { code: 'ja', label: '日本語', promptName: 'Japanese' },
  { code: 'ko', label: '한국어', promptName: 'Korean' },
  { code: 'fr', label: 'Français', promptName: 'French' },
  { code: 'de', label: 'Deutsch', promptName: 'German' },
  { code: 'es', label: 'Español', promptName: 'Spanish' },
];

/** 依語言代碼取得送給模型的語言名稱；找不到時直接回傳代碼本身（仍可讓模型理解） */
export function promptNameOf(code: string): string {
  const found = LANGUAGES.find((lang) => lang.code === code);
  return found ? found.promptName : code;
}

/** 依語言代碼取得 UI 顯示名稱；找不到時回傳代碼本身（Claude 助手指示句等處使用） */
export function labelOf(code: string): string {
  const found = LANGUAGES.find((lang) => lang.code === code);
  return found ? found.label : code;
}
