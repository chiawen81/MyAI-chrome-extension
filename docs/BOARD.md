# BOARD — 任務看板

> 專案的 Trello：所有「想做但還沒做」的事都記在這裡（功能發想、bug、程式碼優化、SDD 調整）。使用約定見檔尾。

## 💡 發想（還在想，未定案）

<details>
<summary>#8 [功能] Claude 助手：整頁「請 Claude 翻譯此頁」右鍵動作 — 先不做（觀察中）</summary>

- 動機：逛英文網站時想要整頁翻譯的右鍵入口（2026-07-11 測試回饋）。
- **決議（2026-07-11）：先不做**——與功能一（整頁雙語對照翻譯，Alt+T／popup）定位重疊：雙語對照可原地閱讀、有快取、惰性只翻視口；交棒 claude.ai 則整頁進對話、超長會截斷、回應是純文字聊天訊息。整頁閱讀型翻譯以功能一為主。
- 重啟條件：觀察動作 4（翻譯＋摘要）＋功能一是否覆蓋需求，若日常使用仍常缺這個入口再重啟討論。

</details>

<details>
<summary>#14 [優化] 用 Claude Design 優化整體 UI/UX</summary>

- 動機：想利用 Claude 新推出的 Claude Design 來優化外掛的 UI/UX（2026-07-11）。
- 待討論：先盤點優化範圍（popup／options／YouTube 面板／譯文樣式預設集），再評估 Claude Design 的產出如何落地到現有 scoped class 架構（content script 禁用框架與全域樣式的硬性限制仍適用）。

</details>

<details>
<summary>#13 [功能] 翻譯服務：貼上 API key 自動偵測可用模型</summary>

- 動機：使用者貼 key 後不想手動查模型名稱，希望系統自動填入「模型名稱」欄位（2026-07-11）。
- 待討論：一把 key 通常可用**多個**模型，無法唯一對應——較可行的做法是貼 key 後呼叫供應商的 models 列表 API（Anthropic／OpenAI 皆有 `/v1/models`），把模型欄位從手填改成下拉選單供挑選。
- 前置：manifest host_permissions 已涵蓋兩家 API domain，應不需加權限；需確認 models endpoint 回傳格式與過濾條件（排除 embedding 等非 chat 模型）。

</details>

<br>

## 📥 待辦（確定要做，尚未開工）

<details>
<summary>#6 [功能] Claude 助手：交棒時可指定 claude.ai 模型 — spike 待人工驗證</summary>

- 動機：交棒後預設用 claude.ai 當下選的模型（常是最高階款），摘要／翻譯類任務用 Haiku 等輕量模型即可，避免浪費訂閱用量（2026-07-11 測試回饋）。
- 構想：options「Claude 助手」分頁加模型選項，帶入時自動切換。
- 前置：需 Task 0 式 spike 驗證切換方式（URL 參數或 DOM 操作模型選單，皆屬 claude.ai 未公開結構）。
- 2026-07-11 spike 步驟已設計（暫存 `_temp/spike-6-model-select.md`，不進版控；結果回填計畫附錄後可刪）：順序「B：DOM 掃描切換（順帶挖模型內部 id）→ A：URL 參數」，並驗證**持久性**（切換是否改掉帳號後續新對話的預設模型，直接影響 Spec 對策）。
- 下一步：使用者執行 spike 回報結果 → 建計畫文件（`docs/plans/`）審閱 → 通過後開工並移進行中。

</details>

<details>
<summary>#9 [SDD] 建立程式碼最佳實踐準則</summary>

- 動機：程式碼量漸增，需要基本準則避免日後疊床架屋（2026-07-11）。
- 構想：盤點現有 code 歸納既有慣例＋補上準則（如模組邊界、重複邏輯抽取時機、檔案長度），落地為文件（獨立檔或併入 DEVELOPMENT.md）並接入開發流程。

</details>

