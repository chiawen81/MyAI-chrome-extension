# 修復：Claude 助手 Chat／Cowork 改版後文字可填入但無法自動送出

> 對應看板：#23 [Bug]
> Issue 文件：[../issues/2026-08-25-Claude助手-Chat-Cowork自動送出失效.md](../issues/2026-08-25-Claude助手-Chat-Cowork自動送出失效.md)
> 建立日期：2026-09-09
> 狀態：**待審閱後實作**（Task 0／0-B 觀測皆已完成，結論已回寫，修復方案 F1／F2／F4／F5 已定案）

<br><br>

## 🔸 1. User Story

身為使用擴充功能的讀者，
我想要右鍵選單的 Claude 助手動作（摘要此頁／摘要選取文字／翻譯／翻譯＋摘要）能真的把內容送出到 claude.ai，
以便我不必在跳轉過去後再手動按一次 Enter，也不會在 Chrome 擴充功能錯誤頁看到誤導性的紅字而以為外掛壞了。

<br><br>

## 🔸 2. Spec

### 🔹 2.1 根因分析

現行實作（`src/content/claude-inject/index.ts`）的送出路徑是 2026-07-11 對舊版 `claude.ai/new` Chat 介面人工驗證的產物：

```text
waitForInput()                 → div.ProseMirror[contenteditable="true"]
execCommand('selectAll')
execCommand('insertText', text)
findSendButton()               → 全頁掃 button[aria-label]，比對 /send/i
  ├─ 找到且非 disabled → click() → 回報 submitted: true
  └─ 輪詢 5 秒仍找不到 → console.warn(...) → 回報 { ok: true, filled: true, submitted: false }
```

以下五個弱點導致 Claude 改為 Chat／Cowork 共用首頁後失效，右欄為 spike 後的逐項判定：

| # | 弱點 | 後果 | spike 判定 |
|---|---|---|---|
| A | 送出鈕靠 `aria-label` 比對 `/send/i`，且掃描**全頁**無 composer 範圍限制 | Cowork 模式的送出鈕 label 不含 "send"，比對不到 → 等滿 5 秒降級 | ✅ **確認為本次唯一根因** |
| B | 寫入只用 `execCommand('insertText')`，疑未同步新版編輯器前端狀態 | 畫面有字但送出鈕不出現或維持 disabled | ❌ **證偽**，見下 |
| C | 交棒一律開 `claude.ai/new`，未辨識 Chat／Cowork 模式 | 使用者上次停在 Cowork 時沿用 Cowork，落到不同的送出鈕 | ⚠️ **成立，但成因與原推測不同**，見下 |
| D | 降級用 `console.warn()` | Chrome 把 content script warning 收進擴充功能錯誤頁，更新時看起來像載入失敗 | ✅ 確認（設計缺陷，與 spike 無關） |
| E | 只憑 `click()` 未拋錯就回報 `submitted: true` | 點到錯的按鈕或點了沒生效也算成功，無法察覺 | ✅ 確認（設計缺陷，與 spike 無關） |

#### spike 實測資料（2026-09-09，Chat 與 Cowork 各一輪）

編輯器兩模式一致，現有 selector 仍有效：

```text
editor: { tag: 'DIV', className: 'tiptap ProseMirror', role: 'textbox',
          ariaLabel: 'Write your prompt to Claude' }
→ div.ProseMirror[contenteditable="true"] 仍命中（className 由 'ProseMirror' 變 'tiptap ProseMirror'，
  class 選擇器不受影響）
```

送出鈕在兩模式的差異：

```text
Chat（URL: https://claude.ai/new）
  initial              → aria-label 'Send me…'  data-testid 'chat-in…'  disabled: true
  1s after execCommand → aria-label 'Send me…'  data-testid 'chat-in…'  disabled: false ✅

Cowork（URL: https://claude.ai/new ← 與 Chat 相同）
  initial              → 無任何送出鈕（按鈕總數 5）
  1s after execCommand → aria-label 'Start t…' data-testid 'chat-in…'  disabled: false（按鈕總數 6）
                          ↑ 不含 "send"，現有 /send/i 比對不到 → 5 秒逾時降級
```

