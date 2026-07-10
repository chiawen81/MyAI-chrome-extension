# 右鍵選單 Claude 助手（Context Menu Claude Actions）

- 日期：2026-07-10
- 對應規格：REQUIREMENTS.md 無（新需求）
- 狀態：**已完成（2026-07-11）**——Task 0–6 全數完成、手動驗收通過（含測試回饋修正與動作 5 增補，見 §2.8-bis）
- 方向決策（2026-07-11 與使用者確認，共兩輪）：
  1. **交棒使用者自己的 claude.ai**（用訂閱、不走 API、不扣 API 費），不採「外掛自行 call API ＋ side panel」（該方案記錄於 §2.9 備選）。
  2. 帶入機制採 **DOM 注入**（同 Glasp 等外掛的做法：注入 claude.ai 頁面、把內容寫進輸入框、必要時自動送出），`?q=` 網址參數僅作備援。動作 1 **擷取頁面內文直接貼上**（非只帶網址）。

---

## 1. User Story

1. 身為瀏覽外文網頁的使用者，我想要在頁面空白處按右鍵選「請 Claude 摘要此頁」，以便在我自己的 claude.ai 對話中快速取得整頁重點，不用逐字閱讀。
2. 身為研究資料的使用者，我想要選取一段文字後按右鍵「將選取文字帶入 Claude」，以便在 claude.ai 針對這段內容提問追問，不必手動複製貼上。
3. 身為閱讀外文內容的使用者，我想要選取一段非中文文字後按右鍵「請 Claude 翻譯」，以便立即在 claude.ai 取得正體中文翻譯。
4. 身為時間有限的使用者，我想要選取一段非中文長文後按右鍵「請 Claude 翻譯＋摘要」，以便一次得到中文翻譯與重點整理。

---

## 2. Spec

### 2.0 既有模組盤點

不經外掛呼叫 API，Provider／快取／semaphore 體系**不適用**；重用如下：

| 既有模組 | 本功能如何使用 |
|---|---|
| `src/shared/experts.ts` 的 `renderTemplate()` | **直接重用**。四動作的帶入文字模板用同一套 `{{變數}}` 代入。 |
| `src/shared/settings.ts`（`loadSettings` / `DEFAULT_SETTINGS`） | **直接重用＋擴充**。讀 `targetLang`（動作 1、2 回應語言）；新增 `assistantMaxChars`（見 2.6）與使用者可調的 prompt 模板（見 2.5，獨立 sync key，沿用 `customExperts` 避開 8KB 上限的先例）。 |
| `src/shared/languages.ts` | **直接重用**。語言中文名稱組進指示句。 |
| `src/shared/messages.ts` | **依規則擴充**。新增 background → claude.ai content script 的訊息型別。 |
| SW 的動態注入＋PING 輪詢模式（`ensureWebTranslateScript`） | **沿用模式**。claude.ai 注入 script 同樣以「executeScript → 輪詢 PING → 轉發任務」處理 CRXJS 載入器的非同步就緒問題。 |
| `subtitle-provider.ts` 的「隔離脆弱依賴」慣例 | **沿用慣例**。所有依賴 claude.ai 未公開 DOM 結構的邏輯集中在單一模組，改版只修一檔（錯誤訊息註明「claude.ai 可能已改版」）。 |
| `src/content/web-translate/scanner.ts` | **不直接重用**（綁定 IntersectionObserver 與譯文節點邏輯），但動作 1 的擷取器沿用其「區塊選擇器＋排除 `pre/code`／隱藏元素」思路，獨立實作輕量版（見 2.3）。 |
| `src/providers/*`、`src/shared/cache.ts`、semaphore、AI 專家模板 | **不使用**。不呼叫 API、不快取；專家是翻譯風格模板，與帶入指示句無關。 |

### 2.1 Task 0：claude.ai 注入行為驗證（前置 spike，實作前必做）

方案立足於 claude.ai 的頁面結構（非官方保證），實作前人工驗證並回填本節：

