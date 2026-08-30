# CHANGELOG

## 2026-08-30
- 完成看板 #22「重新設計 YouTube 播放器的雙語字幕圖示」：以 `currentColor` 圓角線性機器人 SVG 取代粗體「譯」字，保留圓形天線與友善表情並降低實心面積，使視覺重量貼近 YouTube 原生控制圖示；按鈕改用固定 48px 的 inline-flex 容器置中 28px 圖示，明確清除 YouTube 套用於 SVG 的 padding／margin，修復圖示溢位與位置偏移。新增 hover、載入呼吸動畫、啟用紅色狀態線，以及 `aria-expanded`／`aria-pressed`／`aria-busy`／狀態標籤同步；換片、啟動失敗與關閉字幕時會還原狀態。使用者於一般播放器手動驗收，確認位置不再跑版且最終圖示通過。

## 2026-07-14
- 完成看板 #20「YouTube 字幕首批翻譯等待優化」：首批固定縮小為 10 句並單獨先送，完成渲染後其餘批次才依共用並發數進入並發池，避免小首批與大批同時請求造成供應商端排隊；批次回應依原索引亂序漸進補上，進度改按實際完成句數累加。任一批失敗時停止派發新批、保留已完成譯文，僅全部成功才寫影片級整包快取。UAT 實測首批約 10 秒出現譯文，25 分鐘／280 句影片約 1 分 40 秒翻完，使用者確認結案；「不要一次翻完整部、改跟隨播放位置」留待看板 #21。
- SDD 流程修訂（依 #19 實例）：①場景三／四分界從「單檔＋不改變對外行為」改為「根因已定位＋單檔＋行為變化小（經使用者當場確認）→ 場景三；仍需診斷或 spike／跨多檔案／行為變更需明確驗收條件 → 場景四」——根因與修法已寫在看板條目時，再開計畫文件只是資訊重複（SDD操作指南.md 場景分派與 3-A／4 章節、`.claude/commands/sdd-fix.md` 同步修訂）②CLAUDE.md 關鍵規則新增：改動要交使用者測試／驗收前先跑 `npm run build`，只跑 typecheck 不算（#19 驗收曾因拿舊 build 撲空）
- 完成看板 #19「YouTube 面板：換片後不會收合，字幕軌下拉變成空清單」（小修，僅動 `src/content/youtube/index.ts`）：根因為換片時 `teardownSession()` 先把 `session` 設為 null 才呼叫 `updatePanelForNewVideo()`，面板開著時觸發的 `populateTracks()` 因 session 為 null 提前 return，清單清空後不再回填、新 session 建立後也無面板刷新。修正為換片時在 `setupForVideo()` 建立新 session 後才執行「重置面板＋回填清單」；離開 watch 頁（無新影片）時直接收合面板

## 2026-07-13
- 完成看板 #18「YouTube 雙語字幕：timedtext 回 200 空 body 被誤判為格式無法解析」（僅動 `subtitle-provider.ts`）：①空回應／非預期內容前置檢查，錯誤訊息依失敗型態分類（原本空字串直接進 JSON.parse／DOMParser，拋出誤導的「YouTube 可能已改版」）②格式 fallback 鏈 `fmt=json3`→`fmt=srv3`→預設 XML→去 `variant` 參數重試（XML 解析器順帶支援 srv3 `<p t d>` 變體）③InnerTube 備援——spike 實錘根因為 YouTube 對 timedtext 要求 pot（proof-of-origin）token、缺 pot 回 200 空 body，而 ANDROID client 經 `youtubei/v1/player` 取得的 baseUrl 不需 pot（`?key=` 可省略；baseUrl 已含 fmt 需用 URL API 設定），原始 baseUrl 全空時自動走此路徑重試（`CaptionTrack` 增 `videoId` 欄位）。不需 main-world 注入、不改 manifest。spike 以 Playwright CDP＋拋棄式 profile 全自動完成（四輪，紀錄收計畫附錄含最小重現）。手動驗收通過（三部影片）。計畫文件 `2026-07-13-修復-YouTube字幕空回應誤判為格式錯誤.md` 歸檔。驗收中另回報既有問題入看板：#19 換片後面板字幕軌清單未刷新、#20 首批翻譯等待過久
- SDD 流程新增計畫文件格式規範（docs/plans/ 下所有計畫文件適用，含 Fix 計畫）：段落標題用 🔸／子標題用 🔹、🔸 標題前插 `<br><br>` 拉開區塊間距（Markdown 預覽會折疊純空行，只空行看不出間距；子標題前與段落間不插）、使用者操作動線與程式碼解說用程式碼區塊、過細內容用 `<details>` 收納（摘要留外層）。同步更新 CLAUDE.md 關鍵規則、`/sdd-plan` 指令、SDD操作指南範本 1-A／2-A／4-A

