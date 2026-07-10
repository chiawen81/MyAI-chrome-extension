# BOARD — 任務看板

> 專案的 Trello：所有「想做但還沒做」的事都記在這裡（功能發想、bug、程式碼優化、SDD 調整）。使用約定見檔尾。

## 💡 發想（還在想，未定案）

_（空）_

<br>

## 📥 待辦（確定要做，尚未開工）

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

<details>
<summary>#3 [功能] 右鍵選單 Claude 助手 — 計畫待審閱</summary>

- 方向決策（2026-07-11）：採「交棒 claude.ai」方案——右鍵後把內容帶入使用者自己的 claude.ai 對話，外掛不呼叫 API、不扣費。
- 機制決策（2026-07-11）：DOM 注入為主（同 Glasp 模式，需 claude.ai host 權限）、`?q=` 參數備援；動作 1 擷取內文直接貼上。
- 計畫文件：[plans/2026-07-10-context-menu-claude-actions.md](plans/2026-07-10-context-menu-claude-actions.md)
- 下一步：計畫審閱 → Task 0 spike（claude.ai 注入行為人工驗證，需登入的瀏覽器）→ 通過才動工。

</details>


<br><br>
<details>
<summary>✅ 已完成（點擊展開）</summary>

- 2026-07-10 #1 [Bug] 修復注入競態與首屏渲染過慢 — [plans/archive/2026-07-10-fix-injection-race-and-slow-first-paint.md](plans/archive/2026-07-10-fix-injection-race-and-slow-first-paint.md)
- 2026-07-10 #2 [SDD] 建立核心文件（ARCHITECTURE／DEVELOPMENT／FEATURES／TESTING）與 commit 規範 — 詳見 CHANGELOG

</details>
<br><br><br>



## 📖 附件：任務看板使用約定

<details>
<summary>點擊查看</summary>

- 狀態流：💡 發想 → 📥 待辦 → 🚧 進行中 → ✅ 已完成（收進摺疊區）。
- 每個項目一律用 `<details>` 收納：`<summary>` 放 `#編號 [類型] 標題`，展開內容放細節（背景、決策、連結、下一步）；類型四種：`[功能]`、`[Bug]`、`[優化]`、`[SDD]`。
- 編號為全域流水號，跨欄位不重複、刪除不回收；**下一個編號：#6**（新增項目後記得遞增此數字）。
- 💡／📥 階段**不需要**計畫文件，一行想法即可；進入 🚧 時才依既有規則建 `docs/plans/YYYY-MM-DD-<feature>.md`，並在項目細節回填連結。
- 完成時照既有流程（計畫歸檔＋CHANGELOG），看板項目移到 ✅ 摺疊區、收成一行、前面加完成日期；細節看 CHANGELOG 與歸檔計畫，這裡只留索引。
- 不做了的項目直接刪除（git 歷史就是墓園，不另設欄位）。

</details>
