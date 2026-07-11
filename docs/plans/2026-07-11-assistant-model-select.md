# Claude 助手：交棒時可指定 claude.ai 模型（Assistant Model Select）

- 日期：2026-07-11
- 對應看板：#6
- 對應規格：REQUIREMENTS.md 無（功能三的增強）
- 狀態：**待審閱**（spike 已完成，結果見 §2.1 與附錄）
- 機制決策（2026-07-11 spike 定案）：採 **URL 參數 `?model=<slug>`**——每分頁獨立生效、**不改動帳號預設模型**、可與 `?q=` 備援併用、零新增 DOM 依賴；DOM 操作模型選單雖可行但會**永久改掉帳號預設**（伺服器端），不採。
- 範圍決策（2026-07-11 審閱回饋）：模型設定採**依動作各選**（每個右鍵動作可設不同模型），非全域單一設定。

---

## 1. User Story

1. 身為訂閱 claude.ai 的使用者，我想要指定右鍵交棒時使用的模型（例如 Haiku），以便摘要／翻譯這類輕量任務不消耗高階模型的訂閱用量。
2. 身為同一位使用者，我希望交棒用的模型**只影響那一個交棒對話**，我自己平常開新對話的預設模型不能被改掉。
3. 身為同一位使用者，我想要為不同動作設定不同模型（例如翻譯用 Haiku、摘要此頁用 Sonnet），以便任務難度與用量成本互相匹配。

---

## 2. Spec

### 2.1 Spike 驗證結果（2026-07-11，Playwright 自動化執行）

兩條候選路徑都驗證可行，但副作用差異決定了選擇：

| 驗證項 | 結果 |
|---|---|
| URL 參數 `claude.ai/new?model=<slug>` | ✅ 有效。`claude-haiku-4-5`／`claude-sonnet-5`／`claude-opus-4-8`／`claude-fable-5` 四個 slug 均解析為正確模型；載入後參數保留在網址列、不被 redirect 吃掉 |
| URL 參數＋`?q=` 併用 | ✅ 模型與預填內容**同時**生效（`?model=<slug>&q=<text>`）→ 備援路徑也能帶模型 |
| URL 參數送出後實際模型 | ✅ `?model=claude-haiku-4-5` 分頁送出後，對話模型顯示 Haiku 4.5 |
| URL 參數持久性 | ✅ **不污染帳號預設**——連開多個 `?model=` 分頁後，乾淨的 `/new` 預設模型不變（本功能採用的關鍵理由） |
| URL 參數的無效值 | ⚠️ UI 不驗證：`?model=haiku` 這種非 slug 值會**原樣**顯示在模型按鈕上（`Model: haiku`）→ 必須使用已知 slug 清單，不開放自由輸入 |
| DOM 操作模型選單 | ✅ 可行（按鈕 `[data-testid="model-selector-dropdown"]`，選項 `[role="menuitemradio"]` 靠顯示文字比對、無 testid；切換不清空已填文字）；但 ❌ 切換會**立即改掉帳號預設**（另開 `/new` 即見新模型，伺服器端記錄）→ 不採 |
| localStorage | ❌ 模型偏好不存 localStorage（只見 analytics 事件），無第三種寫入機制 |
| 推理量後綴（Extended／Medium） | 模型按鈕顯示的「Extended／Medium」是帳號對各模型的推理量偏好，`?model=` 不影響它，本功能不處理（範圍外） |

> 完整選單結構 dump 與重跑步驟見文末「附錄：Spike 驗證紀錄」。

### 2.2 設計

**機制**：background 開交棒分頁時，URL 由 `https://claude.ai/new` 改為（有指定模型時）`https://claude.ai/new?model=<slug>`；注入、填入、送出流程**完全不變**（claude-inject 零改動）。備援路徑 `?q=` 同步帶上 `&model=<slug>`。

**設定**：`Settings` 新增巢狀欄位 `assistantModels: Partial<Record<AssistantAction, string>>`——**依動作各存一個模型 slug**；缺項或空字串＝「跟隨 claude.ai 目前選擇」（預設，URL 不帶參數，行為與現況完全相同）。slug 極短（5 動作合計 < 150 bytes），直接放 `settings` 不需獨立 key；`DEFAULT_SETTINGS` 補 `{}`，`loadSettings()` 深合併**補這一層 spread**（DEVELOPMENT.md 規則：巢狀物件要逐層 spread，漏了舊用戶會缺欄）。