- [x] `claude.ai/new` 的輸入框：**頁面上唯一的 contenteditable DIV**，className `"tiptap ProseMirror"` → 選擇器 **`div.ProseMirror[contenteditable="true"]`**（2026-07-11 驗證）。
- [x] 程式化寫入：`editor.focus()` → `execCommand('selectAll')` → `execCommand('insertText')` **可行**，**換行保留**（2026-07-11 驗證）。
- [x] 自動送出：送出鈕在輸入框有文字後**非同步**出現（填入同一 tick 找不到，約 1 秒內出現），選擇器 **`button[aria-label="Send message"]`**（比對建議用 `/send/i` 容錯），`click()` 後輸入框清空、訊息確實送出（2026-07-11 驗證）→ 注入流程：**填入 → 輪詢等待送出鈕 → 點擊**；備案為模擬 Enter keydown（未動用）。「只填不送」即填入後不做點擊，天然可控。
- [x] 長內容行為：20,000 字元寫入 9ms、50,000 字元 14ms，**無卡頓、不轉附件、內容完整**（2026-07-11 驗證）→ `assistantMaxChars` 預設值定案 **50,000**。
- [x] 未登入時開 `claude.ai/new`：導向 `/logout` → `/login`，登入成功後回到 `/new`（**帶入內容不保留**，2026-07-11 驗證）→ 已知限制：**需先登入 claude.ai**，未登入時觸發動作內容會丟失，不做重試機制。
- [x] 備援路徑 `?q=`：**可用**——預填成功、`%0A` 換行保留（2026-07-11 驗證）；claude.ai 會對 URL 預填內容顯示「Use caution before running this prompt」警告橫幅，屬其防護措施、不影響功能（備援體驗註記）。可用長度上限未測，備援上限常數維持保守值 2,000 字元。
- 已確認不可行：Claude 桌面版 App 無公開帶入入口，只支援網頁版。

若「注入」與「?q=」皆不可行，回到 §2.9 備選方案重審本計畫。

> 完整驗證腳本與逐項執行紀錄收錄於文末「附錄：Task 0 驗證紀錄」。

### 2.2 右鍵選單結構與顯示條件

由 background 在 `chrome.runtime.onInstalled` 建立；四項自動收合於外掛名稱子選單：

| id | 標題 | contexts | documentUrlPatterns |
|---|---|---|---|
| `bt-assistant-summarize-page` | 請 Claude 摘要此頁 | `page` | `http://*/*`, `https://*/*` |
| `bt-assistant-ask-selection` | 將選取文字帶入 Claude | `selection` | 同上 |
| `bt-assistant-translate-selection` | 請 Claude 翻譯 | `selection` | 同上 |
| `bt-assistant-translate-summarize` | 請 Claude 翻譯＋摘要 | `selection` | 同上 |

- `documentUrlPatterns` 限定 http/https，`chrome://` 等受限頁不顯示。
- **「非中文」採執行時判斷**：選單顯示前得知選取內容需 `<all_urls>` 常駐 content script，違反權限最小化；動作 3、4 恆顯示，點擊後判斷（見 2.4）。

### 2.3 執行流程與頁面內容擷取

```
使用者點右鍵選單項目
  → background：contextMenus.onClicked
      1. 取內容：
         - 動作 1：以 activeTab + scripting.executeScript({ func }) 在原分頁執行擷取函式
           （右鍵點外掛選單即授予 activeTab，不需廣域權限）
         - 動作 2–4：info.selectionText
      2. 動作 3、4：中文判斷（見 2.4）；中文時注入 confirm() 詢問，取消則中止
      3. 組帶入文字（模板 × renderTemplate，見 2.5）＋超長截斷（見 2.6）
      4. chrome.tabs.create({ url: 'https://claude.ai/new' })
         → 對新分頁 executeScript 注入 claude-inject script（host 權限 claude.ai/*）
         → 輪詢 PING 至就緒 → 送 ASSISTANT_FILL { text, autoSubmit }
  → claude-inject content script：
      等輸入框出現 → 寫入文字 → autoSubmit 為 true 時程式化送出
      找不到輸入框（逾時）→ 回報 background → 備援：同分頁導向 claude.ai/new?q=<截斷後文字>
      找得到輸入框但送出失敗 → 保留已填文字不送出（使用者自行按 Enter），無錯誤彈窗
  → 使用者在 claude.ai 繼續對話（追問天然支援）
```

- **自動送出策略**：動作 1、3、4 自動送出（任務完整，無需使用者補話）；**動作 2 只填不送**——使用者在引文後接著輸入自己的問題，一次送出（引文＋問題同回合，Claude 一起讀）。
- **動作 1 擷取策略**（`executeScript({ func })` 注入純函式，不常駐）：
  1. **語意容器優先**：依序 `<article>` → `<main>` → `[role="main"]`，命中且 `innerText` ≥ 500 字元即採用；多個 `<article>` 取文字最長者。
  2. **啟發式回退**：收集 `p, h1~h6, li, blockquote, figcaption` 區塊；排除 `nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]` 內、`pre/code/script/style/noscript` 內、不可見元素；以文字量最大的共同祖先為主內容根。
  3. **最終回退**：`document.body.innerText`。
  - 結果做空白正規化，附 `document.title` 與 `location.href`。
  - 已知限制：留言區／資訊流型頁面效果有限；不處理 iframe 與 Shadow DOM。品質不足時備選 vendor `@mozilla/readability`（本機打包、不違反 0-A），本版不採。
