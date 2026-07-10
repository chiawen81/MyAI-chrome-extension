/**
 * Background Service Worker（MV3）
 *
 * 職責：
 * 1. 代理所有 AI API 請求（content script 受頁面 CSP/CORS 限制，統一由這裡發出）
 * 2. 翻譯快取：hash(原文+供應商+模型+專家+目標語言) → 譯文
 * 3. 並發控制：限制同時進行的 API 請求數，防止費用暴衝
 * 4. 快捷鍵（Alt+T）與 popup 的「翻譯／還原」：動態注入 content script 後轉發指令
 * 5. 右鍵選單 Claude 助手：把內容交棒到使用者自己的 claude.ai 對話
 *    （開新分頁 → 注入 claude-inject script → 填入／送出；不呼叫 API、不扣費）
 */
import claudeInjectScript from '../content/claude-inject/index?script';
import { extractPageContent, type PageExtractResult } from '../content/page-extract';
import webTranslateScript from '../content/web-translate/index?script';
import { getProvider } from '../providers';
import { buildBatchUserPrompt, buildSingleUserPrompt, parseBatchResult } from '../providers/base';
import {
  ASSISTANT_ACTIONS,
  ASSISTANT_ACTION_LABELS,
  ASSISTANT_AUTO_SUBMIT,
  buildFallbackUrl,
  buildHandoffText,
  isMostlyChinese,
  type AssistantAction,
} from '../shared/assistant-prompts';
import { cacheClear, cacheCount, cacheGetMany, cacheSetMany, makeCacheKey } from '../shared/cache';
import { BUILTIN_EXPERTS, findExpert, renderTemplate } from '../shared/experts';
import { labelOf, promptNameOf } from '../shared/languages';
import { loadAssistantPrompts, loadCustomExperts, loadSettings } from '../shared/settings';
import type {
  AssistantFillResponse,
  BackgroundRequest,
  ClaudeInjectRequest,
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
function sendToTab<T>(tabId: number, message: ContentRequest | ClaudeInjectRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * 確保指定的 content script 已存在於分頁中。
 * 先 PING 試探；沒有回應才注入（避免重複注入）。
 *
 * 注入後必須輪詢 PING 等待就緒：CRXJS 的 ?script 產物是一個載入器，
 * 會再以動態 import 非同步載入真正的模組，executeScript resolve 時
 * onMessage listener 可能尚未註冊，立刻送訊息會撞上
 * "Receiving end does not exist"。
 */
async function ensureScriptInTab(tabId: number, scriptFile: string): Promise<void> {
  try {
    await sendToTab(tabId, { type: 'PING' });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptFile],
    });
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await sendToTab(tabId, { type: 'PING' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('content script 注入後未回應');
}

/** 確保網頁翻譯 content script 已存在於分頁中 */
function ensureWebTranslateScript(tabId: number): Promise<void> {
  return ensureScriptInTab(tabId, webTranslateScript);
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
/* 右鍵選單 Claude 助手（功能三）                                         */
/* ------------------------------------------------------------------ */

/** 右鍵選單項目 id 前綴：`bt-assistant-<AssistantAction>` */
const ASSISTANT_MENU_PREFIX = 'bt-assistant-';

/**
 * 註冊右鍵選單項目（多個項目 Chrome 會自動收合於外掛名稱子選單）。
 * documentUrlPatterns 限定 http/https，chrome:// 等受限頁不顯示。
 * 「摘要此頁」加上 selection context，讓有選取文字時四項仍齊全。
 */
function registerAssistantMenus(): void {
  chrome.contextMenus.removeAll(() => {
    const documentUrlPatterns = ['http://*/*', 'https://*/*'];
    const contextsOf: Record<AssistantAction, chrome.contextMenus.ContextType[]> = {
      'summarize-page': ['page', 'selection'],
      'summarize-selection': ['selection'],
      'ask-selection': ['selection'],
      'translate-selection': ['selection'],
      'translate-summarize': ['selection'],
    };
    for (const action of ASSISTANT_ACTIONS) {
      chrome.contextMenus.create({
        id: `${ASSISTANT_MENU_PREFIX}${action}`,
        title: ASSISTANT_ACTION_LABELS[action],
        contexts: contextsOf[action],
        documentUrlPatterns,
      });
    }
  });
}

/**
 * 動作 3、4 選到中文內容時，在原分頁跳 confirm 確認。
 * confirm 注入失敗（罕見）視同確認，照常執行（fail-open，無費用損失）。
 */
async function confirmTranslateChinese(tabId: number): Promise<boolean> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.confirm('選取內容看起來已是中文，仍要請 Claude 翻譯嗎？'),
    });
    return result?.result !== false;
  } catch {
    return true;
  }
}