**模型清單**：常數集中於 `src/shared/assistant-prompts.ts`（與其他 Claude 助手常數同檔）：

```ts
export const ASSISTANT_MODELS = [
  { slug: '', label: '跟隨 claude.ai 目前選擇（預設）' },
  { slug: 'claude-haiku-4-5', label: 'Haiku 4.5（最快，適合摘要／翻譯）' },
  { slug: 'claude-sonnet-5', label: 'Sonnet 5（日常均衡）' },
  { slug: 'claude-opus-4-8', label: 'Opus 4.8（複雜任務）' },
  { slug: 'claude-fable-5', label: 'Fable 5（最高階）' },
] as const;
```

- **不開放自由輸入 slug**（spike 證實無效值會原樣進 UI，體驗差且難除錯）；claude.ai 模型改朝換代時更新此常數即可（單檔集中）。
- options「Claude 助手」分頁：**每個動作的模板卡**內加一個「交棒模型」`<select>`（模板卡本來就由 `ASSISTANT_ACTIONS` 動態產生，加欄位一處改、五動作全生效）；選項由 `ASSISTANT_MODELS` 動態產生；改了即存（沿用既有模式）。

**URL 組裝**：`assistant-prompts.ts` 新增純函式 `buildNewChatUrl(model: string): string`（空字串回 `https://claude.ai/new`，否則加 `?model=` 經 `encodeURIComponent`）；`buildFallbackUrl()` 加選填參數 `model`，有值時附加 `&model=<slug>`。

### 2.3 錯誤處理與已知限制

| 情境 | 行為 |
|---|---|
| claude.ai 改版：`?model=` 參數失效 | 優雅降級——參數被忽略時交棒照常進行，只是用帳號當下的預設模型（無錯誤、無資料損失）；列 FEATURES.md 已知限制（同「未公開結構」性質，但**失效不中斷功能**，比 DOM 依賴溫和） |
| slug 過時（模型下架） | 同上，UI 模型按鈕可能顯示原樣字串，使用者可手動改選；更新 `ASSISTANT_MODELS` 常數即修復 |
| 使用者訂閱方案沒有所選模型 | claude.ai 自身處理（顯示可用模型），外掛不偵測 |

- 推理量（Extended／Medium）不在本功能範圍；`?model=` 不影響帳號對各模型的推理量偏好。
- `?model=` 屬 claude.ai 未公開行為；重跑驗證步驟收錄於附錄，改版時照跑即可。

### 2.4 驗收標準（可勾選）

- [ ] options「Claude 助手」分頁每張動作卡都有「交棒模型」下拉，預設「跟隨 claude.ai 目前選擇」；改選後重開設定頁值保留
- [ ] 為某動作選「Haiku 4.5」→ 右鍵該動作 → 新分頁模型按鈕顯示 Haiku 4.5，自動送出後以該模型回覆
- [ ] **依動作各選生效**：兩個動作設不同模型（如翻譯＝Haiku、摘要此頁＝Sonnet）→ 各自開出的分頁模型正確、互不干擾
- [ ] **關鍵：交棒後另開 claude.ai 新對話，帳號預設模型不變**（不被交棒選擇污染）
- [ ] 未設定的動作（維持預設）→ 開的分頁網址不帶 `?model=`，行為與改動前完全相同
- [ ] 備援模擬（暫時改壞輸入框選擇器）→ `?q=` 備援網址同時帶 `model` 參數，模型與預填同時生效
- [ ] 既有功能迴歸：模板自訂、字數上限、中文確認、網頁翻譯、YouTube 字幕行為不變

---

## 3. Tasks

依節奏規則：Task 1–3 連續執行到底，**做到 Task 4（文件同步與收尾）前停下**，提示到 chrome://extensions 手動驗收。

### Task 1：常數、設定欄位與 URL 組裝純函式
- `assistant-prompts.ts`：加 `ASSISTANT_MODELS` 常數、`buildNewChatUrl()`；`buildFallbackUrl()` 加選填 `model` 參數。
- `types.ts`：`Settings` 加 `assistantModels: Partial<Record<AssistantAction, string>>`；`settings.ts`：`DEFAULT_SETTINGS` 補 `{}`、`loadSettings()` 深合併補這一層 spread。
- 驗證：`npm run typecheck`。