## 2026-07-11
- 完成看板 #11「樣式設定：自訂顏色改用色盤選色＋即時預覽」：options「樣式」分頁文字色／背景色文字欄位旁新增 `<input type="color">` 色盤（`index.html`），與文字欄位雙向同步（`options.ts`）——新增 `cssColorToHex()` 用暫存 DOM 元素解析任意 CSS 顏色字串（hex 3/6 碼、具名色、`rgb()`/`rgba()`）為 6 碼 hex；色盤選色會覆寫回文字欄位並觸發既有存檔流程，文字欄位手動輸入合法顏色只同步色盤色塊、不覆寫文字欄位原值（保留具名色與透明度資訊），無法解析時色盤維持前一個有效值。首次套用時因 `.field input { width: 100% }` 特異性高於新增的 `.color-swatch`，色盤被撐成滿版，改用更高特異性選擇器（`.field .color-field-row input[type='color'].color-swatch`）修正。`StyleSettings` 資料結構不變。手動驗收通過。計畫文件 `2026-07-11-style-color-picker.md` 歸檔
- 完成看板 #12「樣式設定：預設樣式加「粗體」＋字型欄位提供選項」：`StylePresetId` 新增 `bold`（`shared/types.ts`）、`PRESET_RULES` 補對應 CSS 宣告 `font-weight: 700 !important`（`shared/styles.ts`）、options「樣式」分頁「預設樣式」下拉新增「粗體」選項；「字型」欄位改為 `<input list>` + `<datalist>`（8 種中英文常見字型），維持自由輸入不受限、不影響既有已儲存的自訂字型值、`options.ts` 讀寫邏輯不需變動。手動驗收通過。計畫文件 `2026-07-11-style-bold-preset-font-options.md` 歸檔
- docs/SDD-GUIDE.md 第 7 節納入兩個**使用者層級** skill 的用法（新增 7.2／7.3 小節與自動化評估表格列，並補「專案層級 vs 使用者層級 skill」說明）：`/pim-note`（把對話知識分主題做成 PIM 卡片寫入 Notion，經 claude.ai Notion 連接器；可帶範圍參數限定主題）、`/meta-learning`（任務後四段式學習回顧，只輸出不寫 Notion，可串接 /pim-note）。skill 定義檔在 `C:\Users\Wen\.claude\skills\`，不隨本 repo 版控。同時更新第 0 節場景分派總覽流程圖：各場景加註對應指令（/sdd-plan、/sdd-fix 等），新增「驗收後收尾」（/sdd-done → /commit-session）與「隨時可用」（/meta-learning → /pim-note）兩段指令鏈；第 7 節表格補標 /sdd-plan、/sdd-fix、/sdd-done 為已建置（`.claude/commands/` 檔案實際存在）
- 完成看板 #6「Claude 助手：交棒時依動作指定 claude.ai 模型」：options「Claude 助手」分頁每張動作卡新增「交棒模型」下拉（Haiku 4.5／Sonnet 5／Opus 4.8／Fable 5，預設「跟隨 claude.ai 目前選擇」），有指定時交棒網址帶 `?model=<slug>`、`?q=` 備援同步帶上；`Settings` 新增巢狀欄位 `assistantModels`（`loadSettings()` 深合併補此層 spread），模型清單常數 `ASSISTANT_MODELS` 與純函式 `buildNewChatUrl()` 集中於 `shared/assistant-prompts.ts`（`buildFallbackUrl()` 加選填 model 參數）。手動驗收通過（依動作各選模型生效）；**實測修正 spike 結論**：claude.ai 以「上次使用的模型」為新對話預設，交棒送出後仍會影響後續新對話的預設模型（claude.ai 自身行為，列 FEATURES.md 已知限制）。計畫文件 `2026-07-11-assistant-model-select.md` 歸檔
- `/commit-session` skill 增補步驟 6：commit 後統計本視窗 token 用量並換算 Claude API 等值費用（新增 `count-session-tokens.py`，讀 session 逐字稿依 requestId 去重、按模型分組計價；定價表寫死於腳本）；同視窗多次 commit 時以 scratchpad 標記檔分段，回報「本段（自上次成功 commit 後）」與「視窗累計」兩組數字，步驟 1 同步加註「已成功 commit 過即只盤點其後異動」避免重跑空 diff；步驟 2 改為一次 `git diff` 帶入全部檔案再逐檔判讀（原逐檔各跑一次，每輪工具呼叫都重讀整個對話 context，N 檔 N 輪是主要 token 浪費點）；`/commit-session` 用法納入 docs/SDD-GUIDE.md 第 7 節（新增 7.1 小節與自動化評估表格列）
- 新增專案 skill `/commit-session`（`.claude/skills/commit-session/SKILL.md`）：只 commit 當前視窗（對話）異動的檔案；同一檔案被多視窗編輯時，以「HEAD 版重套自己的修改 → hash-object 寫進 index」選擇性 staging，不夾帶其他視窗未收尾的修改。看板同日新增 #14（用 Claude Design 優化 UI/UX）
- 完成看板 #6 前置 spike（claude.ai 模型切換可行性）並定案機制：URL 參數 `?model=<slug>` 有效、每分頁獨立、**不污染帳號預設模型**、可與 `?q=` 併用；DOM 操作選單雖可行但會永久改掉帳號預設（伺服器端）故不採。計畫文件 `2026-07-11-assistant-model-select.md` 建立（審閱通過：依動作各選模型），spike 原始紀錄收計畫附錄
- DEVELOPMENT.md 新增「Spike 驗證方法」節：Task 0 式 spike 慣例（結論回填 Spec、腳本收附錄供改版重跑）＋自動化執行做法（Playwright CDP 驅動拋棄式 profile 的獨立 Chrome 實例，使用者登入一次後全自動；含「關鍵結論用行為實測」與「收尾還原帳號狀態」原則）——由 #6 spike 實務歸納，供後續評估依賴未公開結構的新功能參考
- 新增功能三「右鍵選單 Claude 助手」（看板 #3＋#7）：http/https 頁面右鍵五動作——摘要此頁／摘要選取文字／帶入選取文字／翻譯／翻譯＋摘要，把內容「交棒」到使用者自己的 claude.ai 對話（開新分頁 → 注入 script 以 `execCommand('insertText')` 填入輸入框 → 除「帶入選取文字」外自動送出），外掛不呼叫 API、不扣費；注入失敗以 `?q=` 網址參數備援（上限 2,000 字元）
  - 摘要此頁以 `executeScript({func})` 擷取主內容（語意容器內收段落區塊＋雜訊排除 → 共同祖先啟發式 → body 回退）；測試回饋後補強「容器內也套過濾」並在預設模板加擷取雜訊提醒
  - 翻譯類動作選到中文（漢字 ≥ 50%）時原頁 confirm 確認；帶入內容超過 `assistantMaxChars`（預設 50,000）保留開頭截斷＋註記
  - options 新增「Claude 助手」分頁：各動作模板可自訂（必含 `{{content}}`、≤ 500 字元、清空還原預設）＋帶入字數上限；模板覆寫存獨立 sync key `assistantPrompts`
  - 新增權限：`contextMenus`＋`https://claude.ai/*` host；新訊息 `ASSISTANT_FILL`；claude.ai DOM 依賴依隔離慣例集中於 `content/claude-inject/`
  - 計畫文件 `2026-07-10-context-menu-claude-actions.md` 完成並歸檔（含 §2.8-bis 實作增補）
