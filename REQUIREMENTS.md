# 雙語翻譯 Chrome 外掛 — 需求規格書 (v0.1)

> 目的：復刻沉浸式翻譯的兩大核心功能（網頁雙語翻譯、YouTube 雙語字幕），自用為主，最終上架 Chrome Web Store。
> 本文件為 Claude Code 開發依據。法律注意：僅復刻功能概念，禁止複製原工具的程式碼、名稱、Logo、文案。

---

## 0-A. 合規約束（架構決策依據，已查證）

1. **MV3 政策**：所有邏輯必須自包含於套件內，禁止執行遠端程式碼（eval / 遠端 script）；外部通訊僅限「不含邏輯的資源」與「資料處理」（呼叫 AI 翻譯 API 屬合規範圍）。
2. **用戶資料政策**：處理任何用戶資料須提供隱私權政策，且只能收集單一揭露用途所需的最小資料 → 本專案 API key 僅存 `chrome.storage`、不經任何自架伺服器，將審核負擔降到最低。
3. **權限最小化**：審核會駁回未使用或過寬的權限，manifest 中每個權限都要對應到具體功能。
4. **YouTube ToS**：禁止伺服器端自動化抓取（爬蟲）；字幕取得一律在使用者瀏覽器 session 內由 content script 完成，不做任何後端抓取。
5. **上架申報**：隱私欄位「Remote Code」選「No」（本架構不執行遠端程式碼）。

## 0. 專案總覽

- **Manifest**: V3
- **語言/工具**: TypeScript + Vite（建議用 CRXJS 或 vite-plugin-web-extension 打包）⚠️ 需自行驗證：外掛打包工具版本相容性
- **UI**: 原生 DOM + CSS（content script 內避免引入框架，降低與宿主頁面衝突）；設定頁（options page）可用輕量框架或原生
- **翻譯引擎**: 使用者自帶 API key（BYOK），第一階段支援 Anthropic Claude 與 OpenAI，介面設計成 Provider 抽象層以便擴充
- **儲存**: `chrome.storage.sync`（設定）＋ `chrome.storage.local`（翻譯快取）
- **權限最小化**: `storage`, `activeTab`, `scripting`；host_permissions 僅限 API endpoint 與 `*://*.youtube.com/*`（上架審核會嚴查權限）

---

## 1. 功能一：網頁雙語翻譯

### 1.1 核心行為
1. 點擊外掛圖示或快捷鍵（預設 `Alt+T`，可自訂）→ 翻譯當前頁面
2. 再次觸發 → 移除譯文、還原原文（toggle）
3. 翻譯方式：掃描頁面可見段落（`p`, `li`, `h1~h6`, `blockquote` 等區塊元素），將譯文以新節點插入原文節點「下方」，**不修改原文節點**（垂直雙語對照）
4. 保留原始排版：譯文節點繼承原文的字級比例與行寬
5. 惰性翻譯：使用 `IntersectionObserver`，僅翻譯進入視口的段落（省 token、加快首屏）

### 1.2 譯文樣式自訂（設定頁）
- 預設樣式選單（至少 4 種）：
  - `無樣式`（與原文同）
  - `虛線底線`
  - `馬克筆`（背景高亮）
  - `引用`（左側豎線 + 縮排 + 淡色）
- 進階自訂：文字顏色、背景色、字體大小（%）、字型
- 實作方式：每種樣式對應一組 CSS class，注入 `<style>` 到 shadow DOM 或以高 specificity class 實作，避免被宿主頁 CSS 覆蓋 ⚠️ 需自行驗證：部分網站 CSP 或 CSS 隔離策略

### 1.3 AI 模型與「AI 專家」（增強器）
- **模型選擇**：設定頁可選 Provider（Claude / OpenAI）＋ 模型名稱（文字輸入框，不寫死型號清單，避免模型迭代失效）＋ API key ＋ 測試連線按鈕
- **AI 專家 = system prompt 模板**：
  - 內建：`通用`、`技術文件`、`學術論文`、`新聞`
  - 支援使用者新增自訂模板（名稱 + system prompt）
  - 模板變數：`{{source_lang}}`, `{{target_lang}}`, `{{text}}`
- **批次翻譯**：多個段落合併為一個請求（以分隔符或 JSON 陣列傳遞），要求模型回傳對應陣列 ⚠️ 需自行驗證：長段落切分與回傳對齊的穩定性，這是 AI 最容易出錯的環節，需設計對齊失敗的 fallback（逐段重試）
- **並發控制**：設定頁可調並發請求數（預設 3）與單頁最大字數上限（預設 10,000），防止 API 費用暴衝
- **快取**：以 `hash(原文 + 模型 + 模板 + 目標語言)` 為 key 存 local storage，同頁重開不重扣費；提供清除快取按鈕

### 1.4 UI 元件
- **Popup（點擊圖示）**：翻譯/還原按鈕、目標語言下拉、當前模型與 AI 專家顯示（可快速切換）、「開啟設定」連結
- **Options page（設定頁）**：分頁籤：`翻譯服務`（Provider/key/模型）、`樣式`、`AI 專家`、`進階`（並發、字數上限、快取）
- 懸浮球：**捨棄**（第一版不做，快捷鍵已足夠）

