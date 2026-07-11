# CHANGELOG

## 2026-07-11
- 新增專案 skill `/commit-session`（`.claude/skills/commit-session/SKILL.md`）：只 commit 當前視窗（對話）異動的檔案；同一檔案被多視窗編輯時，以「HEAD 版重套自己的修改 → hash-object 寫進 index」選擇性 staging，不夾帶其他視窗未收尾的修改。看板同日新增 #14（用 Claude Design 優化 UI/UX）
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