**弱點 B 證偽**：兩模式在 `1s after execCommand` 時送出鈕皆已出現且 `disabled: false`，**不需**人工鍵入 `x` 才啟用。`execCommand('insertText')` 對新版 tiptap 編輯器的狀態同步是有效的，維持現行寫入方式即可。

**弱點 C 成因修正**：原推測「Cowork 會落在 `/cowork/...` 路徑」**不成立**——兩模式的 URL 都是 `https://claude.ai/new`，Chat／Cowork 是 composer 內的 toggle 且會記住上次選擇，不反映在網址。因此**任何 URL 參數／路徑做法都無法指定模式**，F1 必須改由 DOM 操作切換（見 §2.3）。

**新發現的穩定錨點**：`data-testid` 在兩模式皆相同，是比 `aria-label` 更穩定的識別依據——單靠它即可同時涵蓋 Chat 與 Cowork，這是本次修法的核心。

#### 補充觀測資料（Task 0-B，2026-09-09）

送出鈕的完整識別，以及 composer 內其他控制項：

```text
data-testid="chat-input-send"    aria-label: Chat 為 "Send message"、Cowork 為 "Start task"
data-testid="chat-input-attach"  aria-label="Add files, connectors, and more"
data-testid="model-selector-dropdown"  aria-label="Model: Opus 5 High"
→ composer 區塊的控制項皆有 data-testid，是該區的設計慣例而非偶然，可放心採用
```

Chat／Cowork 切換是**標準 ARIA radiogroup**（非 `<button>`，故上一輪的按鈕掃描沒撈到）：

```text
<div role="radiogroup">                     ← composer 內
  └ <span role="radio" aria-checked="…">    ← 內含 <span class="text-footnote">Chat</span>
  └ <span role="radio" aria-checked="…">    ← 內含 <span class="text-footnote">Cowork</span>

實測 aria-checked 對照：
  選中 Cowork → Chat: false、Cowork: true
  選中 Chat   → Chat: true 、Cowork: false
```

→ **模式的判斷與切換都有可靠依據**，F1 可行，`F1'` 退路不啟用，§2.4 驗收條件全數維持。

<details>
<summary>展開：為何 background 不會走 <code>?q=</code> 備援</summary>

`handoffToClaude()`（`src/background/service-worker.ts`）的判斷是 `if (!response.filled) throw`。本情境 `filled: true`、`submitted: false`，不觸發 throw，因此不進備援。

這個設計是刻意的且**應維持**：文字已完整填入輸入框，此時改導向 `?q=`（上限 2000 字元）反而會截斷長內容。備援只應在「連輸入框都找不到」時啟動。

</details>

### 🔹 2.2 現況 vs 預期行為

| 情境 | 現況 | 預期 |
|---|---|---|
| Chat 起始，四種自動送出動作 | 文字填入，等 5 秒後降級，未送出 | 成功送出 |
| Claude 停在 Cowork 模式時交棒 | 沿用 Cowork（URL 仍是 `/new`），送出鈕 label 為 `Start task` 比對不到 → 未送出 | 切回一般 Chat 並送出，不建立 Cowork 任務 |
| 「將選取文字帶入 Claude」 | 只填不送（正確） | 維持只填不送 |
| 找不到送出鈕 | `console.warn` → Chrome 錯誤頁出現紅字 | 保留文字、靜默／資訊級降級，錯誤頁不出現 |
| 找不到輸入框 | 走 `?q=` 備援（正確） | 維持 |
| 點擊送出後 | 未驗證，一律回報成功 | 驗證輸入框已清空或訊息已建立才回報 `submitted: true` |

### 🔹 2.3 修復方案

**方案 F1：填入前切回一般 Chat**（弱點 C）
URL 做法已由 spike 排除（兩模式同為 `/new`），改為在 claude-inject 內以 DOM 操作處理：

```text
1. 從輸入框往上找 composer 容器
2. 在容器內找 [role="radiogroup"] 下的 [role="radio"]
3. 認出 Chat：優先以內文比對 'Chat'；比對不到則取第一顆（i18n 退路，實測 Chat 在前）
4. 若其 aria-checked !== 'true' → click()，短輪詢等 aria-checked 轉 true 後再填入
5. 找不到 radiogroup（例如已在既有對話中）→ 跳過，不視為錯誤
```