---

## 2. 功能二：YouTube 雙語字幕

### 2.1 核心行為
1. 前提：影片本身有字幕軌（含自動產生字幕）
2. 進入 YouTube watch 頁 → content script 取得該影片字幕軌清單
3. 使用者於面板選擇來源字幕語言 → 以選定的 AI 模型翻譯 → 在播放器字幕區以「原文在上、譯文在下」雙行呈現
4. 隱藏 YouTube 原生字幕（避免重疊），自繪字幕層（absolute 定位 overlay 於播放器內）
5. 字幕與播放進度同步：監聽 `video.timeupdate`，依時間軸切換當前字幕

### 2.2 字幕取得（技術關鍵，⚠️ 需自行驗證）
- 方案 A：從頁面 `ytInitialPlayerResponse.captions` 取得 `captionTracks` 的 `baseUrl`，fetch timedtext XML/JSON
- 方案 B：攔截 YouTube 播放器自身的 timedtext 請求
- ⚠️ YouTube 會不定期改動此結構且可能要求簽名參數，開發時必須先實測當前可行方案，並將取得邏輯隔離為獨立模組（`subtitle-provider.ts`）以便日後修補

### 2.3 翻譯策略
- 整批預翻譯：取得完整字幕軌後，分批（每批 30~50 條，帶前後文）送 AI 翻譯，顯示進度條
- 帶上下文翻譯：每批請求附前一批最後 2 條原文作為 context，改善斷句連貫性（這是機翻爛的主因，也是本專案品質核心）
- 翻譯結果快取（同影片 ID + 模型 + 目標語言）

### 2.4 SPA 導航處理（原工具已知 bug，必須做對）
- 監聽 `yt-navigate-finish` 事件（YouTube 自訂事件）偵測換片 ⚠️ 需自行驗證：事件名稱現行是否有效
- 換片時：清除舊字幕層與計時器、重新抓字幕軌、重置狀態
- 這是沉浸式翻譯被使用者抱怨的痛點（換片後字幕殘留），列為驗收條件

### 2.5 UI 元件
- 播放器工具列注入一顆「雙語字幕」按鈕：開/關、選來源字幕語言、選 AI 專家
- 字幕樣式沿用功能一的樣式設定（字級、顏色、背景半透明度）
- 字幕檔下載（.srt，含雙語）：**第二版再做**

---

## 3. 明確捨棄的功能（不做）

| 功能 | 捨棄理由 |
|---|---|
| PDF / EPUB / 漫畫翻譯 | 工程量大，非目標需求 |
| 100+ 影音平台支援 | 只做 YouTube |
| 輸入框翻譯（3 次空白鍵） | 非核心 |
| 懸浮球 | 快捷鍵取代 |
| 滑鼠懸停翻譯單段落 | 第二版考慮 |
| 帳號系統 / Pro 訂閱 / 分享頁面 | 自用 BYOK，無需後端 |
| 免費翻譯引擎（Google/微軟） | 只走 AI API，簡化架構 |

---

## 4. 驗收條件（MVP）

- [ ] 在任意新聞網站（如 BBC）一鍵產生雙語對照，還原無殘留
- [ ] 樣式切換即時生效，不需重新翻譯
- [ ] 換 AI 專家後重翻，譯文明顯反映模板差異
- [ ] YouTube 影片開啟雙語字幕，與語音同步誤差 < 0.5s
- [ ] YouTube 連續切換 3 部影片，字幕正確更新、無殘留（對照組 bug）
- [ ] API key 僅存於 `chrome.storage`，不外傳任何第三方伺服器
- [ ] 通過 `chrome://extensions` 載入未封裝測試後，可打包提交 Chrome Web Store

---

## 5. 建議專案結構

```
src/
  manifest.json
  background/service-worker.ts      # API 請求代理（繞過 CORS）、快取
  content/
    web-translate/                  # 功能一
      scanner.ts                    # 段落掃描 + IntersectionObserver
      renderer.ts                   # 譯文節點插入/移除/樣式
    youtube/                        # 功能二
      subtitle-provider.ts          # 字幕軌取得（隔離模組）
      subtitle-overlay.ts           # 自繪字幕層
      navigation.ts                 # SPA 換片偵測
  providers/                        # AI Provider 抽象層
    base.ts / claude.ts / openai.ts
  options/                          # 設定頁
  popup/                            # 快捷面板
  shared/                           # storage、i18n、樣式常數
```

---

## 6. 給 Claude Code 的開發指示建議

- 開發順序：功能一 MVP → 上架第一版 → 功能二 → 更新版（分兩次審核，降風險）
- 每完成一個模組即在 `chrome://extensions` 實測，不要一次寫完才測
- `subtitle-provider.ts` 開發前先寫一個獨立驗證腳本確認當前 YouTube 字幕取得方式可行