- 選取文字用 `info.selectionText`（Chrome 會壓成單行、極長選取可能截斷，屬可接受限制）。
- 新增訊息型別（`shared/messages.ts`）：

| type | 方向 | payload | 回應 |
|---|---|---|---|
| `PING` | background → claude-inject | — | `{ ok: true }`（沿用既有 PING 慣例） |
| `ASSISTANT_FILL` | background → claude-inject | `text: string`, `autoSubmit: boolean` | `{ ok: boolean; filled: boolean; submitted: boolean; error?: string }` |

### 2.4 「非中文」判斷（動作 3、4）

- 純函式（`shared/assistant-prompts.ts`，可單元測試）：非空白字元中 `\p{Script=Han}` 占比 **≥ 50% 視為中文**。
- 中文時：對原分頁注入 `confirm('選取內容看起來已是中文，仍要請 Claude 翻譯嗎？')`（activeTab 已授予）；取消則中止。confirm 注入失敗（罕見）視同確認，照常執行（fail-open，無費用損失）。
- 動作 1、2 不判斷。

### 2.5 帶入文字設計（動作 → 模板）

新增 `src/shared/assistant-prompts.ts`。指示句是使用者在 claude.ai 看得到的文字，以正體中文撰寫、`renderTemplate()` 代入變數：

| 動作 | 帶入文字組成 | 自動送出 |
|---|---|---|
| 摘要此頁 | 「請以{{target_lang_label}}摘要以下網頁內容（一段總覽＋條列重點）。\n標題：{{page_title}}\n來源：{{page_url}}\n\n{{content}}」 | 是 |
| 帶入選取文字 | 「以下是我從網頁選取的內容（來源：{{page_url}}），請搭配我接著輸入的問題閱讀：\n\n{{content}}\n\n我的問題：」 | **否**（使用者接著打問題） |
| 翻譯 | 「請將以下內容翻譯成正體中文（台灣用語），只輸出譯文：\n\n{{content}}」 | 是 |
| 翻譯＋摘要 | 「請將以下內容翻譯成正體中文（台灣用語），譯文之後再以正體中文條列重點摘要，兩部分以標題分隔：\n\n{{content}}」 | 是 |

- 動作 3、4 目標語言**固定正體中文**（需求明定，預設模板如此；使用者自訂後自負）；動作 1 跟隨 `settings.targetLang`（以 `languages.ts` 中文名稱入句）。
- 不做防 prompt injection 包裹：內容進入使用者自己的對話、送出前（動作 2）或送出當下可見全文，風險模型與外掛代呼 API 不同。

**使用者自訂模板**（2026-07-11 審閱決策：開放調整，設彈性邊界）：

- 上表四段為**預設模板**；options 新增「Claude 助手」分頁，每個動作一個 textarea 可自訂，附「還原預設」鈕。
- 儲存於 `chrome.storage.sync` 獨立 key `assistantPrompts`（`Partial<Record<AssistantAction, string>>`，只存有覆寫的動作；沿用 `customExperts` 獨立 key 先例避開單項 8KB 上限）。
- 邊界規則：
  1. 模板**必含 `{{content}}`**，儲存時驗證、缺了 alert 擋下（否則帶過去的是沒有內容的指示句）。
  2. 可用變數白名單：`{{content}}`、`{{page_url}}`、`{{page_title}}`、`{{target_lang_label}}`；未知變數原樣保留、不報錯（`renderTemplate` 既有行為）。
  3. 單一模板上限 **500 字元**，超過 alert 擋下（保護 sync 配額）。
  4. **自動送出與否不開放調整**（動作 2 固定不送、其餘固定送），行為歸屬動作本身而非模板。
- 讀取一律走 `loadAssistantPrompts()`：與預設模板合併，空字串／缺項退回預設。

### 2.6 超長內容截斷策略