`F1'`（不強制切模式、把 Cowork 列為已知限制）**不啟用**——Task 0-B 已證實 `aria-checked` 可靠。

**方案 F2：改用 `data-testid` 辨識送出鈕＋範圍限縮到 composer**（弱點 A，**核心修法**）
偵測優先序，前者命中即用：

```text
1. composer 容器內 [data-testid="chat-input-send"]        ← 兩模式共用，最穩定
2. composer 容器內 button[type="submit"]
3. composer 容器內 aria-label 比對 /send|start|送出|傳送/i  ← 涵蓋 Cowork 的 "Start task"
4. 全頁掃描（維持舊行為，最後手段）

composer 容器 = 從輸入框元素往上找最近的 form／composer 祖先，找不到則退回 document
```

**方案 F3：~~輸入流程改為新版編輯器能接收的事件流~~**（弱點 B）— **[作廢]**
spike 證實 `execCommand('insertText')` 已能正確同步 tiptap 編輯器狀態（填入後送出鈕即 `disabled: false`），維持現行寫入方式，不做任何更動。

**方案 F4：送出後驗證**（弱點 E）
`click()` 後輪詢確認「輸入框已清空」或「訊息節點已新增」，成立才回報 `submitted: true`；逾時視為未送出，走 F5 降級（文字仍在輸入框）。

**方案 F5：降級改為不進 Chrome 錯誤頁的紀錄**（弱點 D）
「已填入但未送出」是預期內的優雅降級，改用 `console.info`／`console.log`；`console.warn`／`console.error` 僅保留給真正的非預期失敗（如找不到輸入框）。

<details>
<summary>展開：刻意不做的事</summary>

- **不改備援觸發條件**：`filled: true` 但未送出時仍不走 `?q=`，理由見 §2.1 摺疊區。
- **不加新的 message 型別或 storage key**：修復全數落在 `claude-inject/index.ts` 內部流程，`ASSISTANT_FILL` 契約（`ok / filled / submitted / error`）不變 → 不需動 `shared/messages.ts`；`assistant-prompts.ts` 的 URL 組法也不再更動（F1 改走 DOM）。
- **不主動支援 Cowork 任務流程**：F2 的 selector 順帶涵蓋 Cowork 的 `Start task`，是為了 F1 切換失敗時仍能送出的保險，不代表要支援「在 Cowork 內交棒」這個使用情境。

</details>

### 🔹 2.4 驗收標準（可勾選）

- [ ] 從一般 Chat 起始，四種需自動送出的動作（摘要此頁／摘要選取文字／翻譯／翻譯＋摘要）皆成功送出
- [ ] Claude 目前停在 Cowork 模式時交棒，仍進入預期的一般 Chat，不意外建立 Cowork 任務
- [ ] 「將選取文字帶入 Claude」維持只填不送
- [ ] 指定模型與不指定模型皆正常（`?model=` 仍生效）
- [ ] 換行、中文、英文及長內容可正確填入且送出
- [ ] 找不到輸入框時仍可走 `?q=` 備援
- [ ] 找不到送出鈕時保留文字，且 Chrome 擴充功能錯誤頁不再出現預期降級 warning
- [ ] 送出失敗時不會誤報 `submitted: true`
- [ ] `npm run build` 通過（非只有 `npm run typecheck`）

<br><br>

## 🔸 3. Tasks

> 對外行為欄：✅＝改變使用者可感知行為，➖＝不變

