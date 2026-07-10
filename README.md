# 雙語對照翻譯 Chrome 外掛

依 [REQUIREMENTS.md](./REQUIREMENTS.md) 實作的 MV3 外掛：

- **功能一：網頁雙語翻譯** — 點擊圖示或按 `Alt+T`，掃描視口內的段落、把 AI 譯文插在原文下方（垂直雙語對照）；再按一次即還原原文、無殘留。
- **功能二：YouTube 雙語字幕** — 播放器工具列的「譯」按鈕開啟面板，選擇來源字幕後整批預翻譯，以「原文在上、譯文在下」自繪字幕層呈現，並正確處理 SPA 換片。

翻譯引擎採 BYOK（自帶 API key），支援 Anthropic Claude 與 OpenAI；key 僅存於 `chrome.storage`，直連官方 API，不經任何第三方伺服器。

## 開發環境

- Node.js 20+（開發時使用 22）
- 打包：Vite 7 + [@crxjs/vite-plugin](https://crxjs.dev/) 2.7
- 版本相容性驗證結果（需求文件的 ⚠️ 事項）：CRXJS 2.7.1 宣稱支援 Vite 3–8，
  但實測 Vite 8（rolldown 核心）建置 content script 會失敗
  （`Content script fileName is undefined`），Vite 7（rollup 核心）正常，故鎖定 Vite 7。

## 建置與載入

```bash
npm install
npm run build     # = 產生 icon → tsc 型別檢查 → vite build，輸出到 dist/
```

載入未封裝擴充功能：

1. 開啟 `chrome://extensions`
2. 開啟右上角「開發人員模式」
3. 點「載入未封裝項目」，選擇專案的 `dist/` 資料夾

開發模式（HMR）：`npm run dev`，同樣載入 `dist/`。

## 首次設定

1. 點外掛圖示 → 「開啟設定」→「翻譯服務」分頁
2. 選擇供應商、填入 API key 與模型名稱（模型欄位是自由輸入，例如
   `claude-opus-4-8`、`claude-haiku-4-5`、`gpt-4o-mini`）
3. 按「測試連線」確認可用

> 翻譯量大時建議選用較經濟的模型（例如 Claude 可填 `claude-haiku-4-5`）。

## 專案結構

```
manifest.config.ts                  # MV3 manifest（含各權限用途說明）
src/
  background/service-worker.ts      # API 請求代理、快取、並發控制、快捷鍵
  content/
    web-translate/                  # 功能一
      scanner.ts                    #   段落掃描 + IntersectionObserver 惰性翻譯
      renderer.ts                   #   譯文節點插入/移除
      index.ts                      #   toggle 狀態機、批次送翻、樣式即時套用
    youtube/                        # 功能二
      subtitle-provider.ts          #   字幕軌取得（隔離模組，YouTube 改版時改這裡）
      subtitle-overlay.ts           #   自繪雙語字幕層
      navigation.ts                 #   SPA 換片偵測（yt-navigate-finish + URL 輪詢雙保險）
      index.ts                      #   播放器按鈕、控制面板、整批預翻譯
  providers/                        # AI 供應商抽象層
    base.ts                         #   介面 + 批次 prompt 組裝 / JSON 對齊解析
    claude.ts / openai.ts           #   各家 REST API 實作
  popup/                            # 快捷面板（翻譯/還原、語言/供應商/專家快速切換）
  options/                          # 設定頁（翻譯服務 / 樣式 / AI 專家 / 進階）
  shared/                           # 設定、AI 專家模板、樣式產生、快取、語言清單
scripts/gen-icons.mjs               # 以純 Node 產生 PNG icon
```

## 設計重點

- **權限最小化**：功能一的 content script 不在 manifest 靜態宣告，而是使用者觸發時
  由 background 以 `activeTab` + `scripting` 動態注入；只有 YouTube 使用靜態注入。
- **批次翻譯與對齊 fallback**：多段原文以 JSON 陣列送出、要求模型回等長陣列；
  解析失敗或長度不符時自動退回逐段重試（`providers/base.ts` + `service-worker.ts`）。
- **快取**：`hash(原文+供應商+模型+專家+目標語言)` → `chrome.storage.local`；
  YouTube 另以整部影片為單位快取。設定頁可查看筆數並清除。
- **樣式即時生效**：譯文節點只帶 `data-bt-translation` 屬性，外觀完全由注入的
  `<style>` 決定；改樣式只替換 CSS，不需重新翻譯。
- **換片無殘留**：`navigation.ts` 以 `yt-navigate-finish` 事件＋ URL 輪詢雙保險偵測換片，
  換片即銷毀字幕層、讓進行中的翻譯批次在下一個檢查點自行中止。

## 已知限制與待驗證事項

- **YouTube 字幕取得**（`subtitle-provider.ts`）依賴 YouTube 未公開的頁面結構
  （`ytInitialPlayerResponse` 與 timedtext 端點），YouTube 不定期改版可能導致失效；
  所有相關邏輯已隔離在該模組，失效時只需修補這一個檔案。
  發佈前請務必實際開啟數部影片（含自動產生字幕）驗證。
- **chrome.storage.sync 限制**：單一項目上限 8KB。自訂 AI 專家的 prompt 過長時
  會儲存失敗並跳出提示。
- 部分頁面（`chrome://`、Chrome 線上應用程式商店、部分 CSP 嚴格站點）無法注入
  content script，popup 會顯示「此頁面無法翻譯」。

## 上架 Chrome Web Store 注意事項

- 隱私欄位「Remote Code」選 **No**（本外掛不執行遠端程式碼）。
- 需提供隱私權政策：說明 API key 僅存於本機/同步儲存空間、頁面文字僅為翻譯目的
  送往使用者自行設定的 AI 服務（Anthropic / OpenAI）。
- 每個權限的用途已註解於 `manifest.config.ts`，可直接作為審核申報依據。
- 建議依需求文件的規劃分兩階段送審：先上架功能一，再更新加入 YouTube 功能。