<details>
<summary>#11 [功能] 樣式設定：自訂顏色改用色盤選色＋即時預覽</summary>

- 動機：目前自訂文字色／背景色要手輸色票，看不到顏色（2026-07-11）。
- 構想：色票輸入框旁顯示顏色預覽，或直接改用 `<input type="color">` 點開色盤選色、選完即時回填色票值（兩者可並存：color input＋文字欄位雙向同步）。

</details>

<details>
<summary>#12 [功能] 樣式設定：預設樣式加「粗體」＋字型欄位提供選項</summary>

- 動機：2026-07-11 使用回饋。
- 範圍：(a)「預設樣式」下拉加「粗體」預設集（依 DEVELOPMENT.md 新增樣式預設集步驟）；(b)「字型」由自由填寫改為提供常用選項（下拉或 datalist，保留自訂輸入）。

</details>

<details>
<summary>#4 [優化] 導入 vitest 單元測試</summary>

- 範圍與優先序見 docs/TESTING.md 第 1 節。

</details>

<details>
<summary>#5 [SDD] Chrome Web Store 正式打包與提交流程</summary>

- FEATURES.md 驗收條件 #7 尚未驗證。

</details>

<br>

## 🚧 進行中

_（空）_


<br><br>
<details>
<summary>✅ 已完成（點擊展開）</summary>

- 2026-07-11 #3 [功能] 右鍵選單 Claude 助手（五動作交棒 claude.ai）— [plans/archive/2026-07-10-context-menu-claude-actions.md](plans/archive/2026-07-10-context-menu-claude-actions.md)
- 2026-07-11 #7 [功能] Claude 助手：新增「請 Claude 摘要選取文字」動作 — 併入 #3 計畫（見其 §2.8-bis）
- 2026-07-11 #10 [SDD] 調整任務執行節奏：連續執行、收尾前才停下驗收（特例於計畫階段標註停點）— 已落地 CLAUDE.md 與 DEVELOPMENT.md
- 2026-07-10 #1 [Bug] 修復注入競態與首屏渲染過慢 — [plans/archive/2026-07-10-fix-injection-race-and-slow-first-paint.md](plans/archive/2026-07-10-fix-injection-race-and-slow-first-paint.md)
- 2026-07-10 #2 [SDD] 建立核心文件（ARCHITECTURE／DEVELOPMENT／FEATURES／TESTING）與 commit 規範 — 詳見 CHANGELOG

</details>
<br><br><br>



## 📖 附件：任務看板使用約定

<details>
<summary>點擊查看</summary>

- 狀態流：💡 發想 → 📥 待辦 → 🚧 進行中 → ✅ 已完成（收進摺疊區）。
- 每個項目一律用 `<details>` 收納：`<summary>` 放 `#編號 [類型] 標題`，展開內容放細節（背景、決策、連結、下一步）；類型四種：`[功能]`、`[Bug]`、`[優化]`、`[SDD]`。
- 編號為全域流水號，跨欄位不重複、刪除不回收；**下一個編號：#15**（新增項目後記得遞增此數字）。
- 💡／📥 階段**不需要**計畫文件，一行想法即可；進入 🚧 時才依既有規則建 `docs/plans/YYYY-MM-DD-<feature>.md`，並在項目細節回填連結。
- 完成時照既有流程（計畫歸檔＋CHANGELOG），看板項目移到 ✅ 摺疊區、收成一行、前面加完成日期；細節看 CHANGELOG 與歸檔計畫，這裡只留索引。
- 項目有任何**決策結論**（做／不做／擱置／方向調整）時，當下就回寫到項目細節（日期＋結論），`<summary>` 同步標註狀態——決策只留在對話紀錄等於沒記。
- 討論後**暫不做**的項目：留在 💡 發想，細節記錄決議與重啟條件，`<summary>` 標「先不做（觀察中）」；**確定不做**的項目才直接刪除（git 歷史就是墓園，不另設欄位）。

</details>
