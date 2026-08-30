/**
 * YouTube 雙語字幕 content script（功能二的進入點）。
 *
 * - 在播放器工具列注入「雙語字幕」按鈕，點擊開關控制面板
 * - 面板可選擇來源字幕語言、開啟／關閉雙語字幕、顯示翻譯進度
 * - 整批預翻譯：取得完整字幕後分批並行送翻（首批縮小以求譯文快速出現，
 *   每批帶前一批最後 2 句原文作為上下文）
 * - 譯文以「影片ID + 供應商 + 模型 + 專家 + 目標語言 + 字幕軌」為 key 快取
 * - 監聽 SPA 換片：清除字幕層與狀態，避免舊字幕殘留（驗收重點）
 */
import { cacheGetMany, cacheSetMany, makeCacheKey } from '../../shared/cache';
import { loadSettings, onSettingsChanged } from '../../shared/settings';
import type { Settings, TranslateBatchResponse } from '../../shared/types';
import { getCurrentVideoId, watchNavigation } from './navigation';
import { SubtitleOverlay } from './subtitle-overlay';
import { fetchCaptionTracks, fetchCues, type CaptionTrack, type SubtitleCue } from './subtitle-provider';

/* ------------------------------------------------------------------ */
/* 狀態                                                                 */
/* ------------------------------------------------------------------ */

/** 目前影片的工作狀態；換片時整組丟棄重建，確保不殘留 */
interface VideoSession {
  videoId: string;
  tracks: CaptionTrack[] | null;
  cues: SubtitleCue[];
  translations: string[];
  overlay: SubtitleOverlay | null;
  /** 換片時設為 true，讓仍在進行中的翻譯流程自行中止 */
  cancelled: boolean;
  /**
   * 執行代號：每次「開啟／關閉字幕」都會遞增。
   * 翻譯迴圈在啟動時記下當時的代號，發現代號改變就中止，
   * 避免「關閉後又立刻開啟」時新舊兩條翻譯流程互相覆蓋。
   */
  runToken: number;
}

let session: VideoSession | null = null;
let panel: HTMLDivElement | null = null;

type YouTubeButtonState = 'inactive' | 'loading' | 'active';

const YOUTUBE_BUTTON_STYLE_ID = 'bt-yt-button-style';

const YOUTUBE_BUTTON_ICON = `
  <svg class="bt-yt-button__icon" viewBox="0 0 36 36" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path class="bt-yt-button__signal" d="M18 10V7" />
      <rect x="8" y="11" width="20" height="17" rx="4" />
      <path d="M8 16H6.5A1.5 1.5 0 0 0 5 17.5v4A1.5 1.5 0 0 0 6.5 23H8M28 16h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H28M14 23h8" />
    </g>
    <g fill="currentColor">
      <circle class="bt-yt-button__signal" cx="18" cy="5" r="2" />
      <circle cx="14" cy="18" r="1.6" />
      <circle cx="22" cy="18" r="1.6" />
    </g>
  </svg>
`;

/* ------------------------------------------------------------------ */
/* 初始化                                                               */
/* ------------------------------------------------------------------ */

init();

function init(): void {
  // 進入 watch 頁（或換片）時重建狀態；離開 watch 頁時清理並收合面板
  watchNavigation((videoId) => {
    teardownSession();
    if (videoId) {
      setupForVideo(videoId);
      // 面板重置須在新 session 建立後，populateTracks() 才拿得到新影片
      updatePanelForNewVideo();
    } else if (panel) {
      panel.style.display = 'none';
      setPanelExpanded(false);
    }
  });

  const initialVideoId = getCurrentVideoId();
  if (initialVideoId) setupForVideo(initialVideoId);

  // 使用者調整樣式時，即時套用到字幕層
  onSettingsChanged((settings) => {
    session?.overlay?.applyStyle(settings.style);
  });
}

/** 清掉舊影片的一切：字幕層、進行中的翻譯（面板重置由呼叫端在新 session 建立後處理） */
function teardownSession(): void {
  if (!session) return;
  session.cancelled = true;
  session.overlay?.destroy();
  session = null;
  setYouTubeButtonState('inactive');
}

function setupForVideo(videoId: string): void {
  session = {
    videoId,
    tracks: null,
    cues: [],
    translations: [],
    overlay: null,
    cancelled: false,
    runToken: 0,
  };
  // 播放器是延遲載入的，輪詢直到工具列出現再注入按鈕
  void injectButtonWhenReady();
}

/* ------------------------------------------------------------------ */
/* 播放器按鈕與控制面板                                                   */
/* ------------------------------------------------------------------ */

