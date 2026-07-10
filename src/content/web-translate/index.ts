/**
 * 網頁雙語翻譯 content script（功能一的進入點）。
 *
 * 由 background 以 chrome.scripting 動態注入（activeTab 權限），
 * 收到 TOGGLE_TRANSLATE 時在「翻譯」與「還原原文」之間切換。
 *
 * 翻譯流程：
 *   Scanner 回報進入視口的段落 → 短暫收集成一批 → 送 background 翻譯
 *   → 譯文插入原文下方。樣式變更會即時套用（更新 <style>），不需重翻。
 */
import { loadSettings, onSettingsChanged } from '../../shared/settings';
import { buildTranslationCss } from '../../shared/styles';
import type { ContentRequest, TranslateBatchResponse } from '../../shared/types';
import { markLoading, removeAllTranslations, setError, setTranslation } from './renderer';
import { extractText, Scanner } from './scanner';

// 動態注入可能重複執行（例如 background 的 PING 恰好逾時），用全域旗標防止重複初始化
declare global {
  interface Window {
    __btWebTranslateLoaded?: boolean;
  }
}

if (!window.__btWebTranslateLoaded) {
  window.__btWebTranslateLoaded = true;
  init();
}

function init(): void {
  /** 目前是否處於「翻譯中」狀態 */
  let active = false;
  let scanner: Scanner | null = null;
  /** 注入頁面的譯文樣式 */
  let styleElement: HTMLStyleElement | null = null;
  /** 等待送出翻譯的段落（收集一小段時間後合併成一批） */
  let pendingElements: HTMLElement[] = [];
  let flushTimer: number | undefined;
  /** 本頁已累計送翻的字元數（防止費用暴衝的頁面上限） */
  let translatedChars = 0;
  /** 超過頁面字數上限後停止翻譯，只提示一次 */
  let limitReached = false;

  /* ---------------------------- 樣式 ---------------------------- */

  /** 注入或更新譯文樣式（樣式切換即時生效、不需重新翻譯的關鍵） */
  async function applyStyle(): Promise<void> {
    const settings = await loadSettings();
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'bt-translation-style';
      document.documentElement.appendChild(styleElement);
    }
    styleElement.textContent = buildTranslationCss(settings.style);
  }

  // 設定頁改了樣式 → 立即反映在既有譯文上
  onSettingsChanged(() => {
    if (active) void applyStyle();
  });

  /* ---------------------------- 翻譯批次 ---------------------------- */

  /** 段落進入視口：先放進待送清單，稍後合併成一批送出 */
  function onParagraphVisible(element: HTMLElement): void {
    if (!active || limitReached) return;

    const text = extractText(element);
    if (translatedChars + text.length > getMaxChars()) {
      notifyLimitReached();
      return;
    }
    translatedChars += text.length;

    pendingElements.push(element);
    markLoading(element);

    // 400ms 的收集窗口：把同時進入視口的段落合併成一個請求
    if (flushTimer === undefined) {
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined;
        void flushPending();
      }, 400);
    }
  }

  let cachedMaxChars = 10000;
  function getMaxChars(): number {
    return cachedMaxChars;
  }

  /** 把待送清單送去 background 翻譯，並把結果寫回各段落 */
  async function flushPending(): Promise<void> {
    const elements = pendingElements;
    pendingElements = [];
    if (elements.length === 0) return;

    const texts = elements.map(extractText);
    let response: TranslateBatchResponse;
    try {
      response = await chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', items: texts });
    } catch (err) {
      response = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // 使用者可能在等待期間按了「還原」，此時直接丟棄結果
    if (!active) return;

    if (response.ok && response.translations) {
      elements.forEach((element, i) => setTranslation(element, response.translations![i]));
    } else {
      const message = response.error ?? '未知錯誤';
      elements.forEach((element) => setError(element, message));
      showToast(`翻譯失敗：${message}`);
    }
  }

  /* ---------------------------- 提示訊息 ---------------------------- */

  /** 在頁面右下角顯示短暫的提示（錯誤、達到字數上限等） */
  function showToast(message: string): void {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position: fixed',
      'right: 16px',
      'bottom: 16px',
      'z-index: 2147483647',
      'max-width: 320px',
      'padding: 10px 14px',
      'border-radius: 8px',
      'background: rgba(30, 30, 30, 0.92)',
      'color: #fff',
      'font-size: 13px',
      'line-height: 1.5',
      'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)',
    ].join(';');
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function notifyLimitReached(): void {
    if (limitReached) return;
    limitReached = true;
    scanner?.stop();
    showToast(`已達單頁翻譯字數上限（${getMaxChars().toLocaleString()} 字），可到設定頁調整。`);
  }

  /* ---------------------------- 啟用 / 還原 ---------------------------- */

  async function enable(): Promise<void> {
    active = true;
    translatedChars = 0;
    limitReached = false;

    const settings = await loadSettings();
    cachedMaxChars = settings.maxCharsPerPage;

    await applyStyle();
    scanner = new Scanner(onParagraphVisible);
    scanner.start();
  }

  function disable(): void {
    active = false;
    scanner?.stop();
    scanner = null;
    pendingElements = [];
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    removeAllTranslations();
    styleElement?.remove();
    styleElement = null;
  }

  /* ---------------------------- 訊息入口 ---------------------------- */

  chrome.runtime.onMessage.addListener(
    (message: ContentRequest, _sender, sendResponse: (response: unknown) => void) => {
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true });
          return false;
        case 'GET_STATE':
          sendResponse({ active });
          return false;
        case 'TOGGLE_TRANSLATE':
          if (active) {
            disable();
            sendResponse({ active: false });
          } else {
            // enable 是非同步的：先啟動，立即回報新狀態
            void enable();
            sendResponse({ active: true });
          }
          return false;
        default:
          return false;
      }
    },
  );
}