- 新增設定 `assistantMaxChars`（**options「Claude 助手」分頁可調**，與 prompt 模板同分頁；DOM 注入無網址長度限制，預設值 **50,000** 字元（Task 0 定案：50,000 字寫入 14ms 無卡頓）；下限 500）。用途是避免極端長頁面讓輸入框卡死，而非網址預算。
- 超過上限：**保留開頭截斷**，文末加註「……（內容過長，已截斷）」。
- 備援路徑（?q=）另有獨立的保守上限常數（暫定 2,000 字元，Task 0 定案），備援觸發時以此再截。
- 欄位同步：`shared/types.ts` 的 `Settings`、`DEFAULT_SETTINGS`（平面欄位，既有淺合併即涵蓋）、options 進階分頁 UI。

### 2.7 錯誤處理

| 情境 | 行為 |
|---|---|
| claude.ai 改版：輸入框選擇器失效 | 逾時後備援導向 `?q=`（截斷版）；console warn 註明「claude.ai 可能已改版」；DOM 依賴集中於 claude-inject 模組，只修一檔 |
| 輸入框可填但送出鈕失效 | 保留已填文字不送出，使用者自行按 Enter（優雅降級，不彈錯誤） |
| 未登入 claude.ai | 依 Task 0 驗證結果處理；最差情況列已知限制「請先登入 claude.ai」 |
| 動作 1 擷取失敗／內容過短（< 200 字） | 照常帶入已取得的內容；完全失敗時退回 `document.body.innerText`，再失敗則以「標題＋網址」帶入並請 claude.ai 自行讀取 |
| 選取內容判定為中文（動作 3、4） | confirm() 確認，取消即中止（見 2.4） |
| SW 休眠後重啟 | 選單註冊於 `onInstalled` 持久存在；onClicked 喚醒 SW，流程無跨事件狀態依賴 |

不適用（相較 API 方案）：無「未設 API key」、無 API 錯誤重試、無扣費風險。

### 2.8 權限變更與上架收斂註記

本版新增：

- `contextMenus` 權限 — 四個選單項目（低敏感，安裝無警告）。
- `host_permissions: https://claude.ai/*` — 對 claude.ai 分頁注入填入 script（**不需向 Anthropic 申請**，manifest 宣告即可；安裝時 Chrome 會列出「可讀取 claude.ai 的資料」）。
- 動作 1 擷取與 confirm 注入沿用既有 `activeTab` + `scripting`；`tabs.create` 不需 `tabs` 權限。

日後上架 Chrome Web Store 需收斂／揭露：

1. `claude.ai/*` host 權限屬中等敏感，審核需說明用途（「將使用者選取的內容填入其本人的 claude.ai 對話」）；權限註解照慣例寫進 manifest。
2. **依賴 claude.ai 未公開 DOM 結構**：改版即失效（已隔離單檔＋?q= 備援）；上架前重跑 Task 0。
3. **服務條款灰色地帶**：程式化操作 claude.ai 頁面未經 Anthropic 官方支持（Glasp 等外掛同模式，實務普遍）；本機自用風險低，上架前自行評估。
4. 隱私：內容只進使用者本人的 claude.ai 會話，不經第三方；DOM 注入路徑不留存於網址（僅備援 `?q=` 會短暫出現在歷史紀錄，需揭露）。

### 2.8-bis 實作增補（2026-07-11，Task 1–5 實作與測試回饋後定案）

1. **「摘要此頁」contexts 改為 `['page', 'selection']`**（§2.2 表格原寫 `page`）：contexts 只有 `page` 時，右鍵點在選取文字上不會顯示該項，與驗收標準「有選取時各項皆有」矛盾，故補上。
2. **擷取器：語意容器內也套區塊過濾**（§2.3 補強）：命中 `article`/`main` 時不再直接取整個 `innerText`（會帶進容器內的導覽／推薦連結），改為容器內收段落區塊＋雜訊排除，過濾後 < 500 字元才退回容器全文。動機：2026-07-11 新聞網站實測雜訊過多。
3. **「摘要此頁」預設模板加擷取雜訊提醒**（§2.5 表格更新）：「內容為程式自動擷取，可能夾雜選單、推薦連結、圖片說明等非本文文字，請自行判斷忽略。」（使用者測試回饋採納）
4. **新增動作 5「請 Claude 摘要選取文字」**（BOARD #7，2026-07-11 測試回饋核可併入本計畫）：id `bt-assistant-summarize-selection`、contexts `selection`、自動送出、目標語言跟隨 `targetLang`，模板：「請以{{target_lang_label}}摘要以下我從網頁選取的內容（一段總覽＋條列重點）。\n來源：{{page_url}}\n\n{{content}}」。選單、options 模板分頁均由 `ASSISTANT_ACTIONS` 動態產生，無額外 UI 改動。
5. **已知限制補充（待觀察）**：動作 1 擷取對特殊版型仍可能帶入較多非本文文字（現況可接受，模板提醒兜底）；若遇干擾暴增的版型再另開優化任務。

