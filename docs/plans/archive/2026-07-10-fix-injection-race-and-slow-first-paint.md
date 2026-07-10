# 修復：注入競態（此頁面無法翻譯）與譯文首現過慢

## User Story

作為使用者，我在任意英文網頁按下 popup 的「翻譯此頁」後：
1. 第一次按就要開始翻譯，不應出現「此頁面無法翻譯」還得再按一次；
2. 譯文應在數秒內**逐批漸進**出現（比照沉浸式翻譯的體感），而不是全部「翻譯中…」佔位 30 秒後一次跳出。

## Spec

### 根因分析

#### 異常 2：第一次按顯示「此頁面無法翻譯」，第二次按才動 — 注入競態

流程：popup `POPUP_TOGGLE` → background `toggleTab()` → `ensureWebTranslateScript()`：

1. `PING` 失敗（script 尚未注入）→ `chrome.scripting.executeScript` 注入 `webTranslateScript`。
2. **關鍵**：CRXJS 的 `?script` import 產出的是一個「載入器」檔案，它在頁面上以
   `import(chrome.runtime.getURL(...))` **非同步**載入真正的 content script 模組。
   `executeScript` 在載入器執行完就 resolve，但此時 `onMessage` listener 還沒註冊。
3. `toggleTab()` 緊接著送 `TOGGLE_TRANSLATE` → 拋出
   `Could not establish connection. Receiving end does not exist.` → 回 `ok: false`
   → popup 顯示「此頁面無法翻譯」。
4. 使用者第二次按時，真正的模組早已載入完成，`PING` 成功 → 翻譯正常啟動。

次要問題（popup.ts:87-91）：失敗時按鈕文字固定顯示「此頁面無法翻譯」，把
`result.error` 丟掉了——注入競態、真的不能注入的頁面（chrome:// 等）、其他錯誤
全部長一樣，使用者無從分辨。

#### 異常 1：譯文要 ~30 秒才出現 — 三因素疊加

1. **整包等待才渲染**（content/web-translate/index.ts `flushPending`）：
   首屏所有段落在 400ms 收集窗口合併成**單一** `TRANSLATE_BATCH` 訊息；
   background 雖然切成子批次並發送 API，但 `handleTranslateBatch` 用
   `Promise.all` 等**全部**子批次完成才回應，content script 收到後才一次渲染。
   首現時間 = 最慢的那個子批次。
2. **子批次過大且無法部分顯示**：上限 30 段 / 3000 字元，模型必須生成完整
   JSON 陣列才算一次回應（非串流），單次 completion 天然就慢。
3. **reasoning 模型未限制推理量**（providers/openai.ts）：使用者用
   `gpt-5-mini`（reasoning 模型），請求未帶 `reasoning_effort`，預設推理會在
   輸出任何字之前先燒大量時間；翻譯任務不需要深度推理。

沉浸式翻譯的做法即「小批次、各自請求、回來一批渲染一批」，所以 1–3 秒就開始出字。

#### 異常 3：初期試用時 DevTools console 的錯誤訊息 — 非本外掛

回報情境：剛開始試用時（與沉浸式翻譯同時開啟、於 dev.to 頁面），DevTools console
出現大量警告與資源載入錯誤，之後無法重現。訊息內容經比對來源皆非本外掛：

- `Immersive Translate WARN: [imt-insert-skip] already translated`（來源 `content main.js`）：
  沉浸式翻譯外掛自己的 log，警告節點已翻譯過而跳過。
- `Failed to load resource: net::ERR_NETWORK_IO_SUSPENDED`
  （資源位於 `gc.kis.v2.scr.kaspersky-labs.com`）：卡巴斯基防毒注入頁面的
  script 載入失敗，與翻譯功能無關。

兩者皆與本外掛無關，無需修復。附帶說明：與沉浸式翻譯**同時開啟**時，對方插入的
譯文節點沒有 `data-bt-translation` 屬性，本外掛的 MutationObserver 重掃會把對方的
中文譯文也送去翻譯（浪費 token）。屬共存情境的已知限制，記入 FEATURES.md，不在
本次修復範圍；驗收測試時建議停用沉浸式翻譯。

### 現況 vs 預期行為

| 情境 | 現況 | 預期 |
|---|---|---|
| 未注入過的頁面第一次按「翻譯此頁」 | 顯示「此頁面無法翻譯」，需再按一次 | 第一次按就開始翻譯 |
| 翻譯啟動後 | 全頁「翻譯中…」佔位，~30 秒後一次全部出現 | 數秒內第一批譯文出現，其餘逐批補上 |
| 真的無法注入的頁面（chrome:// 等） | 同樣顯示「此頁面無法翻譯」 | 維持現行提示（此為正確行為） |
| popup 顯示失敗後 | 按鈕文字卡在「此頁面無法翻譯」 | 顯示具體錯誤，稍後恢復可再操作 |

