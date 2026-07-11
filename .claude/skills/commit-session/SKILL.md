---
name: commit-session
description: 只 commit 當前視窗（本次對話）異動的檔案。當使用者說「/commit-session」「commit 這個視窗的異動」「到一個段落了幫我 commit」時使用。多視窗並行編輯同一檔案時，以 index 選擇性 staging 只收本對話的修改。
model: sonnet
---

# commit-session — 只 commit 本對話的異動

此專案可能有多個 Claude Code 視窗同時工作。此 skill 只把「本次對話」造成的檔案異動 commit，**不得夾帶其他視窗未收尾的修改**。

## 步驟 0：檢查 index 是否乾淨

執行 `git diff --cached --name-only`。若已有 staged 內容且不是你本對話 stage 的，**停下來問使用者**（可能是其他視窗正在收尾，直接 commit 會把它們一起收進去）。

## 步驟 1：盤點本對話異動的檔案

- 本對話先前已執行過本 skill 且**確實產生 commit** 時，只盤點該次 commit 之後的異動（更早的異動已入庫，不必重跑 diff）。判斷基準是「commit 有沒有真的完成」：若前次執行中途被打斷、沒產生 commit，該次涵蓋的異動仍要納入這次盤點。
- 回顧本次對話中你用 Edit／Write／NotebookEdit／Bash 實際改動或新增的檔案，列成清單。
- **不要用 git status 反推**——status 裡的其他檔案可能是別的視窗改的。status 只用來交叉檢查你的清單有沒有漏。
- 若對話經過摘要（context 壓縮）而不確定清單完整，只列你確定的，並在最後回報中說明可能有遺漏。

## 步驟 2：逐檔判斷是否「乾淨」

**一次** `git diff -- <path1> <path2> …` 把清單中所有已追蹤檔案帶入（不要一檔跑一次——每次工具呼叫都重讀整個對話 context，逐檔跑是純浪費），再從輸出中逐檔判讀：

- 新增檔案（untracked，不會出現在 diff 輸出）→ 直接 `git add`。
- diff 的**所有** hunk 都是你本對話做的修改 → 直接 `git add`。
- 有任何 hunk 不是你改的（其他視窗動過同一檔）→ 走步驟 3 的選擇性 staging。
- **無法確定**某個 hunk 是不是自己改的 → 停下來問使用者，不要猜。
- 兩個視窗改到同一行（同一 hunk 內混合）→ 無法機械拆分，停下來問使用者。

## 步驟 3：混合檔案的選擇性 staging（不碰工作目錄）

前提：你本對話的修改已正常寫在工作目錄檔案裡（與其他視窗的修改混在一起）。做法是重建一份「HEAD ＋ 只有你的修改」的內容直接寫進 index：

1. `git show HEAD:<path> > <scratchpad>/staged-<檔名>` 取得 HEAD 版本。
2. 用 Edit 把你本對話的修改重新套用到這個暫存檔（照你當時的改法重做一次）。
3. `blob=$(git hash-object -w --path=<path> "<暫存檔>")`——`--path` 讓行尾轉換等 filter 規則與 repo 內該檔一致，不可省略。
4. `git update-index --cacheinfo 100644,$blob,<path>`。
5. `git diff --cached -- <path>` 逐行檢查：staged 內容必須**恰好**是你的修改，不多不少。

工作目錄全程不動，其他視窗之後 commit 該檔時會自然只剩它們的 diff。

## 步驟 4：commit

1. 先讀 `docs/reference/COMMIT-CONVENTION.md`，依規範撰寫訊息（`type(中文scope)` 標題＋數字列點 body＋Co-Authored-By 署名）。
2. `git diff --cached --stat` 最後確認檔案清單與預期一致（防止其他視窗在你操作期間 stage 了東西）。
3. `git commit`——**不要用 `-a`**，只 commit 已 staged 的內容。
4. 若遇到 `index.lock` 錯誤，是其他視窗同時在跑 git，稍候幾秒重試。

## 步驟 5：回報

- 回報 commit hash 與包含的檔案。
- 若 `git status` 仍有殘餘 modified，說明那些屬於其他視窗的工作，未包含在本次 commit。
- 步驟 1 若有「可能遺漏」的不確定性，此時一併說明。

## 步驟 6：本視窗 token 用量與費用回報

commit 完成後，回報本視窗（本次對話）累計的 token 用量與 Claude API 等值費用：

1. 取得本 session 的 id：系統提示「Scratchpad Directory」路徑中 `scratchpad` 的上一層目錄名（UUID 格式）。
2. 執行（標記檔固定放 scratchpad，第二個參數即系統提示中的 scratchpad 路徑＋檔名）：
   `python .claude/skills/commit-session/count-session-tokens.py <session-id> "<scratchpad>/commit-session-token-mark.json"`
   腳本會輸出「本段（自上次 /commit-session 後）」與「視窗累計」兩組數字，把輸出原樣附在回報末尾。
3. 附註提醒：此為「若走 Claude API 計價」的等值估算——訂閱方案實際不按 token 扣費；統計含 system prompt、cache 與 subagent 用量，且 cache 讀取（占大宗）單價僅為 input 的 1/10。

腳本細節（維護時參考）：資料來源為 `~/.claude/projects/*/<session-id>.jsonl` 逐字稿，依 requestId 去重後按模型分組加總；「本段」靠標記檔記錄上次算到的行數（逐字稿只增不減），**只有 commit 成功才執行本步驟**，故標記點即上次成功 commit 的位置；定價表寫死在腳本內（來源：Anthropic 官方 API 定價，cache 寫入＝input×1.25／×2、讀取＝×0.1），新模型上市時需手動更新 `PRICES`。
