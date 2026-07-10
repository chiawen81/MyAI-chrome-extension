# TESTING

測試框架尚未導入。規劃採 vitest（單元測試）＋ chrome://extensions 手動驗收。導入 vitest 後把指令補進 CLAUDE.md 與本檔。

## 1. vitest 單元測試範圍（規劃）

優先測「純函式、與 chrome API 無關」的邏輯。DOM 相關用 happy-dom / jsdom 環境。

### 批次對齊與 fallback（`src/providers/base.ts`）— 最高優先

| 對象 | 測試重點 |
|---|---|
| `parseBatchResult` | 正常 JSON 陣列；帶 code fence／前後說明文字（擷取最外層 `[...]`）；長度不符 → `null`；非 JSON → `null`；非陣列 → `null`；元素非字串時 `String()` 轉型 |
| `buildBatchUserPrompt` | 輸出含正確元素數量宣告；context 有無兩種情況；items 以合法 JSON 內嵌 |
| `buildSingleUserPrompt` | 原文完整帶入、指示不含 JSON 協定 |

背景邏輯 `splitIntoBatches`（3000 字元／30 段雙上限、保留原始索引）目前是 service-worker.ts 的模組私有函式，**需先 export 才能測**；單段超長（>3000 字）應獨立成一批而非被丟棄。

### 快取 hash（`src/shared/cache.ts`）

| 對象 | 測試重點 |
|---|---|
| `makeCacheKey` | 相同輸入 → 相同 key（determinism）；任一段不同 → 不同 key；分隔符防撞（`['ab','c']` ≠ `['a','bc']`）；輸出格式 `btcache:` + 64 位 hex |

Node 20+ 的 `globalThis.crypto.subtle` 可直接跑，不需 mock。`cacheGetMany`/`cacheSetMany` 等依賴 `chrome.storage`，需 mock chrome，優先度低。

### 掃描器（`src/content/web-translate/scanner.ts`）— 需 DOM 環境

| 對象 | 測試重點 |
|---|---|
| `extractText` | 空白正規化；**排除已插入的 `data-bt-translation` 譯文節點**（否則重掃會把譯文送去翻譯） |
| `Scanner`（isTranslatable，私有 → 經由 scan 行為間接測，或 export） | 排除 `pre/code/contenteditable` 內元素；巢狀段落只取最內層；純數字／符號段落跳過；譯文節點自身跳過 |

注意：jsdom/happy-dom 對 `IntersectionObserver`、`checkVisibility` 支援不全，需 stub。

### 其他值得覆蓋的純函式

- `renderTemplate` / `findExpert`（`shared/experts.ts`）：變數代入、多次出現、找不到 id 退回「通用」。
- `extractPlayerResponseJson`（`subtitle-provider.ts`，私有需 export）：括號配對含字串內大括號與跳脫字元的案例——這是 YouTube 改版時最先壞的地方，測試可快速定位。
- `parseJson3` / `parseTimedTextXml`（同上，私有）：`aAppend=1` 跳過、缺 `dDurationMs` 預設 2 秒、XML fallback。
- `SubtitleOverlay.findCueIndex` 的二分搜尋（私有）：邊界時間、間隙回 -1。
- `buildTranslationCss`（`shared/styles.ts`）：自訂值產生對應宣告、100% 字級不輸出。

## 2. chrome://extensions 手動驗收清單

前置：`npm run build`（或 `npm run dev`）→ `chrome://extensions` 開發人員模式 → 載入未封裝項目選 `dist/`。設定頁填入有效 API key 並「測試連線」成功。

### 2.1 網頁雙語翻譯

- [ ] 開 BBC 等新聞網站 → 點外掛圖示 →「翻譯此頁」：首屏段落逐批出現譯文（先「翻譯中…」佔位）
- [ ] 往下捲動：新進入視口的段落自動翻譯（惰性翻譯生效）
- [ ] 再按「還原原文」：譯文全部消失、原文無任何改動與殘留（檢查 DevTools 無 `data-bt-translation` 節點、無 `#bt-translation-style`）
- [ ] Alt+T 快捷鍵可完成同樣的翻譯／還原
- [ ] 重新翻譯同一頁：明顯變快且無 API 扣費（快取命中；可在設定頁看快取筆數增加後不再增加）
- [ ] 程式碼區塊（`pre/code`）內文字未被翻譯
- [ ] 在 `chrome://extensions` 頁按翻譯：popup 顯示「此頁面無法翻譯」，不報未捕捉錯誤
- [ ] 未設 API key 時翻譯：段落佔位消失、右下角 toast 顯示「尚未設定 API key…」
- [ ] 設定頁調低字數上限（1000）後翻譯長頁面：達上限出現 toast、停止翻譯

### 2.2 樣式

- [ ] 翻譯狀態下到設定頁切換 4 種預設樣式：已翻譯的譯文**即時**變化，無需重翻
- [ ] 進階自訂（文字色／背景色／字級 %／字型）逐項調整：設定頁預覽與頁面譯文同步反映
- [ ] 樣式設定跨頁面生效（另開新網頁翻譯，樣式一致）

### 2.3 AI 專家

- [ ] 設定頁新增自訂專家（如「翻成文言文」的 prompt）→ popup 可選到（標「自訂」）
- [ ] 清除快取 → 切換到自訂專家 → 重翻同一頁：譯文風格明顯反映模板差異
- [ ] 刪除使用中的自訂專家：設定自動退回「通用」，翻譯仍正常

### 2.4 YouTube 雙語字幕

- [ ] 開有字幕的影片：播放器右下工具列出現「譯」按鈕
- [ ] 點按鈕 → 面板列出字幕軌（自動產生的有標註）→ 開啟雙語字幕：進度條前進、字幕漸進補上譯文
- [ ] 播放中字幕雙行顯示（原文上、譯文下）、與語音同步誤差 < 0.5s、拖動進度條後立即跟上
- [ ] YouTube 原生字幕（CC）不與自繪字幕重疊
- [ ] 全螢幕：字幕字級自動放大
- [ ] **連續切換 3 部影片**（點推薦影片，不重新整理）：每部字幕軌清單正確更新、舊字幕不殘留（驗收重點）
- [ ] 關閉雙語字幕：overlay 消失、原生字幕恢復可用
- [ ] 重開同一部影片的雙語字幕：狀態列顯示「已從快取載入譯文」，不重新翻譯
- [ ] 無字幕的影片：面板顯示「此影片沒有可用的字幕軌」

### 2.5 設定與資料

- [ ] 兩個 Provider 各自的 key／模型欄位分開保存；「測試連線」用的是表單當下值（改了不存也能測）
- [ ] 填錯 key 測試連線：顯示 API 回傳的錯誤訊息
- [ ] 清除快取後快取筆數歸 0；重翻頁面會重新請求 API
- [ ] DevTools → Application → Extension storage：確認 API key 只存在 `chrome.storage.sync`；Network 面板確認請求只發往 api.anthropic.com / api.openai.com / youtube.com
