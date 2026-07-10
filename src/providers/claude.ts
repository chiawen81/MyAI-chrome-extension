/**
 * Anthropic Claude 供應商實作。
 * 直接呼叫 Messages API（https://docs.claude.com），不引入 SDK：
 * - 減少 service worker 的 bundle 體積
 * - 與 OpenAI 實作共用同一個極簡抽象（fetch + JSON）
 */
import type { ChatParams, TranslationProvider } from './base';

const API_URL = 'https://api.anthropic.com/v1/messages';

/** Messages API 回應中我們會用到的欄位 */
interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  error?: { message?: string };
}

export const claudeProvider: TranslationProvider = {
  id: 'claude',

  async chat({ apiKey, model, system, user, maxTokens = 8192 }: ChatParams): Promise<string> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // 允許從瀏覽器環境直接呼叫（BYOK 情境下 key 本來就在使用者手上）
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    const data = (await response.json().catch(() => ({}))) as ClaudeResponse;

    if (!response.ok) {
      const message = data.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Claude API 錯誤：${message}`);
    }

    // 模型可能因安全原因拒答；此時 content 沒有文字，回報明確錯誤而非空字串
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');

    if (!text) {
      throw new Error(`Claude 未回傳文字內容（stop_reason: ${data.stop_reason ?? '未知'}）`);
    }
    return text;
  },
};
