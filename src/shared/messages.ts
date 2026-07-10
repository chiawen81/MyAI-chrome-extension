/**
 * 跨 context 訊息協定集中定義處。
 * content / service worker / popup / options 之間僅透過
 * chrome.runtime message 通訊，所有訊息型別一律定義在這裡。
 */

import type { ProviderId } from './types';

/** content script / popup / options → background 的請求 */
export type BackgroundRequest =
  | {
      /** 批次翻譯：items 為原文陣列，context 為前文（僅供參考、不翻譯） */
      type: 'TRANSLATE_BATCH';
      items: string[];
      context?: string[];
    }
  | {
      /** 設定頁的「測試連線」：用表單上尚未儲存的值直接測試 */
      type: 'TEST_CONNECTION';
      provider: ProviderId;
      apiKey: string;
      model: string;
    }
  | { type: 'CLEAR_CACHE' }
  | { type: 'GET_CACHE_STATS' }
  | {
      /** popup 按下「翻譯／還原」：由 background 負責注入 content script 並轉發 */
      type: 'POPUP_TOGGLE';
      tabId: number;
    }
  | {
      /** popup 開啟時查詢目前分頁的翻譯狀態 */
      type: 'POPUP_GET_STATE';
      tabId: number;
    };

/** background → 網頁翻譯 content script 的請求 */
export type ContentRequest =
  | { type: 'PING' }
  | { type: 'TOGGLE_TRANSLATE' }
  | { type: 'GET_STATE' };

/** 批次翻譯的回應 */
export interface TranslateBatchResponse {
  ok: boolean;
  /** ok 為 true 時，與 items 等長、順序一致的譯文陣列 */
  translations?: string[];
  error?: string;
}

/** 泛用的成功／失敗回應 */
export interface SimpleResponse {
  ok: boolean;
  error?: string;
  /** GET_CACHE_STATS 使用：快取筆數 */
  count?: number;
  /** POPUP_GET_STATE / POPUP_TOGGLE 使用：目前是否處於翻譯狀態 */
  active?: boolean;
}
