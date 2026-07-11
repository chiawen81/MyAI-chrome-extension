# 樣式設定：預設樣式加「粗體」＋字型欄位提供選項

對應 BOARD #12。REQUIREMENTS.md 無對應章節，為新需求。

## User Story

- 身為使用者，我想要在「預設樣式」下拉多一個「粗體」選項，以便不需開「進階自訂」就能讓譯文用粗體呈現。
- 身為使用者，我想要「字型」欄位改成提供常用字型選單，以便不用手動記字型名稱與正確語法，但仍能在需要時自行輸入其他字型。

## Spec

### (a) 新增「粗體」預設樣式

- 依 DEVELOPMENT.md「新增譯文樣式預設集」既定步驟新增，沿用既有的 4 步驟模式（`StylePresetId` → `PRESET_RULES` → `#style-preset` option → 不需改 content script）。
- CSS 宣告只描述外觀差異：`font-weight: 700 !important;`（不動版面規則，版面規則已由 `buildTranslationCss` 統一處理）。
- 命名與既有預設集一致：id 用英文語意詞 `bold`，下拉顯示文字用中文「粗體」。
- 與「進階自訂」的疊加規則沿用既有邏輯不變——自訂值（如自訂顏色、字級）仍可與「粗體」預設集並存套用，两者不互斥。

### (b) 字型欄位改為常用選項

- 沿用現有 `#style-font` 這顆 `<input type="text">`，不改型別、不改 `options.ts` 的讀寫邏輯——只加 `list` 屬性指向新增的 `<datalist>`，維持「保留自訂輸入」的需求（datalist 允許選單以外的自由輸入，符合現有 `fontFamily: string` 儲存格式，不需改動 storage schema）。
- datalist 選項需涵蓋雙語（中文＋英文）常見排版字型，且各項值需是可直接寫入 CSS `font-family` 的合法字串（含 fallback）：
  - `"Noto Sans TC", sans-serif`
  - `"Microsoft JhengHei", sans-serif`
  - `"PingFang TC", sans-serif`
  - `system-ui, sans-serif`
  - `Arial, sans-serif`
  - `Georgia, serif`
  - `"Times New Roman", serif`
  - `monospace`
- 欄位保留原本「留空 = 不覆寫」語意，datalist 不影響空值行為。
- label 提示文字（`for="style-font"` 的 `<label>`）需更新，移除原本「例如 "Noto Sans TC", sans-serif」的 placeholder 範例字樣衝突（placeholder 可簡化為「可自訂輸入」），避免與 datalist 選項重複佔位。

### 邊界條件與錯誤處理

- 「粗體」與「無樣式」等其他既有預設集互斥（下拉單選，與現況相同），不需額外邊界處理。
- 字型 datalist 選項不做輸入驗證（沿用現況：`fontFamily` 直接寫入 CSS，不合法字型由瀏覽器自行 fallback，不阻擋使用者輸入）。
- 若使用者原本已自訂儲存了不在 datalist 清單中的字型字串，欄位仍正常顯示該值（datalist 不限制既有 input value）。

### 驗收標準

- [ ] options 頁「樣式」分頁的「預設樣式」下拉新增「粗體」選項，選取後預覽區文字即時變粗體
- [ ] 選取「粗體」並儲存後，實際翻譯頁面的譯文也套用粗體（不需重新整理即時生效，與其他預設集行為一致）
- [ ] 「粗體」可與「進階自訂」（文字色／背景色／字級／字型）同時套用不互相覆蓋衝突
- [ ] 「字型」欄位改為下拉／datalist 呈現常用字型選項，選取後預覽即時反映
- [ ] 「字型」欄位選單以外仍可手動輸入任意字型字串並生效（自訂輸入未被鎖死）
- [ ] 原本已儲存的自訂字型值（不在常用清單內）重新開啟 options 頁時正常顯示，不因改用 datalist 而遺失或被清空
- [ ] `npm run build` 通過（含 typecheck）

## Tasks

1. **`StylePresetId` 加 `bold`**
   - 影響檔案：[src/shared/types.ts](src/shared/types.ts)
   - 內容：union 型別加 `'bold'`。

2. **`PRESET_RULES` 加粗體 CSS 規則**
   - 影響檔案：[src/shared/styles.ts](src/shared/styles.ts)
   - 內容：`PRESET_RULES` 加 `bold: 'font-weight: 700 !important;'`（沿用既有其他預設集的寫法與注解風格）。

3. **options 頁「預設樣式」下拉加選項**
   - 影響檔案：[src/options/index.html](src/options/index.html)
   - 內容：`#style-preset` 加 `<option value="bold">粗體</option>`。

4. **字型欄位改為 datalist**
   - 影響檔案：[src/options/index.html](src/options/index.html)
   - 內容：`#style-font` 加 `list="style-font-options"` 屬性、簡化 placeholder；新增 `<datalist id="style-font-options">`，內含 Spec (b) 列出的常用字型 `<option>`。
   - 不需改 [src/options/options.ts](src/options/options.ts)：`font` 仍是 `HTMLInputElement`，既有讀寫／事件綁定邏輯不變。

5. **手動驗收（停點）**
   - 提示使用者到 `chrome://extensions` 重新載入擴充功能，對照上方「驗收標準」逐項確認（含粗體即時生效、字型 datalist 選單與自訂輸入並存、既有自訂字型值不遺失）。
   - 通過後才進入下一步收尾。

6. **文件同步與收尾**
   - 影響檔案：[docs/FEATURES.md](docs/FEATURES.md)（第 81 行「4 種預設集」改為「5 種預設集」並補「粗體」；字型欄位描述補充「提供常用選項＋可自訂輸入」）、[docs/CHANGELOG.md](docs/CHANGELOG.md)（新增條目）、[docs/BOARD.md](docs/BOARD.md)（#12 移入「✅ 已完成」摺疊區並加完成日期）。
   - 計畫文件本身移至 `docs/plans/archive/`。
