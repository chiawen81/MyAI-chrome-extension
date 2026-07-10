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

### Claude 助手純函式（`src/shared/assistant-prompts.ts`）

| 對象 | 測試重點 |
|---|---|
| `isMostlyChinese` | 純英文 → false；純中文 → true；中英混合恰在 50% 邊界；空字串／純空白 → false；空白字元不計入分母 |
| `truncateForHandoff` | 未超限原樣回傳；超限保留開頭＋文末截斷註記；恰等於上限不截 |
| `buildHandoffText` | 變數代入（content／page_url／page_title／target_lang_label）；content 超過 maxChars 被截斷但模板尾巴（如「我的問題：」）保留；maxChars 低於下限 500 時以 500 計 |
| `buildFallbackUrl` | 輸出 `https://claude.ai/new?q=` 前綴；內容經 encodeURIComponent（換行 → `%0A`）；超過 2,000 字元備援上限再截 |
| `validateAssistantTemplate` | 缺 `{{content}}` → 錯誤訊息；超過 500 字元 → 錯誤訊息；合法 → null |

另：`extractPageContent`（`src/content/page-extract.ts`，需 DOM 環境）——語意容器命中（article ≥ 500 字）；容器內排除 nav/aside/推薦連結；過濾後過短退回容器全文；無語意容器時共同祖先啟發式；全空時 body.innerText 回退。注意 jsdom/happy-dom 的 `innerText`／`checkVisibility` 支援不全需 stub；且函式必須維持自包含（測試可順便驗 `toString()` 不含 import 引用）。

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

### 2.6 右鍵選單 Claude 助手

前置：已登入 claude.ai。

- [ ] http/https 頁面右鍵可見選單（空白處僅「摘要此頁」；有選取時五項皆有）；`chrome://` 頁不顯示
- [ ] 摘要此頁：新聞文章頁 → 新分頁 claude.ai 自動填入「指示＋標題＋網址＋擷取內文」並**自動送出**；擷取內容為文章主體，導覽列／頁尾／推薦連結雜訊少（2–3 個不同版型交叉驗證）
- [ ] 摘要此頁：登入牆內的頁面也能擷取貼入（不依賴 claude.ai 讀網址）
- [ ] 摘要選取文字：選取段落 → 自動送出、以目標語言摘要該段
- [ ] 帶入選取文字：輸入框填入引文與「我的問題：」結尾，**未自動送出**；接著輸入問題送出後回答針對引文
- [ ] 翻譯：選取英文段落 → 自動送出後得到正體中文譯文
- [ ] 翻譯／翻譯＋摘要：選取中文段落 → 原頁跳「已是中文」確認框；取消不開分頁，確認照常執行
- [ ] 翻譯＋摘要：選取英文長段 → 回應同時含完整翻譯與條列摘要兩節
- [ ] 長內容：> `assistantMaxChars` 時被截斷且末尾有「（內容過長，已截斷）」註記；「Claude 助手」分頁調整上限後立即生效
- [ ] 目標語言切換（如改日文）後「摘要此頁／摘要選取文字」指示句對應更新；翻譯類仍固定正體中文（預設模板）
- [ ] 自訂模板：修改模板後右鍵動作反映自訂內容；「還原預設」／清空後回到預設；缺 `{{content}}` 或超過 500 字元 → alert 擋下不寫入
- [ ] 換行、引號、emoji 內容填入後不亂碼、格式合理
- [ ] 備援模擬：暫時把 claude-inject 的輸入框選擇器改壞 → 逾時後以 `?q=` 開頁（截斷版），不產生未捕捉錯誤
- [ ] 未登入 claude.ai 時觸發：導向登入頁、帶入內容不保留（已知限制）
- [ ] 既有功能迴歸：整頁雙語翻譯、YouTube 字幕、popup、options 行為不變
