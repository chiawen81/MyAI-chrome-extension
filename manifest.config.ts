import { defineManifest } from '@crxjs/vite-plugin';

/**
 * Chrome 外掛 Manifest (V3)
 *
 * 權限說明（上架審核時每個權限都必須對應到具體功能）：
 * - storage:    儲存使用者設定（chrome.storage.sync）與翻譯快取（chrome.storage.local）
 * - activeTab:  使用者點擊圖示或按快捷鍵時，取得目前分頁的暫時性存取權
 * - scripting:  搭配 activeTab，把「網頁雙語翻譯」的 content script 動態注入目前分頁
 *               （因此不需要 <all_urls> 這種過寬的 host 權限）
 *
 * host_permissions 說明：
 * - api.anthropic.com / api.openai.com: 由 background 直接呼叫 AI 翻譯 API（BYOK），
 *   在 service worker 內 fetch 需要 host 權限才能跨網域
 * - youtube.com: YouTube 雙語字幕功能的 content script 注入範圍
 */
export default defineManifest({
  manifest_version: 3,
  name: '雙語對照翻譯',
  version: '0.1.0',
  description: '用你自己的 AI API key（Claude / OpenAI）為網頁產生雙語對照翻譯，並支援 YouTube 雙語字幕。',
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: '雙語對照翻譯',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
    },
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: ['storage', 'activeTab', 'scripting'],
  host_permissions: [
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
    '*://*.youtube.com/*',
  ],
  // YouTube 需要在進入頁面時就注入（要監聽 SPA 換片事件），因此採靜態宣告；
  // 一般網頁翻譯則走 activeTab + scripting 動態注入，避免申請過寬權限。
  content_scripts: [
    {
      matches: ['*://*.youtube.com/*'],
      js: ['src/content/youtube/index.ts'],
      run_at: 'document_idle',
    },
  ],
  commands: {
    'toggle-translate': {
      suggested_key: { default: 'Alt+T' },
      description: '翻譯／還原目前頁面',
    },
  },
});
