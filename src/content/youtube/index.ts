/**
 * YouTube 雙語字幕 content script（功能二的進入點）。
 *
 * - 在播放器工具列注入「雙語字幕」按鈕，點擊開關控制面板
 * - 面板可選擇來源字幕語言、開啟／關閉雙語字幕、顯示翻譯進度
 * - 整批預翻譯：取得完整字幕後分批送翻（每批帶前一批最後 2 句作為上下文）
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

/* ------------------------------------------------------------------ */
/* 初始化                                                               */
/* ------------------------------------------------------------------ */

init();

function init(): void {
  // 進入 watch 頁（或換片）時重建狀態；離開 watch 頁時清理
  watchNavigation((videoId) => {
    teardownSession();
    if (videoId) setupForVideo(videoId);
  });

  const initialVideoId = getCurrentVideoId();
  if (initialVideoId) setupForVideo(initialVideoId);

  // 使用者調整樣式時，即時套用到字幕層
  onSettingsChanged((settings) => {
    session?.overlay?.applyStyle(settings.style);
  });
}

/** 清掉舊影片的一切：字幕層、面板狀態、進行中的翻譯 */
function teardownSession(): void {
  if (!session) return;
  session.cancelled = true;
  session.overlay?.destroy();
  session = null;
  updatePanelForNewVideo();
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
  const button = document.createElement('button');
  button.className = 'ytp-button bt-yt-button';
  button.title = '雙語字幕';
  button.textContent = '譯';
  button.style.cssText = 'font-size: 16px; font-weight: 700; vertical-align: top;';
  button.addEventListener('click', () => togglePanel());
  return button;
}

/** 開關控制面板；第一次開啟時建立 DOM 並載入字幕軌清單 */
function togglePanel(): void {
  if (panel && panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }
  if (!panel) {
    panel = createPanel();
    document.querySelector('#movie_player')?.appendChild(panel);
  }
  panel.style.display = 'block';
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

  // 1. 下載字幕
  setStatus('下載字幕中…');
  try {
    current.cues = await fetchCues(track);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    setStartButton('開啟雙語字幕');
    return;
  }
  if (current.cancelled || current.runToken !== myToken) return;

  if (current.cues.length === 0) {
    setStatus('這條字幕軌沒有內容。');
    setStartButton('開啟雙語字幕');
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

/**
 * 整批預翻譯：依設定的批次大小切割字幕，逐批送翻並更新進度。
 * 每批附上前一批最後 2 句原文作為 context；批次採循序執行以維持上下文鏈。
 */
async function translateAllCues(
  current: VideoSession,
  settings: Settings,
  cacheKey: string,
  myToken: number,
): Promise<void> {
  const batchSize = Math.max(5, settings.youtubeBatchSize);
  const total = current.cues.length;
  setProgress(0);

  for (let offset = 0; offset < total; offset += batchSize) {
    if (current.cancelled || current.runToken !== myToken) return;

    const batchCues = current.cues.slice(offset, offset + batchSize);
    const context =
      offset > 0
        ? current.cues.slice(Math.max(0, offset - 2), offset).map((cue) => cue.text)
        : undefined;

    setStatus(`翻譯中… ${Math.min(offset + batchSize, total)} / ${total} 句`);

    let response: TranslateBatchResponse;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        items: batchCues.map((cue) => cue.text),
        context,
      });
    } catch (err) {
      response = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (current.cancelled || current.runToken !== myToken) return;

    if (!response.ok || !response.translations) {
      setStatus(`翻譯失敗：${response.error ?? '未知錯誤'}`);
      setProgress(null);
      return;
    }

    response.translations.forEach((translation, i) => {
      current.translations[offset + i] = translation;
    });
    current.overlay?.setData(current.cues, current.translations);
    setProgress(Math.round(((offset + batchCues.length) / total) * 100));
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
  setProgress(null);
  setStatus('');
}

/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
