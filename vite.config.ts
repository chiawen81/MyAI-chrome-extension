import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// CRXJS 會依據 manifest 自動找到所有進入點（background、content scripts、popup、options），
// 並處理 MV3 的打包細節（content script 需為自包含檔案、web_accessible_resources 等）。
export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    // 產出可讀性較高的檔名，方便除錯與上架審核時檢視
    minify: false,
  },
});