| # | Task | 影響檔案 | 對外行為 |
|---|---|---|---|
| 0 | ~~前置 spike~~ **✅ 已完成（2026-09-09）**：Chat／Cowork 各一輪，結論見 §2.1 | — | ➖ |
| 0-B | ~~補充觀測~~ **✅ 已完成（2026-09-09）**：`chat-input-send` 與 radiogroup `aria-checked`，結論見 §2.1 | — | ➖ |
| 1 | ~~依 spike 結果定案~~ **✅ 已完成**：§2.1 加註實測資料、B 證偽、C 成因修正；§2.3 改寫 F1／F2、F3 作廢 | 本計畫文件 | ➖ |
| 2 | F2：改用 `data-testid` 為首選＋composer 範圍限縮＋四層 fallback | `src/content/claude-inject/index.ts` | ✅ |
| 3 | ~~F3：輸入事件流程補強~~ **[作廢]**（spike 證偽，見 §2.3） | — | — |
| 4 | F4：送出後驗證（輸入框清空／訊息節點新增），逾時不回報成功 | `src/content/claude-inject/index.ts` | ✅ |
| 5 | F5：降級紀錄改資訊級，`warn` 僅留給非預期失敗 | `src/content/claude-inject/index.ts` | ✅ |
| 6 | F1：填入前以 radiogroup 的 `aria-checked` 偵測並切回 Chat 模式 | `src/content/claude-inject/index.ts` | ✅ |
| 7 | 執行 `npm run build`，確認 `dist/` 為最新版 | — | ➖ |
| 8 | **手動驗收（使用者執行）**：`chrome://extensions` 重新載入未封裝，依 §2.4 逐項勾選 | — | ➖ |
| 9 | 文件同步與收尾：CHANGELOG（一律）、FEATURES（行為變更）、計畫移入 `plans/archive/`、看板 #23 移入「已完成」 | `docs/reference/CHANGELOG.md`、`docs/reference/FEATURES.md`、本計畫文件、`docs/任務看板.md` | ➖ |

### 🔹 建議停點

- ~~Task 0 之後停~~ **已通過**（2026-09-09 完成）。
- ~~Task 0-B 之後停~~ **已通過**（2026-09-09 完成，toggle 有可靠識別依據，採 F1）。
- **Task 7 之後停**：Task 2–7 為實作類，連續執行到底；build 完成後停下，由使用者於 `chrome://extensions` 手動驗收，通過後才做 Task 9 收尾。

<br><br>

## 🔸 4. 風險與備註

- **claude.ai 隨時可能再改版**：本次修復的價值一半在 F2／F4／F5 的**韌性**（範圍限縮、送出驗證、降級不噪音），即使 selector 日後再失效，行為也只會退回「保留文字待手動送出」，不會誤報成功或污染錯誤頁。
- **DOM 依賴仍集中單一檔案**：修復維持 `claude-inject/index.ts` 是唯一碰 claude.ai DOM 的地方（ARCHITECTURE §1 的隔離慣例），下次改版仍只需修這一檔。
- **測試**：專案尚未導入 vitest（看板 #4），本次仍以手動驗收為主；`findSendButton` 範圍限縮邏輯若拆成純函式，可列為 #4 導入後的候選測試對象。
- **F1 的兩個殘留風險**（實作時需在註解標明，UAT 需特別確認）：
  1. 認出 Chat 的主要依據是內文字串 `'Chat'`，claude.ai 若做 i18n 會失效——已備第一顆 radio 的位置退路，但位置同樣可能改變；失效時的行為是「不切換模式」而非報錯，最壞情況退化為 F1'。
  2. `role="radio"` 掛在 `<span>` 而非 `<button>`，`.click()` 是否能觸發 React 的狀態更新需於 UAT 實測；若無效需改送完整的 pointer 事件序列。

<br><br>

## 🔸 5. 變更紀錄

| 日期 | 變更 |
|---|---|
| 2026-09-09 | 建立計畫（Fix 計畫，場景四）；Task 0 spike 未執行，§2.3 標 🔍 者待 spike 定案 |
| 2026-09-09 | Task 0 spike 完成，依結果回寫：①§2.1 補實測資料與判定欄；②**弱點 B 證偽** → F3、Task 3 標記 [作廢]；③**弱點 C 成因修正**（兩模式同為 `/new`，URL 做法無效）→ F1 改為 DOM 切換 toggle，影響檔案由 `assistant-prompts.ts` 改為 `claude-inject/index.ts`，並備妥 F1' 退路；④新增 `data-testid` 為 F2 首選錨點（兩模式共用）；⑤新增 Task 0-B 補充觀測與對應停點 |
| 2026-09-09 | Task 0-B 補充觀測完成：送出鈕定為 `[data-testid="chat-input-send"]`；Chat／Cowork 確認為 ARIA radiogroup，`aria-checked` 可判斷與切換 → F1 定案（步驟寫入 §2.3）、`F1'` 不啟用、驗收條件全數維持；§4 補記 F1 的 i18n 與 span-click 兩項殘留風險 |
