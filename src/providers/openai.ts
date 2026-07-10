/**
 * OpenAI 供應商實作（Chat Completions API）。
 */
import type { ChatParams, TranslationProvider } from './base';

const API_URL = 'https://api.openai.com/v1/chat/completions';

/** Chat Completions 回應中我們會用到的欄位 */
interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export const openaiProvider: TranslationProvider = {
  id: 'openai',

  async chat({ apiKey, model, system, user }: ChatParams): Promise<string> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      // 不指定 max_tokens：部分新模型改用 max_completion_tokens，
      // 為避免相容性問題，交由 API 預設值處理
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    const data = (await response.json().catch(() => ({}))) as OpenAiResponse;

    if (!response.ok) {
      const message = data.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`OpenAI API 錯誤：${message}`);
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new Error('OpenAI 未回傳文字內容');
    }
    return text;
  },
};
