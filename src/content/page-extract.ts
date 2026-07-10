/**
 * 頁面主內容擷取（Claude 助手「摘要此頁」用）。
 *
 * 由 background 以 chrome.scripting.executeScript({ func }) 在原分頁執行
 * （右鍵點外掛選單即授予 activeTab），不常駐、不留任何狀態。
 *
 * ⚠️ executeScript 是把函式「序列化後」丟進頁面執行，因此本函式必須
 * 完全自包含：不得引用任何 import、外層變數或其他函式。
 *
 * 擷取策略（依序回退）：
 * 1. 語意容器優先：article → main → [role="main"]，容器內仍只收段落區塊並套
 *    雜訊排除（容器常內含導覽／推薦連結），過濾後 ≥ 500 字元即採用
 * 2. 啟發式回退：全頁收集段落區塊，以文字量最大的共同祖先為主內容根
 * 3. 最終回退：document.body.innerText
 */

/** 擷取結果（隨帶入文字的 {{page_title}} / {{page_url}} / {{content}} 使用） */
export interface PageExtractResult {
  title: string;
  url: string;
  content: string;
}

export function extractPageContent(): PageExtractResult {
  /** 擷取結果要「像正文」的最低字元數，低於此視為誤中（如空的 article 骨架） */
  const MIN_SEMANTIC_CHARS = 500;
  /** 啟發式：主內容根需涵蓋的區塊文字量比例 */
  const ROOT_COVERAGE_RATIO = 0.6;
  /** 收集的段落區塊 */
  const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption';
  /** 位於這些祖先之內的區塊視為雜訊（導覽／頁尾／表單）或不該送出的內容（程式碼） */
  const EXCLUDE_ANCESTOR_SELECTOR = [
    'nav',
    'header',
    'footer',
    'aside',
    'form',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[aria-hidden="true"]',
    'pre',
    'code',
    'script',
    'style',
    'noscript',
  ].join(', ');

  const normalize = (text: string): string =>
    text
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const result = (content: string): PageExtractResult => ({
    title: document.title,
    url: location.href,
    content,
  });

  const isVisible = (el: HTMLElement): boolean =>
    typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.offsetParent !== null;

  /** 收集 root 之內、排除雜訊後的最內層區塊（li 包 p 時只取 p，避免重複計文） */
  const collectBlocks = (root: HTMLElement | Document): Array<{ el: HTMLElement; text: string }> => {
    const blocks: Array<{ el: HTMLElement; text: string }> = [];
    for (const el of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
      if (el.closest(EXCLUDE_ANCESTOR_SELECTOR)) continue;
      if (el.querySelector(BLOCK_SELECTOR)) continue;
      if (!isVisible(el)) continue;
      const text = normalize(el.innerText);
      if (!text) continue;
      blocks.push({ el, text });
    }
    return blocks;
  };

  // 1. 語意容器優先（多個候選取文字最長者；容器內仍套區塊過濾擋雜訊）
  for (const selector of ['article', 'main', '[role="main"]']) {
    let best: HTMLElement | null = null;
    let bestLength = 0;
    for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
      if (!isVisible(candidate)) continue;
      const length = candidate.innerText.length;
      if (length > bestLength) {
        best = candidate;
        bestLength = length;
      }
    }
    if (!best) continue;

    const filtered = collectBlocks(best)
      .map((block) => block.text)
      .join('\n\n');
    if (filtered.length >= MIN_SEMANTIC_CHARS) return result(filtered);

    // 過濾後過短（版面不用 p 等標籤）→ 退回容器全文再試
    const full = normalize(best.innerText);
    if (full.length >= MIN_SEMANTIC_CHARS) return result(full);
  }

  // 2. 啟發式回退：全頁收集區塊，以文字量最大的共同祖先為主內容根
  const blocks = collectBlocks(document);
  if (blocks.length > 0) {
    const scores = new Map<HTMLElement, number>();
    let totalChars = 0;
    for (const block of blocks) {
      totalChars += block.text.length;
      let node = block.el.parentElement;
      while (node && node !== document.documentElement) {
        scores.set(node, (scores.get(node) ?? 0) + block.text.length);
        node = node.parentElement;
      }
    }

    let root: HTMLElement = document.body;
    let rootDepth = -1;
    for (const [node, score] of scores) {
      if (score < totalChars * ROOT_COVERAGE_RATIO) continue;
      let depth = 0;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) depth++;
      if (depth > rootDepth) {
        rootDepth = depth;
        root = node;
      }
    }

    const content = blocks
      .filter((block) => root.contains(block.el))
      .map((block) => block.text)
      .join('\n\n');
    if (content) return result(content);
  }

  // 3. 最終回退
  return result(normalize(document.body.innerText));
}
