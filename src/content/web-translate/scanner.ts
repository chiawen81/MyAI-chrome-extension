/**
 * 段落掃描器：
 * - 找出頁面上可翻譯的區塊元素（p、標題、li、blockquote…）
 * - 用 IntersectionObserver 做惰性翻譯：段落進入視口才回報，省 token、加快首屏
 * - 用 MutationObserver 追蹤動態載入的內容（無限捲動、SPA 等）
 */
import { TRANSLATION_ATTR } from '../../shared/styles';

/** 視為「可翻譯段落」的區塊元素 */
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, td, th';

/** 這些容器內的文字不翻譯（程式碼、表單、編輯器等） */
const EXCLUDED_ANCESTOR_SELECTOR = 'pre, code, textarea, input, select, [contenteditable="true"]';

/** 至少要包含一個「字母／文字」才值得翻譯（過濾純數字、純符號的段落） */
const HAS_LETTER = /\p{L}/u;

export class Scanner {
  /** 進入視口、等待翻譯的段落會透過這個 callback 回報 */
  private readonly onVisible: (element: HTMLElement) => void;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly mutationObserver: MutationObserver;
  /** 已經送出觀察／處理過的元素，避免重複 */
  private readonly seen = new WeakSet<HTMLElement>();
  private mutationTimer: number | undefined;

  constructor(onVisible: (element: HTMLElement) => void) {
    this.onVisible = onVisible;

    // rootMargin 預抓範圍：下方 2 個螢幕高、上方 0.5 個螢幕高（百分比相對於視口）。
    // API 單組延遲約 5~15 秒，預抓太少會讓捲動永遠跑在翻譯前面、滿屏「翻譯中…」；
    // 頁面字數上限（settings.maxCharsPerPage）仍擋著預抓的費用上限。
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          this.intersectionObserver.unobserve(element);
          this.onVisible(element);
        }
      },
      { rootMargin: '50% 0px 200% 0px' },
    );

    // 動態新增的節點：合併 1 秒內的變動後重新掃描一次，避免高頻頁面拖慢效能
    this.mutationObserver = new MutationObserver(() => {
      if (this.mutationTimer !== undefined) return;
      this.mutationTimer = window.setTimeout(() => {
        this.mutationTimer = undefined;
        this.scan();
      }, 1000);
    });
  }

  /** 開始掃描：先處理現有內容，再監聽後續的 DOM 變動 */
  start(): void {
    this.scan();
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  /** 停止所有觀察（還原原文時呼叫） */
  stop(): void {
    this.intersectionObserver.disconnect();
    this.mutationObserver.disconnect();
    if (this.mutationTimer !== undefined) {
      clearTimeout(this.mutationTimer);
      this.mutationTimer = undefined;
    }
  }

  /** 掃描整頁，把符合條件的段落交給 IntersectionObserver 觀察 */
  private scan(): void {
    const candidates = document.body.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
    for (const element of candidates) {
      if (this.seen.has(element)) continue;
      if (!this.isTranslatable(element)) continue;
      this.seen.add(element);
      this.intersectionObserver.observe(element);
    }
  }

  /** 判斷一個元素是否值得翻譯 */
  private isTranslatable(element: HTMLElement): boolean {
    // 自己就是譯文節點、或位於譯文節點內 → 跳過
    if (element.closest(`[${TRANSLATION_ATTR}]`)) return false;

    // 位於排除清單的容器內（程式碼區塊、輸入框等）→ 跳過
    if (element.closest(EXCLUDED_ANCESTOR_SELECTOR)) return false;

    // 內部還有更小的候選段落（例如 li 裡面有 p）→ 跳過外層、翻譯最內層即可
    if (element.querySelector(BLOCK_SELECTOR)) return false;

    // 沒有實際文字內容 → 跳過
    const text = extractText(element);
    if (text.length < 2 || !HAS_LETTER.test(text)) return false;

    // 隱藏元素 → 跳過（checkVisibility 是較新的 API，舊版瀏覽器退回尺寸判斷）
    const visible =
      typeof element.checkVisibility === 'function'
        ? element.checkVisibility()
        : element.offsetWidth > 0 || element.offsetHeight > 0;
    return visible;
  }
}

/** 取出元素要送去翻譯的文字（排除已插入的譯文節點） */
export function extractText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`[${TRANSLATION_ATTR}]`).forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