### 2.9 備選方案（本版不採，留檔備查）

「外掛自行呼叫 API ＋ side panel」：BYOK 走 `settings.claude` 呼叫 api.anthropic.com，結果顯示於 side panel 並支援面板內追問。優點：不跳頁、不依賴 claude.ai 頁面結構；缺點：按量扣 API 費、需 `sidePanel` 權限、實作量約三倍。若 claude.ai 注入與 `?q=` 皆不可行、或日後需求升級，以此為後路；完整設計見本計畫 git 歷史第一版。

### 2.10 驗收標準（可勾選）

前置：Task 0 驗證全數完成並回填。

- [ ] http/https 頁面右鍵可見選單（空白處僅「摘要此頁」；有選取時四項皆有）；`chrome://` 頁不顯示
- [ ] 動作 1：新聞文章頁點「摘要此頁」→ 新分頁 claude.ai 自動填入「指示＋標題＋網址＋擷取內文」並**自動送出**；擷取內容為文章主體，不含導覽列／頁尾雜訊
- [ ] 動作 1：登入牆內的頁面（如公司內部文件）也能擷取貼入（不依賴 claude.ai 讀網址）
- [ ] 動作 2：選取文字 →「帶入 Claude」→ 輸入框填入引文與「我的問題：」結尾，**未自動送出**；接著輸入問題送出後回答針對引文
- [ ] 動作 3：選取英文段落 → 自動送出後得到正體中文譯文
- [ ] 動作 3／4：選取中文段落 → 原頁跳出「已是中文」確認框；取消不開分頁，確認照常執行
- [ ] 動作 4：選取英文長段 → 回應同時含完整翻譯與條列摘要兩節
- [ ] 長內容：> 10,000 字元的頁面摘要可正常填入送出；> `assistantMaxChars` 時被截斷且末尾有截斷註記
- [ ] 「Claude 助手」分頁調整 `assistantMaxChars` 後立即生效
- [ ] 目標語言切換（如改日文）後動作 1 指示句對應更新；動作 3、4 仍固定正體中文（預設模板）
- [ ] 自訂模板：修改動作 3 的模板文字後右鍵翻譯，帶入文字反映自訂內容；「還原預設」後回到預設模板
- [ ] 模板驗證：存檔時缺 `{{content}}` 或超過 500 字元 → alert 擋下、不寫入
- [ ] 換行、引號、emoji 內容填入後不亂碼、格式合理
- [ ] 備援模擬：暫時把輸入框選擇器改成錯的 → 逾時後以 `?q=` 開頁（截斷版），不產生未捕捉錯誤
- [ ] 未登入 claude.ai 時觸發：行為符合 Task 0 記錄
- [ ] 既有功能迴歸：整頁雙語翻譯、YouTube 字幕、popup、options 行為不變

---

## 3. Tasks

依 CLAUDE.md 規則：**每完成一個 task 停下，提示到 chrome://extensions 手動載入測試**。

### Task 0：claude.ai 注入行為驗證（spike，不寫產品程式）✅ 已完成（2026-07-11）
- §2.1 清單全數驗證完成並回填：輸入框 `div.ProseMirror[contenteditable="true"]`、寫入用 `execCommand('insertText')`（換行保留）、送出鈕 `button[aria-label="Send message"]`（填入後輪詢等待）、`assistantMaxChars` 定案 50,000、備援 `?q=` 可用（上限 2,000）。

### Task 1：帶入文字模板與純函式工具
- 新增 `src/shared/assistant-prompts.ts`：四動作模板＋組裝函式（重用 `renderTemplate`）、`isMostlyChinese()`、`truncateForHandoff()`（截斷＋註記）、備援網址組裝 `buildFallbackUrl()`、上限常數。
- 影響檔案：`src/shared/assistant-prompts.ts`（新）
- 驗證：`npm run typecheck`；純函式項目補進 TESTING.md 的 vitest 規劃。

