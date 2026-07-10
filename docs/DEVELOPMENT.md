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
| window 全域旗標 | `__bt` 前綴 | `__btWebTranslateLoaded` |

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

## 計畫與文件流程（沿用 CLAUDE.md 規則）

0. 想法先上 `docs/BOARD.md` 任務看板（💡 發想／📥 待辦），一行即可，不急著開計畫文件；看板使用約定（含編號規則）收納於該檔末段。
1. 決定開工後在 `docs/plans/` 建 `YYYY-MM-DD-<feature>.md`（User Story → Spec → Tasks），看板項目移到 🚧 進行中並回填計畫連結。
2. 實作類 task 連續執行到底，做到「文件同步與收尾」task 前停下，請使用者到 `chrome://extensions` 手動驗收，通過後才收尾。例外：必須先由使用者驗收或回報結果才能繼續的 task（如依賴外部頁面結構的 spike、需真實 API key 的驗證），在建計畫時就判斷並於 Tasks 標註建議停點。
3. 完成後：計畫文件移至 `docs/plans/archive/`，看板項目移入 ✅ 已完成摺疊區（加日期），並做文件同步檢查——行為變更 → FEATURES.md；新增 message／storage key／Provider → ARCHITECTURE.md；一律 → CHANGELOG.md。

## 硬性約束（改動前必讀）

- REQUIREMENTS.md 0-A 節：無後端、無遠端程式碼（eval／遠端 script 禁用）、權限最小化、YouTube 字幕只在使用者 session 內取得。
- 四環境間通訊只走 chrome.runtime message，訊息型別一律先定義於 `shared/messages.ts`。
- content script 禁用框架；`crypto.subtle`（cache.ts）只能在 SW 與 https 頁面使用。
