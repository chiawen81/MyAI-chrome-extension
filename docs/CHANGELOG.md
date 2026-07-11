# CHANGELOG

## 2026-07-11
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