### Task 2：options「Claude 助手」分頁：每張動作卡加模型下拉
- `options.ts`（模板卡由 JS 動態產生）：卡內加「交棒模型」select（選項由 `ASSISTANT_MODELS` 動態產生）、改了即存 `settings.assistantModels[action]`、載入時回填。
- 影響檔案：`src/options/options.ts`（視卡片結構需要時連動 `src/options/index.html`、`options.css`）

### Task 3：background 接線
- `service-worker.ts`：`handleAssistantAction` 開分頁的 URL 改用 `buildNewChatUrl(settings.assistantModels[action] ?? '')`；備援導向改傳同一值給 `buildFallbackUrl`。
- 影響檔案：`src/background/service-worker.ts`

### （停點）手動驗收：§2.4 清單全項

### Task 4：文件同步與收尾
- FEATURES.md（功能三加「依動作交棒模型」行為與已知限制）；ARCHITECTURE.md（storage `settings` 欄位說明補 `assistantModels`＋深合併提醒）；TESTING.md（vitest 補 `buildNewChatUrl`／`buildFallbackUrl` 帶 model 的案例＋手動清單）；CHANGELOG.md；本計畫移至 `docs/plans/archive/`；BOARD.md #6 移入已完成。

### 範圍外（明確不做）
- 全域「一鍵套用到所有動作」的快捷設定（五個下拉手動選即可；有需求再加）
- 推理量（Extended／Medium）控制
- 自由輸入 slug、自動偵測可用模型清單
- DOM 操作模型選單（會污染帳號預設，spike 已否決）

---

## 附錄：Spike 驗證紀錄（2026-07-11）

驗證方式：Claude Code 以 Playwright（CDP）驅動獨立 profile 的 Chrome 實例（登入使用者本人帳號）自動執行；claude.ai 改版時可照下列步驟人工重跑。

### 模型選單結構 dump（DOM 路徑參考，本功能未採用）

- 模型按鈕：`button[data-testid="model-selector-dropdown"]`，aria-label `Model: <名稱> <推理量>`（如 `Model: Haiku 4.5 Extended`）。
- 主選單（`[role="menuitemradio"]`，無 testid、靠顯示文字識別）：Fable 5／Opus 4.8／Sonnet 5／Haiku 4.5；另有 `Extended`（推理量開關，`[role="menuitem"]`）與 `More models` 子選單（Opus 4.7／4.6／3、Sonnet 4.6）。
- 程式化點選 `menuitemradio` 可切換、不清空輸入框已填文字；**但切換立即寫入帳號預設（伺服器端）**，另開 `/new` 即為新模型——此副作用是否決 DOM 路徑的原因。
- 模型偏好不存 localStorage（切換前後 diff 僅 analytics 佇列）。

### URL 參數重跑步驟（改版時驗這段即可）

1. 登入 claude.ai，先記下目前預設模型（開 `/new` 看模型按鈕）。
2. 開 `https://claude.ai/new?model=claude-haiku-4-5` → 模型按鈕應顯示「Haiku 4.5」（非原樣字串）。
3. 開 `https://claude.ai/new?model=claude-haiku-4-5&q=hello` → 模型＋預填同時生效。
4. 在步驟 3 的分頁送出 → 對話以 Haiku 回覆。
5. 另開乾淨的 `https://claude.ai/new` → 預設模型應仍為步驟 1 記下的值（**不被污染**）。
6. 已知 slug：`claude-haiku-4-5`、`claude-sonnet-5`、`claude-opus-4-8`、`claude-fable-5`（2026-07-11 有效）。

### 執行紀錄摘要

- B1/B2 選單掃描：結構如上；選項無 testid。
- B3 DOM 切換：Haiku 4.5 Extended → Sonnet 5 Medium 成功、已填文字保留、送出後對話確為 Sonnet 5；**副作用：帳號預設被改為 Sonnet 5**（另開 /new 驗證）。
- A1–A3 URL 參數：四 slug 有效；無效值（`haiku`）原樣顯示不驗證；與 `?q=` 併用成功；多次開啟不改帳號預設。
- urlsend：`?model=claude-haiku-4-5&q=…` 送出後對話模型 Haiku 4.5 ✅。
- 收尾：帳號預設已切回原始的 Haiku 4.5 Extended 並驗證。測試過程在帳號留下兩則對話（「模型切換測試」與 URL 送出測試），可自行刪除。