/** 等待分頁載入完成（逾時直接放行，後續由 PING 輪詢與 ?q= 備援兜底） */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
    // 掛上 listener 後補查一次目前狀態，避免恰好錯過 complete 事件
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish();
      })
      .catch(finish);
  });
}

/**
 * 把組好的文字交棒到 claude.ai：開新分頁 → 注入 claude-inject script →
 * ASSISTANT_FILL。注入失敗或找不到輸入框（claude.ai 可能已改版）時，
 * 同分頁改走 ?q= 備援（截斷至保守上限）。
 */
async function handoffToClaude(text: string, autoSubmit: boolean): Promise<void> {
  const created = await chrome.tabs.create({ url: 'https://claude.ai/new' });
  if (created.id === undefined) return;
  const tabId = created.id;

  try {
    await waitForTabComplete(tabId, 20000);
    await ensureScriptInTab(tabId, claudeInjectScript);
    const response = await sendToTab<AssistantFillResponse>(tabId, {
      type: 'ASSISTANT_FILL',
      text,
      autoSubmit,
    });
    if (!response.filled) throw new Error(response.error ?? '填入失敗');
  } catch (err) {
    console.warn('[雙語翻譯] claude.ai 填入失敗，改走 ?q= 備援（claude.ai 可能已改版）', err);
    try {
      await chrome.tabs.update(tabId, { url: buildFallbackUrl(text) });
    } catch {
      // 分頁可能已被使用者關閉，備援無處可去，靜默結束
    }
  }
}

/**
 * 動作 1：在原分頁執行頁面內容擷取（activeTab 已由右鍵點選單授予）。
 * 擷取失敗（極罕見，選單已限定 http/https）退回「標題＋網址」帶入，
 * 請 claude.ai 依網址自行讀取。
 */
async function extractPageForSummary(tab: chrome.tabs.Tab): Promise<PageExtractResult> {
  if (tab.id !== undefined) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContent,
      });
      const extracted = injection?.result;
      if (extracted && extracted.content) return extracted;
    } catch (err) {
      console.warn('[雙語翻譯] 頁面內容擷取失敗，改以標題＋網址帶入', err);
    }
  }
  return {
    title: tab.title ?? '',
    url: tab.url ?? '',
    content: '（無法擷取頁面內容，請依「來源」網址自行讀取後再摘要）',
  };
}

/** 右鍵選單點擊的主流程：取內容 → 中文確認 → 組帶入文字 → 交棒 claude.ai */
async function handleAssistantAction(
  action: AssistantAction,
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
): Promise<void> {
  let content: string;
  let pageUrl = info.pageUrl ?? tab.url ?? '';
  let pageTitle = tab.title ?? '';

  if (action === 'summarize-page') {
    const extracted = await extractPageForSummary(tab);
    content = extracted.content;
    pageUrl = extracted.url || pageUrl;
    pageTitle = extracted.title || pageTitle;
  } else {
    content = (info.selectionText ?? '').trim();
    if (!content) return;

    const needsChineseCheck = action === 'translate-selection' || action === 'translate-summarize';
    if (needsChineseCheck && isMostlyChinese(content) && tab.id !== undefined) {
      const confirmed = await confirmTranslateChinese(tab.id);
      if (!confirmed) return;
    }
  }

  const settings = await loadSettings();
  const prompts = await loadAssistantPrompts();
  const text = buildHandoffText(
    prompts[action],
    {
      content,
      page_url: pageUrl,
      page_title: pageTitle,
      target_lang_label: labelOf(settings.targetLang),
    },
    settings.assistantMaxChars,
  );

  await handoffToClaude(text, ASSISTANT_AUTO_SUBMIT[action]);
}

/* ------------------------------------------------------------------ */
/* 事件註冊                                                             */
/* ------------------------------------------------------------------ */

// 右鍵選單：安裝／更新時重建（選單註冊持久存在，onClicked 會喚醒休眠的 SW）
chrome.runtime.onInstalled.addListener(() => {
  registerAssistantMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = String(info.menuItemId);
  if (!menuId.startsWith(ASSISTANT_MENU_PREFIX) || !tab) return;
  const action = menuId.slice(ASSISTANT_MENU_PREFIX.length) as AssistantAction;
  if (!ASSISTANT_ACTIONS.includes(action)) return;
  void handleAssistantAction(action, info, tab).catch((err: unknown) => {
    console.warn('[雙語翻譯] Claude 助手動作失敗', err);
  });
});

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
