/**
 * AI 翻譯供應商的抽象層。
 *
 * 每個供應商只需實作一個 chat() 方法（送出 system + user prompt、回傳純文字），
 * 批次翻譯的 prompt 組裝與結果解析則統一放在這裡，與供應商無關。
 * 未來要支援新的供應商，只要新增一個實作 TranslationProvider 的檔案即可。
 */
import type { ProviderId } from '../shared/types';

/** 一次對話請求的參數 */
export interface ChatParams {
  apiKey: string;
  model: string;
  /** system prompt（由 AI 專家模板渲染而來） */
  system: string;
  /** user prompt（要翻譯的內容與格式指示） */
  user: string;
  /** 回應 token 上限；未指定時由各供應商採用合理預設 */
  maxTokens?: number;
}

/** 翻譯供應商需實作的介面 */
export interface TranslationProvider {
  id: ProviderId;
  /** 送出一次請求並回傳模型輸出的純文字；失敗時 throw 帶有可讀訊息的 Error */
  chat(params: ChatParams): Promise<string>;
}

/**
 * 組出「批次翻譯」的 user prompt。
 * 多個段落以 JSON 陣列傳遞，並要求模型回傳等長的 JSON 陣列，
 * 以便逐一對齊回原文段落。
 *
 * @param items          要翻譯的原文段落
 * @param targetLangName 目標語言名稱（給模型看的，如 "Traditional Chinese (Taiwan)"）
 * @param context        前文（僅供理解語境，不需翻譯）— YouTube 字幕跨批連貫性用
 */
export function buildBatchUserPrompt(
  items: string[],
  targetLangName: string,
  context?: string[],
): string {
  const lines: string[] = [
    `Translate each string in the JSON array below into ${targetLangName}.`,
    '',
    'Rules:',
    `- Return ONLY a valid JSON array of strings with exactly ${items.length} element(s), in the same order as the input.`,
    '- Each output element is the translation of the input element at the same index.',
    '- Never merge, split, add, or omit items.',
    '- Do not wrap the output in code fences and do not add any explanation.',
  ];

  if (context && context.length > 0) {
    lines.push(
      '',
      'Preceding context (for understanding only — do NOT translate or include it in the output):',
      ...context.map((line) => `> ${line}`),
    );
  }

  lines.push('', 'Input:', JSON.stringify(items));
  return lines.join('\n');
}

/**
 * 解析批次翻譯的模型輸出。
 * 模型偶爾會加上 code fence 或前後說明文字，因此先擷取最外層的 [...] 再解析。
 *
 * @returns 與預期長度一致的字串陣列；解析失敗或長度不符時回傳 null，
 *          由呼叫端啟動「逐段重試」的 fallback。
 */
export function parseBatchResult(raw: string, expectedLength: number): string[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== expectedLength) return null;
    return parsed.map((item) => String(item));
  } catch {
    return null;
  }
}

/** 組出「單段翻譯」的 user prompt（批次對齊失敗時的逐段 fallback 用） */
export function buildSingleUserPrompt(text: string, targetLangName: string): string {
  return [
    `Translate the following text into ${targetLangName}.`,
    'Output only the translation, with no explanation and no quotes.',
    '',
    text,
  ].join('\n');
}
