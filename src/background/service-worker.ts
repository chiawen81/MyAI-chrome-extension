/**
 * Background Service Worker（MV3）
 *
 * 職責：
 * 1. 代理所有 AI API 請求（content script 受頁面 CSP/CORS 限制，統一由這裡發出）
 * 2. 翻譯快取：hash(原文+供應商+模型+專家+目標語言) → 譯文
 * 3. 並發控制：限制同時進行的 API 請求數，防止費用暴衝
 * 4. 快捷鍵（Alt+T）與 popup 的「翻譯／還原」：動態注入 content script 後轉發指令
 */
import webTranslateScript from '../content/web-translate/index?script';
import { getProvider } from '../providers';
import { buildBatchUserPrompt, buildSingleUserPrompt, parseBatchResult } from '../providers/base';
import { cacheClear, cacheCount, cacheGetMany, cacheSetMany, makeCacheKey } from '../shared/cache';
import { BUILTIN_EXPERTS, findExpert, renderTemplate } from '../shared/experts';
import { promptNameOf } from '../shared/languages';
import { loadCustomExperts, loadSettings } from '../shared/settings';
import type {
  BackgroundRequest,
  ContentRequest,
  SimpleResponse,
  TranslateBatchResponse,
} from '../shared/types';

/* ------------------------------------------------------------------ */
/* 並發控制：簡單的信號量（semaphore）                                   */
/* ------------------------------------------------------------------ */

/** 目前執行中的 API 請求數 */
let runningRequests = 0;
/** 等待執行的工作佇列 */
const waitQueue: Array<() => void> = [];

