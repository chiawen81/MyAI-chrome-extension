/**
 * YouTube SPA 導航偵測。
 *
 * YouTube 換影片不會重新載入頁面，content script 只會執行一次，
 * 因此必須自行偵測「換片」並通知主邏輯清理舊狀態（對照組外掛的已知 bug 就出在這裡）。
 *
 * 偵測方式（雙保險）：
 * 1. 監聽 YouTube 的自訂事件 'yt-navigate-finish'（主要方式）
 * 2. 每秒輪詢 URL 作為備援 —— 若 YouTube 未來改掉事件名稱，功能仍可運作
 * 兩者都以「videoId 是否改變」去重，不會重複觸發。
 */

/** 從網址取出影片 id；非 watch 頁面回傳 null */
export function getCurrentVideoId(): string | null {
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

/**
 * 監看導航變化。videoId 改變（含進入／離開 watch 頁）時呼叫 callback。
 * @returns 停止監看的函式
 */
export function watchNavigation(onChange: (videoId: string | null) => void): () => void {
  let lastVideoId = getCurrentVideoId();

  const check = (): void => {
    const videoId = getCurrentVideoId();
    if (videoId !== lastVideoId) {
      lastVideoId = videoId;
      onChange(videoId);
    }
  };

  window.addEventListener('yt-navigate-finish', check);
  const pollTimer = window.setInterval(check, 1000);

  return () => {
    window.removeEventListener('yt-navigate-finish', check);
    clearInterval(pollTimer);
  };
}
