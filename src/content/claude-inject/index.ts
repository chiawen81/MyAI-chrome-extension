/**
 * claude.ai 注入 script（Claude 助手，功能三）。
 *
 * 由 background 在右鍵動作開啟 claude.ai 分頁後動態注入（host 權限 claude.ai/*），
 * 收到 ASSISTANT_FILL 時把帶入文字寫進輸入框，必要時自動送出。
 *
 * ⚠️ 本檔依賴 claude.ai 未公開的頁面結構（隔離慣例，同 subtitle-provider.ts）：
 * 所有 claude.ai 的 DOM 選擇器集中在此，claude.ai 改版只修這一檔。
 * 選擇器由 2026-07-11 的 Task 0 spike 驗證（見計畫文件 §2.1）。
 */
import type { AssistantFillResponse, ClaudeInjectRequest } from '../../shared/messages';

/** 輸入框：頁面上唯一的 contenteditable DIV（ProseMirror 編輯器） */
const INPUT_SELECTOR = 'div.ProseMirror[contenteditable="true"]';
/** 送出鈕以 aria-label 比對（實測為 "Send message"，用 /send/i 容錯） */
const SEND_BUTTON_LABEL_PATTERN = /send/i;

/** 等待輸入框出現的逾時（頁面剛載入，編輯器由前端框架非同步掛上） */
const INPUT_TIMEOUT_MS = 15000;
/** 送出鈕在填入文字後才非同步出現（實測約 1 秒內），輪詢等待的逾時 */
const SEND_BUTTON_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

// 動態注入可能重複執行（background 的 PING 恰好逾時），用全域旗標防止重複初始化
declare global {
  interface Window {
    __btClaudeInjectLoaded?: boolean;
  }
}

if (!window.__btClaudeInjectLoaded) {
  window.__btClaudeInjectLoaded = true;
  init();
}

function init(): void {
  chrome.runtime.onMessage.addListener(
    (message: ClaudeInjectRequest, _sender, sendResponse: (response: unknown) => void) => {
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true });
          return false;
        case 'ASSISTANT_FILL':
          fillAndMaybeSubmit(message.text, message.autoSubmit)
            .then(sendResponse)
            .catch((err: unknown) => {
              const error = err instanceof Error ? err.message : String(err);
              sendResponse({ ok: false, filled: false, submitted: false, error });
            });
          return true; // 非同步回應
        default:
          return false;
      }
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待輸入框出現：先直接找，沒有就以 MutationObserver 監看＋逾時 */
function waitForInput(timeoutMs: number): Promise<HTMLElement | null> {
  const existing = document.querySelector<HTMLElement>(INPUT_SELECTOR);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const input = document.querySelector<HTMLElement>(INPUT_SELECTOR);
      if (input) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(input);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/** 找送出鈕：填入文字後才會非同步出現 */
function findSendButton(): HTMLButtonElement | null {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[aria-label]')) {
    const label = button.getAttribute('aria-label') ?? '';
    if (SEND_BUTTON_LABEL_PATTERN.test(label)) return button;
  }
  return null;
}

/**
 * 主流程：等輸入框 → 寫入文字 →（autoSubmit 時）輪詢等送出鈕出現 → 點擊。
 * - 找不到輸入框：回報 filled: false，由 background 走 ?q= 備援。
 * - 找得到輸入框但送出鈕失效：保留已填文字不送出（使用者自行按 Enter），不視為錯誤。
 */
async function fillAndMaybeSubmit(text: string, autoSubmit: boolean): Promise<AssistantFillResponse> {
  const input = await waitForInput(INPUT_TIMEOUT_MS);
  if (!input) {
    console.warn('[雙語翻譯] 找不到 claude.ai 輸入框（claude.ai 可能已改版）');
    return { ok: false, filled: false, submitted: false, error: '找不到輸入框（claude.ai 可能已改版）' };
  }

  // Task 0 驗證的寫入方式：focus → 全選 → insertText（換行保留、ProseMirror 狀態同步）
  input.focus();
  document.execCommand('selectAll', false);
  document.execCommand('insertText', false, text);

  if (!autoSubmit) {
    return { ok: true, filled: true, submitted: false };
  }

  const deadline = Date.now() + SEND_BUTTON_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const button = findSendButton();
    if (button && !button.disabled) {
      button.click();
      return { ok: true, filled: true, submitted: true };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // 優雅降級：文字已在輸入框，使用者自行按 Enter 即可
  console.warn('[雙語翻譯] 等不到 claude.ai 送出鈕（claude.ai 可能已改版），已保留填入內容');
  return { ok: true, filled: true, submitted: false };
}