- 調整任務執行節奏規則（看板 #10）：實作類 task 連續執行到底，做到「文件同步與收尾」前停下等使用者驗收；必須先由使用者驗收／回報結果的 task（spike、需真實 key 的驗證等）於計畫階段標註建議停點。改動 CLAUDE.md 關鍵規則與 DEVELOPMENT.md 計畫流程第 2 步（原規則：每完成一個模組即停下）
- 新增 docs/BOARD.md 任務看板：發想／待辦／進行中／已完成四欄，收納功能發想、bug、優化與 SDD 調整項目；項目帶全域流水編號（#N），有細節的項目與已完成區、使用約定（置於檔尾）均以 `<details>` 摺疊。CLAUDE.md 關鍵規則與 DEVELOPMENT.md 計畫流程接入看板維護（想法先上板 → 開工建計畫並連結 → 完成移入摺疊區）

## 2026-07-10
- 新增 docs/COMMIT-CONVENTION.md：commit 訊息格式規範（八種 type 前綴＋中文 scope、數字列點父子層 body、可讀性原則）；CLAUDE.md 關鍵規則加入純文字連結（不用 @ 引入以省 token）
- 綁定 GitHub 版控：git init（main 分支）、.gitignore 排除 _temp/、remote 綁 chiawen81/MyAI-chrome-extension
- 修復注入競態：background 注入網頁翻譯 content script 後輪詢 PING（100ms × 最多 20 次）等待就緒才轉發指令；修掉「第一次按顯示此頁面無法翻譯、第二次才動」的問題（根因：CRXJS `?script` 載入器以非同步 import 載入真正模組，executeScript 完成時 listener 尚未註冊）
- 網頁翻譯改為小組漸進渲染：content script 把待翻段落切成 ≤8 段／≤1200 字元的小組各自送翻，回應到達即渲染該組，不再等整批完成（首屏譯文由 ~30 秒縮短到數秒）
- 惰性翻譯預抓範圍由固定 200px 擴大為「上方 0.5、下方 2 個螢幕高」（rootMargin 百分比），往下捲動時段落大多已翻好
- OpenAI Provider：reasoning 模型明確要求最低推理量——`gpt-5*`（`gpt-5-chat` 除外）帶 `reasoning_effort: 'minimal'`、`o1/o3/o4` 系列帶 `'low'`，其他模型請求不變；翻譯延遲大幅下降（實測整篇 BBC 文章清快取重翻 18 秒，首屏數秒內）
- popup 翻譯失敗時將原因放入按鈕 tooltip，2 秒後自動恢復按鈕文字可重試
- 計畫文件 `2026-07-10-fix-injection-race-and-slow-first-paint.md` 完成並歸檔
- 建立核心文件：ARCHITECTURE.md（四執行環境／訊息協定／storage 結構／Provider 擴充點／目錄）、DEVELOPMENT.md（命名規則與擴充步驟）、FEATURES.md（驗收對照與行為描述）、TESTING.md（vitest 規劃＋手動驗收清單）；CLAUDE.md「詳細文件」段落更新為實際索引
- 初始化開發流程骨架：CLAUDE.md、docs/plans/（含 archive/）、docs/CHANGELOG.md
- 跨 context 訊息型別自 shared/types.ts 抽出至 shared/messages.ts（types.ts re-export 維持相容）