### 修復方案

1. **注入後等待 content script 就緒**（service-worker.ts）：
   `ensureWebTranslateScript` 在 `executeScript` 之後輪詢 `PING`
   （每 100ms 一次、上限約 2 秒），成功才視為就緒；逾時才拋錯。
   徹底消除競態，不依賴載入器的實作細節。
2. **小批次 + 漸進渲染**（content/web-translate/index.ts）：
   `flushPending` 把待送段落切成小組（上限 8 段 / 1200 字元），每組**各自**送一則
   `TRANSLATE_BATCH`，回應到達即渲染該組譯文，不等其他組。並發與費用控制仍由
   background 的 semaphore（預設 3）把關。background 的 3000/30 上限保留作為
   YouTube 與防呆用途，不改。
3. **降低 reasoning 模型延遲**（providers/openai.ts）：
   模型名以 `gpt-5` 或 `o` 系列（`o1`/`o3`/`o4` 等）開頭時，請求附
   `reasoning_effort: 'minimal'`（翻譯不需深度推理）；其他模型維持原請求不變，
   不影響舊模型相容性。
4. **popup 錯誤呈現**（popup.ts）：失敗時顯示 `result.error` 的簡短訊息
   （tooltip 放全文），2 秒後恢復按鈕原文字，可再次操作。

## Tasks

依 CLAUDE.md 規則，每完成一個 Task 停下，提示到 chrome://extensions 手動載入測試。

### Task 1：注入就緒輪詢（修異常 2）
- 檔案：`src/background/service-worker.ts`
- 內容：`ensureWebTranslateScript` 注入後輪詢 PING（100ms × 最多 20 次）；
  逾時拋出可讀錯誤。
- 對外行為：修正 bug（第一次按即可翻譯），無新增行為。
- 驗收：全新分頁開英文網站 → 第一次按「翻譯此頁」即出現「翻譯中…」佔位。

### Task 2：popup 錯誤訊息與按鈕恢復
- 檔案：`src/popup/popup.ts`
- 內容：失敗時顯示 `result.error` 摘要，2 秒後還原按鈕文字；按鈕不再卡死在
  「此頁面無法翻譯」。
- 對外行為：改變（錯誤提示更具體）→ 同步 FEATURES.md。
- 驗收：在 `chrome://extensions` 頁按翻譯 → 顯示無法注入的訊息、稍後按鈕恢復。

### Task 3：小批次 + 漸進渲染（修異常 1 主因）
- 檔案：`src/content/web-translate/index.ts`
- 內容：`flushPending` 內把 `pendingElements` 切成 ≤8 段 / ≤1200 字元的小組，
  每組獨立 `sendMessage` 並於回應時立即渲染；錯誤處理維持逐組（該組佔位移除、
  toast 一次）。
- 對外行為：改變（譯文漸進出現）→ 同步 FEATURES.md。
- 驗收：BBC 等新聞頁按翻譯 → 首批譯文數秒內出現、其餘逐批補上。

### Task 4：OpenAI reasoning 模型加 `reasoning_effort: 'minimal'`（修異常 1 次因）
- 檔案：`src/providers/openai.ts`
- 內容：模型名符合 `^(gpt-5|o\d)` 時請求附 `reasoning_effort: 'minimal'`；
  其餘模型請求體不變。
- 對外行為：改變（gpt-5 / o 系列延遲大幅下降）→ 同步 ARCHITECTURE.md 第 4 節
  Provider 備註。
- 驗收：gpt-5-mini 下單批翻譯延遲明顯下降（目測 <10 秒出首批）。

## 實施結果（2026-07-10 完成）

- Task 1–4 全數完成並通過手動驗收（BBC 新聞頁、gpt-5-mini）。
- 與計畫的差異：
  - Task 4：o 系列不支援 `reasoning_effort: 'minimal'`，改帶 `'low'`；
    `gpt-5-chat`（非 reasoning 模型）排除不帶參數。
  - 驗收後追加調整：scanner 的 rootMargin 由固定 `200px` 擴大為
    `50% 0px 200% 0px`（上 0.5／下 2 個螢幕高預抓），解決捲動時大量段落
    仍在「翻譯中…」的體感問題。
- 實測：首屏數秒內出現譯文；整篇文章清快取重翻 18 秒（修復前 ~30 秒起跳）。

### Task 5：文件同步與歸檔
- `docs/CHANGELOG.md`：記錄本次修復。
- `docs/FEATURES.md`：更新功能一觸發／行為描述（漸進渲染、popup 錯誤提示）、
  已知限制補「與沉浸式翻譯同時開啟時，會把對方插入的譯文再送翻一次」。
- `docs/ARCHITECTURE.md`：第 4 節補 OpenAI reasoning_effort 備註；第 1 節
  跨環境須知更新「PING 輪詢等待就緒」。
- 本計畫移至 `docs/plans/archive/`。
