# DEVELOPMENT

## 環境需求與指令

- Node.js（含 npm）；依賴僅 devDependencies：Vite 7 + @crxjs/vite-plugin 2 + TypeScript 5。
- `npm run dev` — CRXJS watch 建置到 `dist/`，於 `chrome://extensions`（開發人員模式）「載入未封裝項目」選 `dist/`。
- `npm run build` — 產生圖示 → `tsc --noEmit` 型別檢查 → 正式建置（**build 內含 typecheck**，型別錯誤會擋下建置）。
- `npm run typecheck` / `npm run icons` — 單獨執行型別檢查／圖示產生。
- 建置刻意關閉 minify（vite.config.ts），方便除錯與上架審核檢視。
- 測試指令尚未建立（規劃見 TESTING.md）。

## 命名規則

| 對象 | 規則 | 例 |
|---|---|---|
| 注入宿主頁面的 class | `bt-` 前綴（content script 禁用全域樣式，一律 scoped class） | `bt-yt-panel`、`bt-subtitle-overlay` |
| 注入宿主頁面的 data 屬性 | `data-bt-*` | `data-bt-translation`（= `TRANSLATION_ATTR`，勿手寫字串，從 `shared/styles.ts` import） |
| 訊息 type | UPPER_SNAKE，動詞開頭；集中定義於 `shared/messages.ts` | `TRANSLATE_BATCH` |
| storage key | sync：camelCase 名詞；local 快取：`btcache:` 前綴 + hash | `customExperts`、`btcache:<hex>` |
| 自訂專家 id | `custom-<timestamp>`（內建專家為語意 id，如 `general`） | `custom-1720000000000` |
| window 全域旗標 | `__bt` 前綴 | `__btWebTranslateLoaded`、`__btClaudeInjectLoaded` |
| 右鍵選單項目 id | `bt-assistant-` 前綴 + `AssistantAction` | `bt-assistant-summarize-page` |

## 新增內建 AI 專家模板

1. 在 `src/shared/experts.ts` 的 `BUILTIN_EXPERTS` 加一筆：語意化 `id`、中文 `name`、`builtin: true`。
2. systemPrompt 用英文撰寫，可用 `{{source_lang}}`、`{{target_lang}}` 變數；結尾務必要求「Output only the translation itself」（批次 JSON 協定依賴模型不加說明文字）。
3. 不需改 UI —— popup 與 options 的專家清單都從 `BUILTIN_EXPERTS` 動態產生。

自訂專家由使用者在 options 頁新增，存 `chrome.storage.sync` 的 `customExperts`，無需開發者介入。

## 新增譯文樣式預設集

1. `src/shared/types.ts`：`StylePresetId` union 加新 id。
2. `src/shared/styles.ts`：`PRESET_RULES` 加對應 CSS 宣告（**只描述外觀差異**；`display:block` 等版面規則由 `buildTranslationCss` 統一處理，別重複）。宣告需帶 `!important` 對抗宿主頁 CSS。
3. `src/options/index.html`：`#style-preset` select 加 `<option>`。
4. 不需改 content script —— 樣式切換透過 `onSettingsChanged` 重建 `<style>` 內容即時生效。

## 新增 AI Provider

1. `src/shared/types.ts`：`ProviderId` union 加新 id；`Settings` 加對應的 `ProviderSettings` 欄位。
2. `src/shared/settings.ts`：`DEFAULT_SETTINGS` 補預設值；`loadSettings()` 的深合併補上新欄位的 spread（漏了會讓舊用戶缺欄位）。
3. 建 `src/providers/<id>.ts`：實作 `TranslationProvider`（只需 `chat()`：fetch + JSON、不用 SDK；失敗 throw 帶可讀中文訊息的 Error）。批次 prompt 組裝與解析在 `base.ts`，**不要**在 Provider 內處理。
4. `src/providers/index.ts`：`PROVIDERS` 註冊表加一筆。
5. `manifest.config.ts`：`host_permissions` 加 API endpoint（缺了 SW 的 fetch 會被擋；權限註解要寫用途，上架審核用）。
6. `src/options/index.html` + `options.ts`：翻譯服務分頁加 key／model 欄位與事件；`#provider` select 加選項；測試連線的欄位對應要補。
7. `src/popup/index.html`：`#provider` select 加選項。
8. 完成後更新 ARCHITECTURE.md 第 4 節與本檔。

## 新增 Claude 助手右鍵動作