/** 等待播放器工具列出現後注入按鈕（按鈕在 SPA 換片間會保留，只注入一次） */
async function injectButtonWhenReady(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const controls = document.querySelector<HTMLElement>('#movie_player .ytp-right-controls');
    if (controls) {
      if (!controls.querySelector('.bt-yt-button')) {
        controls.prepend(createButton());
      }
      return;
    }
    await sleep(500);
  }
}

function createButton(): HTMLButtonElement {
  ensureYouTubeButtonStyles();
  const button = document.createElement('button');
  button.className = 'ytp-button bt-yt-button';
  button.title = '雙語字幕';
  button.setAttribute('aria-label', '開啟雙語字幕面板');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-pressed', 'false');
  button.dataset.state = session?.overlay ? 'active' : 'inactive';
  button.innerHTML = YOUTUBE_BUTTON_ICON;
  button.addEventListener('click', () => togglePanel());
  return button;
}

function ensureYouTubeButtonStyles(): void {
  if (document.getElementById(YOUTUBE_BUTTON_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = YOUTUBE_BUTTON_STYLE_ID;
  style.textContent = `
    #movie_player .bt-yt-button {
      position: relative;
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      width: 48px !important;
      height: 100% !important;
      padding: 0 !important;
      vertical-align: middle;
      color: #fff;
      opacity: 0.9;
      transition: opacity 120ms ease, transform 120ms ease;
    }
    #movie_player .bt-yt-button:hover,
    #movie_player .bt-yt-button:focus-visible,
    #movie_player .bt-yt-button[aria-expanded="true"] {
      opacity: 1;
    }
    #movie_player .bt-yt-button:active {
      transform: scale(0.92);
    }
    #movie_player .bt-yt-button:focus-visible {
      outline: 2px solid #fff;
      outline-offset: -6px;
      border-radius: 8px;
    }
    #movie_player .bt-yt-button__icon {
      display: block;
      width: 28px !important;
      height: 28px !important;
      padding: 0 !important;
      margin: 0 !important;
      pointer-events: none;
    }
    #movie_player .bt-yt-button__signal {
      opacity: 0.68;
      transition: opacity 160ms ease;
    }
    #movie_player .bt-yt-button::after {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 5px;
      width: 0;
      height: 2px;
      border-radius: 2px;
      background: #f03;
      transform: translateX(-50%);
      transition: width 160ms ease;
    }
    #movie_player .bt-yt-button[data-state="active"]::after {
      width: 20px;
    }
    #movie_player .bt-yt-button[data-state="active"] .bt-yt-button__signal {
      opacity: 1;
    }
    #movie_player .bt-yt-button[data-state="loading"] .bt-yt-button__icon {
      animation: bt-yt-button-pulse 900ms ease-in-out infinite alternate;
    }
    @keyframes bt-yt-button-pulse {
      from { opacity: 0.42; }
      to { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      #movie_player .bt-yt-button,
      #movie_player .bt-yt-button__signal,
      #movie_player .bt-yt-button::after {
        transition: none;
      }
      #movie_player .bt-yt-button[data-state="loading"] .bt-yt-button__icon {
        animation: none;
        opacity: 0.65;
      }
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

function setYouTubeButtonState(state: YouTubeButtonState): void {
  const button = document.querySelector<HTMLButtonElement>('#movie_player .bt-yt-button');
  if (!button) return;

  button.dataset.state = state;
  button.setAttribute('aria-pressed', String(state === 'active'));
  if (state === 'loading') {
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', '雙語字幕準備中');
  } else {
    button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', state === 'active' ? '雙語字幕已開啟' : '開啟雙語字幕面板');
  }
}

function setPanelExpanded(expanded: boolean): void {
  const button = document.querySelector<HTMLButtonElement>('#movie_player .bt-yt-button');
  button?.setAttribute('aria-expanded', String(expanded));
}

/** 開關控制面板；第一次開啟時建立 DOM 並載入字幕軌清單 */
function togglePanel(): void {
  if (panel && panel.style.display !== 'none') {
    panel.style.display = 'none';
    setPanelExpanded(false);
    return;
  }
  if (!panel) {
    panel = createPanel();
    document.querySelector('#movie_player')?.appendChild(panel);
  }
  panel.style.display = 'block';
  setPanelExpanded(true);
  void populateTracks();
}

/** 建立控制面板 DOM（字幕軌選單、開始／關閉按鈕、進度與狀態列） */
function createPanel(): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'bt-yt-panel';
  root.style.cssText = [
    'position: absolute',
    'right: 12px',
    'bottom: 60px',
    'z-index: 70',
    'width: 260px',
    'padding: 12px',
    'border-radius: 8px',
    'background: rgba(28, 28, 28, 0.95)',
    'color: #eee',
    'font-size: 13px',
    'line-height: 1.6',
  ].join(';');

  root.innerHTML = `
    <div style="font-weight:700; margin-bottom:8px;">雙語字幕</div>
    <label style="display:block; margin-bottom:4px;">來源字幕：</label>
    <select class="bt-track-select" style="width:100%; margin-bottom:8px; background:#222; color:#eee; border:1px solid #555; border-radius:4px; padding:4px;"></select>
    <button class="bt-start" style="width:100%; padding:6px; border:none; border-radius:4px; background:#3b82f6; color:#fff; cursor:pointer;">開啟雙語字幕</button>
    <progress class="bt-progress" max="100" value="0" style="width:100%; margin-top:8px; display:none;"></progress>
    <div class="bt-status" style="margin-top:6px; color:#aaa; min-height:1.2em;"></div>
  `;

  root.querySelector<HTMLButtonElement>('.bt-start')!.addEventListener('click', () => {
    if (session?.overlay) {
      stopSubtitles();
    } else {
      void startSubtitles();
    }
  });

  return root;
}

/** 面板內的小工具 */
function panelEl<T extends HTMLElement>(selector: string): T | null {
  return panel?.querySelector<T>(selector) ?? null;
}

function setStatus(text: string): void {
  const status = panelEl<HTMLDivElement>('.bt-status');
  if (status) status.textContent = text;
}

function setProgress(percent: number | null): void {
  const progress = panelEl<HTMLProgressElement>('.bt-progress');
  if (!progress) return;
  if (percent === null) {
    progress.style.display = 'none';
  } else {
    progress.style.display = 'block';
    progress.value = percent;
  }
}

function setStartButton(label: string, disabled = false): void {
  const button = panelEl<HTMLButtonElement>('.bt-start');
  if (button) {
    button.textContent = label;
    button.disabled = disabled;
  }
}

/** 換片後重置面板顯示（面板 DOM 保留，內容重新載入） */
function updatePanelForNewVideo(): void {
  if (!panel) return;
  setStartButton('開啟雙語字幕');
  setProgress(null);
  setStatus('');
  const select = panelEl<HTMLSelectElement>('.bt-track-select');
  if (select) select.innerHTML = '';
  if (panel.style.display !== 'none') void populateTracks();
}

/** 載入目前影片的字幕軌清單到下拉選單 */
async function populateTracks(): Promise<void> {
  const current = session;
  const select = panelEl<HTMLSelectElement>('.bt-track-select');
  if (!current || !select || select.options.length > 0) return;

  setStatus('載入字幕軌清單…');
  try {
    current.tracks = await fetchCaptionTracks(current.videoId);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    return;
  }
  if (current.cancelled) return;

  if (current.tracks.length === 0) {
    setStatus('此影片沒有可用的字幕軌。');
    return;
  }

  current.tracks.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = track.isAutoGenerated
      ? `${track.displayName}（自動產生）`
      : track.displayName;
    select.appendChild(option);
  });

  // 預設選擇第一條「人工上傳」字幕；沒有就選第一條
  const preferred = current.tracks.findIndex((track) => !track.isAutoGenerated);
  select.value = String(preferred === -1 ? 0 : preferred);
  setStatus('');
}

/* ------------------------------------------------------------------ */
/* 字幕翻譯主流程                                                        */
/* ------------------------------------------------------------------ */

async function startSubtitles(): Promise<void> {
  const current = session;
  const select = panelEl<HTMLSelectElement>('.bt-track-select');
  if (!current || !select || !current.tracks) return;

  const track = current.tracks[Number(select.value)];
  if (!track) {
    setStatus('請先選擇來源字幕。');
    return;
  }

  const player = document.querySelector<HTMLElement>('#movie_player');
  const video = player?.querySelector<HTMLVideoElement>('video');
  if (!player || !video) {
    setStatus('找不到播放器，請重新整理頁面。');
    return;
  }

  // 記下本次執行的代號；之後每個 await 回來都要確認代號未變才繼續
  const myToken = ++current.runToken;
  setStartButton('準備中…', true);
  setYouTubeButtonState('loading');

  // 1. 下載字幕
  setStatus('下載字幕中…');
  try {
    current.cues = await fetchCues(track);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    setStartButton('開啟雙語字幕');
    setYouTubeButtonState('inactive');
    return;
  }
  if (current.cancelled || current.runToken !== myToken) return;

  if (current.cues.length === 0) {
    setStatus('這條字幕軌沒有內容。');
    setStartButton('開啟雙語字幕');
    setYouTubeButtonState('inactive');
    return;
  }

  const settings = await loadSettings();
  if (current.cancelled || current.runToken !== myToken) return;
  current.translations = new Array<string>(current.cues.length).fill('');

  // 2. 先掛上字幕層：翻譯逐批完成時字幕會漸進補上譯文
  const overlay = new SubtitleOverlay(player, video, settings.style);
  current.overlay = overlay;
  overlay.setData(current.cues, current.translations);
  setStartButton('關閉雙語字幕', false);
  setYouTubeButtonState('active');

  // 3. 查整部影片的譯文快取；命中就不用再翻
  const cacheKey = await makeCacheKey([
    'youtube',
    current.videoId,
    settings.provider,
    settings[settings.provider].model,
    settings.expertId,
    settings.targetLang,
    track.languageCode,
    String(track.isAutoGenerated),
  ]);
  const cachedRaw = (await cacheGetMany([cacheKey]))[cacheKey];
  if (current.cancelled || current.runToken !== myToken) return;
  if (cachedRaw) {
    const cachedTranslations = JSON.parse(cachedRaw) as string[];
    if (cachedTranslations.length === current.cues.length) {
      current.translations = cachedTranslations;
      overlay.setData(current.cues, current.translations);
      setStatus('已從快取載入譯文。');
      return;
    }
  }

  // 4. 分批翻譯（帶上下文，改善跨句斷句的連貫性）
  await translateAllCues(current, settings, cacheKey, myToken);
}

/** 首批句數：縮小首批，讓首句譯文能在單一小批往返內出現 */
const FIRST_BATCH_SIZE = 10;

/**
 * 整批預翻譯：首批縮小且「單獨先送」——與大批並行會被供應商端限流
 * 拖慢，讓首批獨占容量才能保證首句譯文最快出現；首批完成渲染後，
 * 其餘批次才進並發池同時送翻，各批回應到達即渲染（亂序漸進）。
 * 每批的 context 是前一批最後 2 句「原文」，下載字幕時已全部備齊，
 * 批次間無資料依賴，可安全並行；並發上限沿用 settings.concurrency，
 * 與 background 的 semaphore 同一設定值。
 * 任一批失敗即停止派發新批；已完成的譯文保留在畫面上，整包快取不寫入。
 */
async function translateAllCues(
  current: VideoSession,
  settings: Settings,
  cacheKey: string,
  myToken: number,
): Promise<void> {
  const batchSize = Math.max(5, settings.youtubeBatchSize);
  const total = current.cues.length;

  // 切批：首批縮小，每批預先算好 offset 與 context
  const batches: Array<{ offset: number; cues: SubtitleCue[]; context?: string[] }> = [];
  for (let offset = 0; offset < total; ) {
    const size = offset === 0 ? Math.min(FIRST_BATCH_SIZE, batchSize) : batchSize;
    batches.push({
      offset,
      cues: current.cues.slice(offset, offset + size),
      context:
        offset > 0
          ? current.cues.slice(Math.max(0, offset - 2), offset).map((cue) => cue.text)
          : undefined,
    });
    offset += size;
  }

  setProgress(0);
  setStatus(`翻譯中… 0 / ${total} 句`);

  let doneCount = 0;
  let firstError: string | null = null;

  const runBatch = async (batch: (typeof batches)[number]): Promise<void> => {
    let response: TranslateBatchResponse;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        items: batch.cues.map((cue) => cue.text),
        context: batch.context,
      });
    } catch (err) {
      response = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (current.cancelled || current.runToken !== myToken) return;

    if (!response.ok || !response.translations) {
      firstError ??= response.error ?? '未知錯誤';
      return;
    }

    response.translations.forEach((translation, i) => {
      current.translations[batch.offset + i] = translation;
    });
    current.overlay?.setData(current.cues, current.translations);
    doneCount += batch.cues.length;
    setStatus(`翻譯中… ${doneCount} / ${total} 句`);
    setProgress(Math.round((doneCount / total) * 100));
  };

  // 首批單獨先跑，完成（渲染）後其餘批次才開池
  await runBatch(batches[0]);
  if (current.cancelled || current.runToken !== myToken) return;

  if (firstError === null && batches.length > 1) {
    let nextIndex = 1;
    const runWorker = async (): Promise<void> => {
      while (nextIndex < batches.length && firstError === null) {
        if (current.cancelled || current.runToken !== myToken) return;
        await runBatch(batches[nextIndex++]);
      }
    };

    const workerCount = Math.max(1, Math.min(settings.concurrency, batches.length - 1));
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    if (current.cancelled || current.runToken !== myToken) return;
  }

  if (firstError !== null) {
    setStatus(`翻譯失敗：${firstError}`);
    setProgress(null);
    return;
  }

  // 5. 完成：整部影片的譯文寫入快取
  await cacheSetMany({ [cacheKey]: JSON.stringify(current.translations) });
  setProgress(null);
  setStatus('翻譯完成。');
}

function stopSubtitles(): void {
  if (!session) return;
  session.runToken++; // 讓仍在跑的翻譯批次在下一個檢查點中止
  session.overlay?.destroy();
  session.overlay = null;
  setStartButton('開啟雙語字幕');
  setYouTubeButtonState('inactive');
  setProgress(null);
  setStatus('');
}

/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