### Task 2：設定欄位與 prompt 模板自訂 UI
- `Settings` 加 `assistantMaxChars`（Task 0 定案值）＋`DEFAULT_SETTINGS`；`settings.ts` 加 `assistantPrompts` 獨立 key 的讀寫（`loadAssistantPrompts()` 含預設合併）與儲存驗證（必含 `{{content}}`、≤ 500 字元）；options 新增「Claude 助手」分頁：四個模板 textarea＋各自「還原預設」鈕＋`assistantMaxChars` 欄位（改了即存，沿用既有模式）。
- 影響檔案：`src/shared/types.ts`、`src/shared/settings.ts`、`src/shared/assistant-prompts.ts`（預設模板供合併）、`src/options/index.html`、`src/options/options.ts`
- 手動測試點：分頁可調、重開設定頁值保留、驗證擋下缺 `{{content}}`／超長的存檔。

### Task 3：訊息型別、manifest 權限與 claude-inject script
- `shared/messages.ts` 加 `ASSISTANT_FILL`（含回應型別）；manifest 加 `contextMenus` 權限與 `https://claude.ai/*` host 權限（含註解）；新增 `src/content/claude-inject/index.ts`：PING 應答、等待輸入框（MutationObserver＋逾時）、寫入文字、自動送出；**所有 claude.ai DOM 選擇器集中此檔**（沿用 subtitle-provider 隔離慣例），防重複注入旗標 `__btClaudeInjectLoaded`。
- 影響檔案：`src/shared/messages.ts`、`manifest.config.ts`、`src/content/claude-inject/index.ts`（新）
- 手動測試點：載入外掛後於 DevTools 手動對 claude.ai 分頁送測試訊息，確認填入與送出可動。

### Task 4：background 選單註冊與任務編排（動作 2–4）
- `onInstalled` 建四個選單；`onClicked` 處理動作 2–4：selectionText、中文判斷＋confirm 注入、組文字＋截斷、開分頁→注入→PING 輪詢→`ASSISTANT_FILL`；注入逾時的 `?q=` 備援。
- 影響檔案：`src/background/service-worker.ts`
- 手動測試點：動作 2、3、4 完整動線（含中文確認與動作 2 不自動送出）。

### Task 5：頁面內容擷取與動作 1 接線
- 新增擷取函式（語意容器 → 啟發式 → body 回退，見 2.3），background 以 `executeScript({ func })` 執行；接上動作 1 流程。
- 影響檔案：`src/content/page-extract.ts`（新，export 供 SW 引用的純函式）、`src/background/service-worker.ts`
- 手動測試點：2–3 個不同版型的新聞網站確認擷取排除導覽列／頁尾；走動作 1 完整動線。

### Task 6：文件同步與收尾
- FEATURES.md 新增「功能三：右鍵選單 Claude 助手」（行為＋已知限制：DOM 依賴、需登入、ToS 灰色地帶、`info.selectionText` 單行化）；ARCHITECTURE.md 更新（訊息一覽加 `ASSISTANT_FILL`、執行環境表加 claude-inject content script、storage 加 `assistantMaxChars` 與 `assistantPrompts` key、目錄結構）；DEVELOPMENT.md 視需要補隔離慣例說明；TESTING.md 補 vitest 項目（`isMostlyChinese`、`truncateForHandoff`、`buildFallbackUrl`、擷取器啟發式）與手動驗收清單；CHANGELOG.md 記錄；本計畫移至 `docs/plans/archive/`。
- 影響檔案：`docs/FEATURES.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/TESTING.md`、`docs/CHANGELOG.md`、本檔（移動）

### 範圍外（明確不做，避免蔓延）
- 外掛內呼叫 API／side panel（備選方案，見 §2.9）
- Claude 桌面版 App 帶入（無公開入口）
- 選單層級「非中文才顯示」動態控制（需 `<all_urls>`）
- ChatGPT 等其他對話服務的帶入（如有需求另開計畫）
- iframe／Shadow DOM 內容擷取、Readability 依賴

---

## 附錄：Task 0 驗證紀錄（2026-07-11）

驗證環境：登入中的 Chrome，於 `https://claude.ai/new` 的 DevTools Console 手動執行。結論已彙整於 §2.1，本附錄保存原始腳本與執行結果，供 claude.ai 改版時重跑比對。

### 結果總表

