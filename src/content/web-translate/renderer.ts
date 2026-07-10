/**
 * 譯文渲染器：負責譯文節點的插入、更新與移除。
 *
 * 插入方式：把譯文作為「子節點」附加在原文元素內部的最後，
 * 並以 CSS display:block 讓它顯示在原文下方（垂直雙語對照）。
 * 這樣做的好處：
 * - 不觸碰原文的任何文字節點（還原時只要移除譯文節點即可，無殘留）
 * - 自動繼承原文的字級、行寬與排版（在 li、td 等結構中也不會破壞版面）
 */
import { TRANSLATION_ATTR } from '../../shared/styles';

/** 取得元素內既有的譯文節點（若有） */
function getTranslationNode(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>(`:scope > [${TRANSLATION_ATTR}]`);
}

/** 插入「翻譯中…」佔位節點；若已存在譯文節點則不重複插入 */
export function markLoading(element: HTMLElement): void {
  if (getTranslationNode(element)) return;
  const node = document.createElement('span');
  node.setAttribute(TRANSLATION_ATTR, '');
  node.setAttribute('data-bt-loading', '');
  node.textContent = '翻譯中…';
  element.appendChild(node);
}

/** 以實際譯文取代佔位內容 */
export function setTranslation(element: HTMLElement, translation: string): void {
  const node = getTranslationNode(element);
  if (!node) return;
  node.removeAttribute('data-bt-loading');
  node.textContent = translation;
}

/** 翻譯失敗：移除佔位節點，並把錯誤放到 title 方便使用者檢視 */
export function setError(element: HTMLElement, message: string): void {
  const node = getTranslationNode(element);
  if (!node) return;
  node.remove();
  element.title = `翻譯失敗：${message}`;
}

/** 移除頁面上所有譯文節點（還原原文） */
export function removeAllTranslations(): void {
  document.querySelectorAll(`[${TRANSLATION_ATTR}]`).forEach((node) => node.remove());
}
