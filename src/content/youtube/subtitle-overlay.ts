/**
 * 自繪雙語字幕層。
 *
 * 在播放器內以 absolute 定位覆蓋一個字幕容器，
 * 依 video 的播放進度（timeupdate 事件）切換目前該顯示的字幕句，
 * 以「原文在上、譯文在下」的雙行格式呈現。
 *
 * 啟用期間會替播放器加上 bt-subtitles-active class，
 * 搭配注入的 CSS 隱藏 YouTube 原生字幕，避免兩層字幕重疊。
 */
import type { StyleSettings } from '../../shared/types';
import type { SubtitleCue } from './subtitle-provider';

/** 隱藏原生字幕 + 字幕層外觀的 CSS（只在 overlay 啟用時生效） */
const OVERLAY_CSS = `
  #movie_player.bt-subtitles-active .ytp-caption-window-container {
    display: none !important;
  }
  .bt-subtitle-overlay {
    position: absolute;
    left: 50%;
    bottom: 10%;
    transform: translateX(-50%);
    max-width: 85%;
    padding: 6px 14px;
    border-radius: 6px;
    text-align: center;
    pointer-events: none;
    z-index: 60;
    line-height: 1.45;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  }
  .bt-subtitle-overlay .bt-original {
    display: block;
    color: #ffffff;
  }
  .bt-subtitle-overlay .bt-translated {
    display: block;
  }
`;

export class SubtitleOverlay {
  private player: HTMLElement;
  private video: HTMLVideoElement;
  private container: HTMLDivElement;
  private styleElement: HTMLStyleElement;
  private resizeObserver: ResizeObserver;

  /** 依時間排序的字幕句 */
  private cues: SubtitleCue[] = [];
  /** 與 cues 等長的譯文陣列（尚未翻譯到的句子為空字串，屆時只顯示原文） */
  private translations: string[] = [];
  /** 目前顯示中的字幕索引，用來避免重複渲染 */
  private currentIndex = -1;

  constructor(player: HTMLElement, video: HTMLVideoElement, style: StyleSettings) {
    this.player = player;
    this.video = video;

    // 注入字幕層樣式
    this.styleElement = document.createElement('style');
    this.styleElement.textContent = OVERLAY_CSS;
    document.documentElement.appendChild(this.styleElement);

    // 建立字幕容器
    this.container = document.createElement('div');
    this.container.className = 'bt-subtitle-overlay';
    this.container.style.display = 'none';
    player.appendChild(this.container);
    player.classList.add('bt-subtitles-active');

    this.applyStyle(style);

    // 字級隨播放器尺寸縮放（全螢幕時字幕自動變大）
    this.resizeObserver = new ResizeObserver(() => this.updateFontSize());
    this.resizeObserver.observe(player);
    this.updateFontSize();

    // timeupdate 約每 250ms 觸發一次，對 <0.5 秒的同步要求已足夠
    this.video.addEventListener('timeupdate', this.onTimeUpdate);
    this.video.addEventListener('seeking', this.onTimeUpdate);
  }

  /** 設定字幕資料；翻譯是逐批完成的，可重複呼叫來更新譯文 */
  setData(cues: SubtitleCue[], translations: string[]): void {
    this.cues = cues;
    this.translations = translations;
    this.currentIndex = -1; // 強制下一次 timeupdate 重新渲染
    this.onTimeUpdate();
  }

  /** 套用使用者的字幕外觀設定（沿用功能一的樣式設定） */
  applyStyle(style: StyleSettings): void {
    this.container.style.backgroundColor = style.backgroundColor || 'rgba(0, 0, 0, 0.6)';
    this.container.style.fontFamily = style.fontFamily || 'inherit';

    // 譯文行的顏色可自訂；原文行固定白色（見 OVERLAY_CSS）
    this.container.style.setProperty('--bt-translated-color', style.textColor || '#a5d8ff');
    // 字級百分比作用於整個字幕容器
    this.container.dataset.fontScale = String(style.fontSizePercent / 100);
    this.updateFontSize();
  }

  /** 依播放器高度計算基礎字級，再乘上使用者設定的百分比 */
  private updateFontSize(): void {
    const scale = parseFloat(this.container.dataset.fontScale ?? '1');
    const base = Math.max(14, this.player.clientHeight * 0.042);
    this.container.style.fontSize = `${Math.round(base * scale)}px`;
  }

  /** 播放進度變化 → 找出目前時間對應的字幕句並渲染 */
  private onTimeUpdate = (): void => {
    const index = this.findCueIndex(this.video.currentTime);
    if (index === this.currentIndex) return;
    this.currentIndex = index;

    if (index === -1) {
      this.container.style.display = 'none';
      return;
    }

    // 原文在上、譯文在下
    this.container.textContent = '';
    const original = document.createElement('span');
    original.className = 'bt-original';
    original.textContent = this.cues[index].text;
    this.container.appendChild(original);

    const translated = this.translations[index];
    if (translated) {
      const line = document.createElement('span');
      line.className = 'bt-translated';
      line.style.color = 'var(--bt-translated-color)';
      line.textContent = translated;
      this.container.appendChild(line);
    }
    this.container.style.display = 'block';
  };

  /** 二分搜尋：找出涵蓋指定時間點的字幕句索引；沒有則回傳 -1 */
  private findCueIndex(time: number): number {
    let low = 0;
    let high = this.cues.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const cue = this.cues[mid];
      if (time < cue.start) {
        high = mid - 1;
      } else if (time >= cue.end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  /** 銷毀字幕層：移除 DOM、還原原生字幕、解除所有監聽（換片時必須呼叫，避免殘留） */
  destroy(): void {
    this.video.removeEventListener('timeupdate', this.onTimeUpdate);
    this.video.removeEventListener('seeking', this.onTimeUpdate);
    this.resizeObserver.disconnect();
    this.container.remove();
    this.styleElement.remove();
    this.player.classList.remove('bt-subtitles-active');
  }
}