| 驗證項 | 方法 | 結果 |
|---|---|---|
| 輸入框結構 | 第一輪腳本 `scan()`＋第二輪 className 輸出 | 頁面唯一 contenteditable DIV，className `"tiptap ProseMirror"` |
| 程式化寫入＋換行 | 第一輪 `fill()` | `insertText` 回傳 true，內容含 `\n`，換行保留 ✅ |
| 長文行為 | 第一輪 `fillLong(20000)` / `fillLong(50000)` | 20,000 字 9ms、50,000 字 14ms；無卡頓、不轉附件、字元數完整 ✅ |
| 送出鈕偵測 | 第一輪 `clickSend()`（失敗）→ 第二輪腳本（成功） | 空框時無送出鈕；填入文字後**非同步**出現（同一 tick 掃不到，1 秒內出現）；`button[aria-label="Send message"]`，`click()` 後輸入框清空、訊息確實送出 ✅ |
| `?q=` 備援 | 人工開啟測試網址 | 預填成功、`%0A` 換行保留；claude.ai 顯示「Use caution before running this prompt」警告橫幅（防護措施，不影響功能）✅ |
| 未登入行為 | 無痕視窗人工測試 | `/new` → 導向 `/logout` → `/login?from=logout`；登入成功後回 `/new`，**帶入內容不保留** → 已知限制：需先登入 |

<details>
<summary>第一輪腳本：結構掃描／寫入／長文（btSpike）＋執行結果</summary>

```js
/* ===== 雙語翻譯外掛 Task 0 驗證腳本（在 claude.ai/new 的 Console 執行）===== */
(() => {
  const log = (...a) => console.log('%c[bt-spike]', 'color:#7c3aed;font-weight:bold', ...a);

  const findEditor = () =>
    document.querySelector('div.ProseMirror[contenteditable="true"]') ??
    document.querySelector('[contenteditable="true"]');

  const describe = (el) => ({
    tag: el.tagName,
    attrs: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])),
  });

  /* 步驟 1｜掃描輸入框與按鈕結構 */
  const scan = () => {
    const editors = [...document.querySelectorAll('[contenteditable="true"]')];
    log(`步驟1｜contenteditable 元素數：${editors.length}`);
    editors.forEach((el, i) => log(`  editor[${i}]`, describe(el)));

    const editor = findEditor();
    const container = editor?.closest('form') ?? editor?.parentElement?.parentElement?.parentElement;
    const buttons = [...(container ?? document).querySelectorAll('button')].map((b) => ({
      ariaLabel: b.getAttribute('aria-label'),
      text: b.innerText.trim().slice(0, 20),
      disabled: b.disabled,
    }));
    log('步驟1｜輸入框附近的按鈕（找送出鈕用）：');
    console.table(buttons);
  };

  /* 步驟 2｜程式化寫入短文字（含換行） */
  const fill = (text = '測試填入 test fill\n第二行 second line') => {
    const editor = findEditor();
    if (!editor) return log('步驟2｜找不到輸入框 ❌');
    editor.focus();
    document.execCommand('selectAll', false);
    const ok = document.execCommand('insertText', false, text);
    log(`步驟2｜insertText 回傳：${ok}`);
    log('步驟2｜輸入框現有內容：', JSON.stringify(editor.innerText));
    log('步驟2｜換行保留？', /\n/.test(editor.innerText) ? '是 ✅' : '否 ❌（被壓成單行）');
  };

  /* 步驟 3｜長文寫入（測卡頓與是否被轉附件） */
  const fillLong = (n = 20000) => {
    const editor = findEditor();
    if (!editor) return log('步驟3｜找不到輸入框 ❌');
    const chunk = 'The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳過了懶惰的狗。';
    const text = chunk.repeat(Math.ceil(n / chunk.length)).slice(0, n);
    editor.focus();
    document.execCommand('selectAll', false);
    const t0 = performance.now();
    const ok = document.execCommand('insertText', false, text);
    const ms = Math.round(performance.now() - t0);
    const got = editor.innerText.replace(/\n/g, '').length;
    log(`步驟3｜寫入 ${n} 字元：回傳 ${ok}、耗時 ${ms}ms、輸入框實際字元數 ${got}`);
  };

  /* 步驟 4｜程式化送出（此輪失敗，見執行結果） */
  const clickSend = () => {
    const editor = findEditor();
    const container = editor?.closest('form') ?? document;
    const btn = [...container.querySelectorAll('button[aria-label]')].find((b) =>
      /send|傳送|送出/i.test(b.getAttribute('aria-label') ?? ''),
    );
    if (!btn) return log('步驟4｜找不到送出鈕 ❌');
    btn.click();
  };

  window.btSpike = { scan, fill, fillLong, clickSend };
  scan();
})();
```

