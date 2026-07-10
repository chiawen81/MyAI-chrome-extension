/// <reference types="vite/client" />

// CRXJS 的「?script」匯入語法：
// 在 background 內 `import path from './xxx.ts?script'` 會取得該 content script
// 打包後的檔案路徑，可直接交給 chrome.scripting.executeScript({ files: [path] }) 動態注入。
declare module '*?script' {
  const src: string;
  export default src;
}
