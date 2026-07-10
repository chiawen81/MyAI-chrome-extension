/**
 * 譯文樣式：把使用者的樣式設定轉成 CSS 字串。
 *
 * 實作方式：譯文節點帶有 data-bt-translation 屬性，
 * 我們注入一個 <style> 到頁面，用屬性選擇器 + !important 提高優先權，
 * 盡量避免被宿主頁面的 CSS 覆蓋。
 * 樣式改變時只要替換 <style> 內容即可，譯文不需重新產生。
 */
import type { StyleSettings } from './types';

/** 譯文節點的識別屬性（也用於「還原原文」時一次移除所有譯文） */
export const TRANSLATION_ATTR = 'data-bt-translation';

/** 各預設樣式對應的 CSS 宣告（只描述外觀差異，版面規則另外統一處理） */
const PRESET_RULES: Record<StyleSettings['preset'], string> = {
  // 無樣式：與原文完全相同
  none: '',
  // 虛線底線
  dashed: `
    text-decoration: underline dashed !important;
    text-decoration-thickness: 1px !important;
    text-underline-offset: 4px !important;
  `,
  // 馬克筆（背景高亮）
  marker: `
    background-color: rgba(255, 235, 59, 0.45) !important;
    box-decoration-break: clone !important;
    -webkit-box-decoration-break: clone !important;
  `,
  // 引用（左側豎線 + 縮排 + 淡色）
  quote: `
    border-left: 3px solid rgba(128, 128, 128, 0.6) !important;
    padding-left: 0.6em !important;
    opacity: 0.85 !important;
  `,
};

/**
 * 產生注入頁面的完整 CSS。
 * 版面規則（display:block、與原文的間距）固定不變；
 * 外觀由「預設樣式」+「進階自訂」組成，自訂值優先於預設樣式。
 */
export function buildTranslationCss(style: StyleSettings): string {
  const custom: string[] = [];
  if (style.textColor) {
    custom.push(`color: ${style.textColor} !important;`);
  }
  if (style.backgroundColor) {
    custom.push(`background-color: ${style.backgroundColor} !important;`);
  }
  if (style.fontSizePercent && style.fontSizePercent !== 100) {
    custom.push(`font-size: ${style.fontSizePercent}% !important;`);
  }
  if (style.fontFamily) {
    custom.push(`font-family: ${style.fontFamily} !important;`);
  }

  return `
    [${TRANSLATION_ATTR}] {
      display: block;
      margin-top: 0.3em;
      unicode-bidi: isolate;
      ${PRESET_RULES[style.preset]}
      ${custom.join('\n')}
    }
    /* 翻譯進行中的佔位提示 */
    [${TRANSLATION_ATTR}][data-bt-loading] {
      opacity: 0.5 !important;
      font-style: italic;
    }
  `;
}