執行結果：

- `scan()`：contenteditable 元素數 **1**（editor[0] 為 DIV）；空框時按鈕清單只有 `Add files…`、`Model: Fable…`、`Settings`、`Press and hold…`、`Use voice mod…`——**無送出鈕**。
- `fill()`：insertText 回傳 `true`；內容 `"測試填入 test fill\n\n第二行 second line"`；換行保留 ✅。
- `fillLong(20000)`：回傳 `true`、耗時 **9ms**、實際字元數 20000。
- `fillLong(50000)`：回傳 `true`、耗時 **14ms**、實際字元數 50000；目視無卡頓、未轉成「pasted content」附件。
- `clickSend()`：找不到送出鈕 ❌（原因：指令一次貼上連續執行，填入與掃描在同一 tick，React 尚未渲染送出鈕——由第二輪驗證解決）。

</details>

<details>
<summary>第二輪腳本：送出鈕偵測與點擊（bt-spike2）＋執行結果</summary>

```js
/* ===== bt-spike 第二輪：送出鈕偵測與點擊 ===== */
(() => {
  const log = (...a) => console.log('%c[bt-spike2]', 'color:#059669;font-weight:bold', ...a);
  const editor = document.querySelector('[contenteditable="true"]');
  if (!editor) return log('找不到輸入框 ❌');
  log('輸入框 className：', JSON.stringify(editor.className));

  editor.focus();
  document.execCommand('selectAll', false);
  document.execCommand('insertText', false, '送出鈕偵測測試，請回覆 OK 即可');
  log('已填入文字，等 1 秒讓介面更新…');

  setTimeout(() => {
    const all = [...document.querySelectorAll('button')].map((b) => ({
      ariaLabel: b.getAttribute('aria-label'),
      text: b.innerText.trim().slice(0, 15),
      type: b.type,
      hasSvg: !!b.querySelector('svg'),
      disabled: b.disabled,
    }));
    log('全頁按鈕清單（填入文字 1 秒後）：');
    console.table(all);

    const btn = [...document.querySelectorAll('button')].find((b) =>
      /send|傳送|送出/i.test(b.getAttribute('aria-label') ?? ''),
    );
    if (btn) {
      log('找到送出鈕：', JSON.stringify(btn.getAttribute('aria-label')), '→ 點擊');
      btn.click();
      setTimeout(() => {
        const left = editor.innerText.trim();
        log('點擊 1 秒後輸入框內容：', JSON.stringify(left), left ? '（沒送出 ❌）' : '（已清空＝送出成功 ✅）');
      }, 1000);
    } else {
      log('aria-label 找不到送出鈕 → 改試模擬 Enter');
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      );
    }
  }, 1000);
})();
```

執行結果：

- 輸入框 className：`"tiptap ProseMirror"`。
- 填入文字 1 秒後的全頁按鈕清單共 46 顆，其中 index 43 為 **`aria-label="Send message"`**（空框時此鈕不存在，證實送出鈕隨輸入內容非同步出現）。
- 點擊後：輸入框內容變 `""`（已清空＝送出成功 ✅），Console 同時出現 claude.ai 的 `[COMPLETION] Completion request succeeded`，確認訊息真的送出並觸發回覆。
- 模擬 Enter 的備案路徑**未動用**（按鈕路徑已成功）。

</details>

<details>
<summary>人工測試 A／B：?q= 備援與未登入行為</summary>

**A. `?q=` 備援路徑**——開啟測試網址：

```
https://claude.ai/new?q=%E5%82%99%E6%8F%B4%E6%B8%AC%E8%A9%A6%20fallback%20test%0A%E7%AC%AC%E4%BA%8C%E8%A1%8C
```

結果：輸入框預填「備援測試 fallback test（換行）第二行」，`%0A` 換行保留 ✅；頁面出現紅色警告橫幅「Use caution before running this prompt. Malicious conversation content could trick Claude into attempting harmful actions or sharing your data.」——claude.ai 對 URL 預填內容的防護措施，不影響功能，列為備援路徑的體驗註記。

**B. 未登入行為**——無痕視窗開 `claude.ai/new`：

導向順序 `/new` → `https://claude.ai/logout` → `https://claude.ai/login?from=logout`；登入成功後導回 `https://claude.ai/new`（乾淨新對話，**原本要帶入的內容不保留**）。結論：未登入時觸發右鍵動作內容會丟失，列已知限制「請先登入 claude.ai」，不做重試機制。

</details>
