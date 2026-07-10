/**
 * 翻譯快取：存於 chrome.storage.local。
 * key = hash(原文 + 供應商 + 模型 + 專家 + 目標語言)，
 * 同一頁重開、或同影片重看時不會重複扣 API 費用。
 *
 * 注意：crypto.subtle 只在安全環境（https / extension context）可用，
 * 因此雜湊統一在 background service worker 與 https 頁面（YouTube）中執行。
 */

const CACHE_PREFIX = 'btcache:';

/** 將多段資料合併後做 SHA-256，回傳十六進位字串作為快取 key 的主體 */
export async function makeCacheKey(parts: string[]): Promise<string> {
  // 用不會出現在正常文字中的分隔符，避免不同組合意外撞出相同輸入
  const input = parts.join('\u0001');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return CACHE_PREFIX + hex;
}

/** 一次讀取多個快取項目；回傳 map（不存在的 key 值為 undefined） */
export async function cacheGetMany(keys: string[]): Promise<Record<string, string | undefined>> {
  if (keys.length === 0) return {};
  const stored = await chrome.storage.local.get(keys);
  const result: Record<string, string | undefined> = {};
  for (const key of keys) {
    result[key] = stored[key] as string | undefined;
  }
  return result;
}

/** 一次寫入多個快取項目 */
export async function cacheSetMany(entries: Record<string, string>): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  try {
    await chrome.storage.local.set(entries);
  } catch (err) {
    // 快取寫入失敗（例如超過配額）不應中斷翻譯流程，只記錄警告
    console.warn('[雙語翻譯] 快取寫入失敗：', err);
  }
}

/** 清除所有翻譯快取（設定頁的「清除快取」按鈕） */
export async function cacheClear(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((key) => key.startsWith(CACHE_PREFIX));
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}

/** 統計快取筆數（設定頁顯示用） */
export async function cacheCount(): Promise<number> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((key) => key.startsWith(CACHE_PREFIX)).length;
}