/** 取得一個執行名額；超過上限時排隊等待 */
async function acquireSlot(limit: number): Promise<void> {
  if (runningRequests < limit) {
    runningRequests++;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  runningRequests++;
}

/** 釋放名額，並喚醒佇列中的下一個工作 */
function releaseSlot(): void {
  runningRequests--;
  const next = waitQueue.shift();
  if (next) next();
}

/** 在信號量保護下執行工作 */
async function withSlot<T>(limit: number, task: () => Promise<T>): Promise<T> {
  await acquireSlot(limit);
  try {
    return await task();
  } finally {
    releaseSlot();
  }
}

/* ------------------------------------------------------------------ */
/* 批次翻譯                                                             */
/* ------------------------------------------------------------------ */

/** 單一 API 請求最多裝入的原文字元數（過長會拖慢回應、也容易對齊失敗） */
const MAX_BATCH_CHARS = 3000;
/** 單一 API 請求最多裝入的段落數 */
const MAX_BATCH_ITEMS = 30;

/**
 * 把「未命中快取」的段落切成多個子批次。
 * 依字元數與段落數雙重上限切割，回傳的每個子批次記錄原始索引以便寫回。
 */
function splitIntoBatches(items: Array<{ index: number; text: string }>) {
  const batches: Array<Array<{ index: number; text: string }>> = [];
  let current: Array<{ index: number; text: string }> = [];
  let currentChars = 0;

  for (const item of items) {
    const overCharLimit = currentChars + item.text.length > MAX_BATCH_CHARS;
    const overItemLimit = current.length >= MAX_BATCH_ITEMS;
    if (current.length > 0 && (overCharLimit || overItemLimit)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += item.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * 處理一次批次翻譯請求（含快取與逐段 fallback）。
 *
 * 流程：
 * 1. 為每段原文算快取 key，先撈快取
 * 2. 未命中的段落切成子批次，各自送 API（受並發限制）
 * 3. 若模型回傳的陣列無法對齊（長度不符 / 非 JSON）→ 對該子批次逐段重試
 * 4. 新譯文寫入快取，最後依原始順序回傳
 */
async function handleTranslateBatch(
  items: string[],
  context?: string[],
): Promise<TranslateBatchResponse> {
  const settings = await loadSettings();
  const providerSettings = settings[settings.provider];

  if (!providerSettings.apiKey) {
    return { ok: false, error: '尚未設定 API key，請先到設定頁完成「翻譯服務」設定。' };
  }

  const provider = getProvider(settings.provider);
  const customExperts = await loadCustomExperts();
  const expert = findExpert(settings.expertId, customExperts);
  const targetLangName = promptNameOf(settings.targetLang);

  // 專家模板 → system prompt（來源語言採自動偵測）
  const systemPrompt = renderTemplate(expert.systemPrompt, {
    source_lang: 'the source language (auto-detect)',
    target_lang: targetLangName,
    text: '', // 批次模式下原文放在 user prompt 的 JSON 陣列中
  });

  // 1. 查快取
  const cacheKeys = await Promise.all(
    items.map((text) =>
      makeCacheKey([text, settings.provider, providerSettings.model, expert.id, settings.targetLang]),
    ),
  );
  const cached = await cacheGetMany(cacheKeys);

  const translations: string[] = new Array(items.length).fill('');
  const misses: Array<{ index: number; text: string }> = [];
  items.forEach((text, index) => {
    const hit = cached[cacheKeys[index]];
    if (hit !== undefined) {
      translations[index] = hit;
    } else {
      misses.push({ index, text });
    }
  });

  // 2. 未命中的段落分批送 API
  if (misses.length > 0) {
    const batches = splitIntoBatches(misses);
    const newEntries: Record<string, string> = {};

    const chatOnce = (user: string) =>
      provider.chat({
        apiKey: providerSettings.apiKey,
        model: providerSettings.model,
        system: systemPrompt,
        user,
      });

    try {
      await Promise.all(
        batches.map((batch) =>
          withSlot(settings.concurrency, async () => {
            const texts = batch.map((item) => item.text);
            const raw = await chatOnce(buildBatchUserPrompt(texts, targetLangName, context));
            let results = parseBatchResult(raw, texts.length);

            // 3. 對齊失敗 → 逐段重試（AI 最容易出錯的環節，必須有 fallback）
            if (results === null) {
              console.warn('[雙語翻譯] 批次結果無法對齊，改為逐段翻譯', { size: texts.length });
              results = [];
              for (const text of texts) {
                const single = await chatOnce(buildSingleUserPrompt(text, targetLangName));
                results.push(single.trim());
              }
            }

            batch.forEach((item, i) => {
              const translated = results[i];
              translations[item.index] = translated;
              newEntries[cacheKeys[item.index]] = translated;
            });
          }),
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }

    // 4. 寫入快取
    await cacheSetMany(newEntries);
  }

  return { ok: true, translations };
}

/* ------------------------------------------------------------------ */
/* 網頁翻譯 content script 的注入與切換                                  */
/* ------------------------------------------------------------------ */

/** 對 content script 送訊息；對方不存在時會 throw */
function sendToTab<T>(tabId: number, message: ContentRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * 確保網頁翻譯 content script 已存在於分頁中。
 * 先 PING 試探；沒有回應才注入（避免重複注入）。
 */
async function ensureWebTranslateScript(tabId: number): Promise<void> {
  try {
    await sendToTab(tabId, { type: 'PING' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [webTranslateScript],
    });
  }
}

/** 切換指定分頁的翻譯狀態；回傳切換後是否為「翻譯中」 */
async function toggleTab(tabId: number): Promise<SimpleResponse> {
  try {
    await ensureWebTranslateScript(tabId);
    const state = await sendToTab<{ active: boolean }>(tabId, { type: 'TOGGLE_TRANSLATE' });
    return { ok: true, active: state.active };
  } catch (err) {
    // 常見情境：chrome:// 或 Web Store 等不允許注入的頁面
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `無法在此頁面啟用翻譯（${message}）` };
  }
}

/** 查詢指定分頁的翻譯狀態；content script 不存在視為未翻譯 */
async function getTabState(tabId: number): Promise<SimpleResponse> {
  try {
    const state = await sendToTab<{ active: boolean }>(tabId, { type: 'GET_STATE' });
    return { ok: true, active: state.active };
  } catch {
    return { ok: true, active: false };
  }
}

/* ------------------------------------------------------------------ */
/* 測試連線                                                             */
/* ------------------------------------------------------------------ */

async function handleTestConnection(
  providerId: 'claude' | 'openai',
  apiKey: string,
  model: string,
): Promise<SimpleResponse> {
  try {
    const provider = getProvider(providerId);
    await provider.chat({
      apiKey,
      model,
      system: BUILTIN_EXPERTS[0].systemPrompt, // 用通用模板當 system，貼近實際使用情境
      user: 'Reply with the single word: OK',
      maxTokens: 32,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/* ------------------------------------------------------------------ */
/* 事件註冊                                                             */
/* ------------------------------------------------------------------ */

// 快捷鍵：Alt+T 翻譯／還原目前分頁
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-translate') return;
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id !== undefined) void toggleTab(tab.id);
  });
});

// 統一的訊息入口：依 type 分派給對應的處理函式
chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: unknown) => void) => {
    const respond = (promise: Promise<unknown>) => {
      promise
        .then(sendResponse)
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error: errorMessage });
        });
      return true; // 告知 Chrome 我們會以非同步方式回應
    };

    switch (message.type) {
      case 'TRANSLATE_BATCH':
        return respond(handleTranslateBatch(message.items, message.context));
      case 'TEST_CONNECTION':
        return respond(handleTestConnection(message.provider, message.apiKey, message.model));
      case 'CLEAR_CACHE':
        return respond(cacheClear().then(() => ({ ok: true })));
      case 'GET_CACHE_STATS':
        return respond(cacheCount().then((count) => ({ ok: true, count })));
      case 'POPUP_TOGGLE':
        return respond(toggleTab(message.tabId));
      case 'POPUP_GET_STATE':
        return respond(getTabState(message.tabId));
      default:
        return false; // 不認得的訊息（可能是給 content script 的），不處理
    }
  },
);
