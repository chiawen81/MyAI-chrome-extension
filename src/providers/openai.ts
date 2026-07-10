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

/**
 * reasoning 模型預設會在輸出前先做大量推理，翻譯任務用不到、只會拖慢回應，
 * 因此明確要求最低推理量。
 * - gpt-5 系列支援 'minimal'（gpt-5-chat 例外：非 reasoning 模型，不接受此參數）
 * - o1 / o3 / o4 系列最低只到 'low'
 * - 其他模型不帶此參數，維持原請求（避免舊模型拒收未知參數）
 */
function reasoningEffortFor(model: string): string | undefined {
  if (/^gpt-5(?!-chat)/.test(model)) return 'minimal';
  if (/^o\d/.test(model)) return 'low';
  return undefined;
}

export const openaiProvider: TranslationProvider = {
  id: 'openai',

  async chat({ apiKey, model, system, user }: ChatParams): Promise<string> {
    const reasoningEffort = reasoningEffortFor(model);
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
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