1. `src/shared/assistant-prompts.ts`：`AssistantAction` union 加新 id；`ASSISTANT_ACTIONS` 插入（**順序即右鍵選單與 options 分頁的順序**）；`ASSISTANT_ACTION_LABELS`、`DEFAULT_ASSISTANT_PROMPTS`（必含 `{{content}}`，指示句用正體中文）、`ASSISTANT_AUTO_SUBMIT` 各補一筆。
2. `src/background/service-worker.ts`：`registerAssistantMenus` 的 `contextsOf` 補該動作的 contexts（型別為 `Record<AssistantAction, …>`，漏了 typecheck 會擋）。
3. 其餘免改——右鍵選單與 options「Claude 助手」分頁的模板卡都從 `ASSISTANT_ACTIONS` 動態產生。
4. 若動作需要中文判斷（翻譯類）或頁面擷取（整頁類），在 `handleAssistantAction` 對應分支接線。

隔離慣例提醒：所有依賴 claude.ai 未公開 DOM 的邏輯一律放 `src/content/claude-inject/index.ts`（同 `subtitle-provider.ts` 之於 YouTube），新動作不應引入新的 claude.ai DOM 依賴。

## 計畫與文件流程（沿用 CLAUDE.md 規則）

0. 想法先上 `docs/任務看板.md`（💡 發想／📥 待辦），一行即可，不急著開計畫文件；看板使用約定（含編號規則）收納於該檔末段。
1. 決定開工後在 `docs/plans/` 建 `YYYY-MM-DD-<中文描述>.md`（User Story → Spec → Tasks），看板項目移到 🚧 進行中並回填計畫連結。
2. 實作類 task 連續執行到底，做到「文件同步與收尾」task 前停下，請使用者到 `chrome://extensions` 手動驗收，通過後才收尾。例外：必須先由使用者驗收或回報結果才能繼續的 task（如依賴外部頁面結構的 spike、需真實 API key 的驗證），在建計畫時就判斷並於 Tasks 標註建議停點。
3. 完成後：計畫文件移至 `docs/plans/archive/`，看板項目移入 ✅ 已完成摺疊區（加日期），並做文件同步檢查——行為變更 → FEATURES.md；新增 message／storage key／Provider → ARCHITECTURE.md；一律 → CHANGELOG.md。

## Spike 驗證方法（依賴未公開結構的前置驗證）

功能若立足於外部服務的未公開結構（claude.ai 的 DOM／URL 參數、YouTube 頁面結構），實作前先做 Task 0 式 spike：結論回填計畫文件的 Spec，原始腳本與執行紀錄收計畫附錄（供改版時重跑比對）。既有紀錄：

- claude.ai 注入行為（輸入框／送出鈕／`?q=`／未登入）：[plans/archive/2026-07-10-context-menu-claude-actions.md](../plans/archive/2026-07-10-context-menu-claude-actions.md) 附錄
- claude.ai 模型切換（`?model=` slug／DOM 選單結構／**持久性語意**）：[plans/archive/2026-07-11-assistant-model-select.md](../plans/archive/2026-07-11-assistant-model-select.md) §2.1＋附錄（含驗收後修正：claude.ai 以上次使用模型為新對話預設）

### 自動化執行（2026-07-11 由 #6 spike 建立的做法）

需要登入態的 spike 可請 Claude Code 以 Playwright（CDP）驅動真實 Chrome 自動執行，取代人工在 DevTools Console 逐段貼腳本：

1. 以**拋棄式 profile 另起獨立 Chrome 實例**（不動使用者工作中的瀏覽器；偵錯參數只在程序啟動時生效，無法接管已開啟的 Chrome）：
   `chrome.exe --user-data-dir=<暫存目錄> --remote-debugging-port=9223 <目標網址>`
2. 使用者在該視窗**登入一次**目標服務（登入態存在拋棄式 profile 裡，用完即棄）。
3. 暫存目錄 `npm i playwright-core`（不進專案依賴），`chromium.connectOverCDP('http://localhost:9223')` 取得 context，以 `page.evaluate` 執行驗證邏輯、`page.screenshot` 留證（需人工判讀的畫面交使用者確認）。
4. 關鍵結論用**行為實測**而非推測：例如「切換是否污染帳號預設」以另開乾淨分頁讀取實際狀態驗證。
5. 收尾原則：**還原被改動的帳號狀態**（#6 spike 中 DOM 切換模型會改帳號預設，結束時切回原值並驗證）；主動告知測試留下的痕跡（如測試對話）供使用者刪除。

注意：程式化操作目標服務與功能本身同屬 ToS 灰色地帶（本機自用、風險等級同功能）；此法僅用於開發期驗證，不進產品程式碼。

## 硬性約束（改動前必讀）

- REQUIREMENTS.md 0-A 節：無後端、無遠端程式碼（eval／遠端 script 禁用）、權限最小化、YouTube 字幕只在使用者 session 內取得。
- 四環境間通訊只走 chrome.runtime message，訊息型別一律先定義於 `shared/messages.ts`。
- content script 禁用框架；`crypto.subtle`（cache.ts）只能在 SW 與 https 頁面使用。
