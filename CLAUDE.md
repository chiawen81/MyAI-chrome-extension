# CLAUDE.md

## 專案概述
雙語對照翻譯（bilingual-translate-extension）— Chrome Extension (Manifest V3, TypeScript + Vite)，雙語翻譯工具。
需求規格：REQUIREMENTS.md（v0.1 原始規格，多數條目已實作完成、細節以 docs/reference/FEATURES.md 與 docs/reference/ARCHITECTURE.md 為準；0-A 合規約束已摘入下方「關鍵規則」，要查原始功能設想／明確捨棄範圍／MVP 驗收條件時才讀取）

## 常用指令
- `npm run dev` — Vite dev watch（CRXJS，產出 dist/ 供 chrome://extensions 載入未封裝）
- `npm run build` — 產生 icons → tsc 型別檢查 → 正式建置到 dist/
- `npm run typecheck` — `tsc --noEmit`
- `npm run icons` — 執行 scripts/gen-icons.mjs 產生 public/icons
- 測試指令尚未建立，導入後同步至此

## 關鍵規則
- 遵守 REQUIREMENTS.md 0-A 合規約束：無後端、無遠端程式碼、權限最小化
- content script 內禁用框架與全域樣式污染，樣式一律走 scoped class
- 四執行環境（content/service worker/popup/options）間通訊只透過
  chrome.runtime message，訊息型別集中定義於 shared/messages.ts
- 凡改動後要交給我測試或驗收（含小修），先執行 `npm run build` 確保 dist/
  是最新版，再提示我驗收——只跑 typecheck 不算（曾因此拿舊 build 驗收撲空）
- 任務執行節奏：實作類 task 連續執行到底，做到「文件同步與收尾」task 前
  停下，提示我到 chrome://extensions 手動驗收，通過後才收尾；
  例外：若某 task 必須先由我驗收或回報結果才能往下做（如依賴外部頁面
  結構的 spike、需真實 API key 的驗證），在計畫階段就判斷並於計畫文件
  的 Tasks 標註建議停點
- 任務想法（功能發想／bug／優化／SDD 調整）記錄於 docs/任務看板.md；
  使用者提到新想法或回報 bug 時先上看板，不急著開計畫文件
- 功能開發前先在 docs/plans/ 建立計畫（YYYY-MM-DD-<中文描述>.md，
  結構：User Story → Spec → Tasks）；docs/plans/ 下所有計畫文件（含 Fix 計畫）
  一律遵守格式：段落標題用 🔸、子標題用 🔹，每個 🔸 標題前插一行 `<br><br>`
  拉開區塊間距（Markdown 預覽會折疊純空行，只空行看不出間距；🔹 子標題前
  與一般段落之間不插，段落間空一行即可），
  涉及使用者操作動線或程式碼的解說用程式碼區塊，
  過於細節的資訊用 <details> 摺疊收納（摘要留在外層）；完成後移至 docs/plans/archive/
  並更新 docs/reference/CHANGELOG.md；開工時同步把 docs/任務看板.md 對應項目
  移到「進行中」並連結計畫文件
- git commit 訊息一律遵守 docs/reference/COMMIT-CONVENTION.md（type(中文scope) 前綴＋數字列點 body；
  刻意不用 @ 引入，撰寫 commit 前才讀取該檔）
- 改動跨執行環境通訊、訊息型別、或 background／content script 注入邏輯前，
  務必先讀 docs/reference/ARCHITECTURE.md 第 1 節「跨環境須知」——記錄多個已修過的坑
  （如注入後需輪詢 PING 才能轉發指令、semaphore 狀態存在 SW 記憶體不持久），
  單靠檔案描述不夠保險，這條規則明講以防漏查
- 每次任務結束前執行文件同步檢查：
  行為變更 → FEATURES.md；新增 message/storage key/Provider → ARCHITECTURE.md；
  一律 → CHANGELOG.md；功能完成 → 計畫文件移至 plans/archive/、
  docs/任務看板.md 項目移入「已完成」摺疊區（加完成日期）

## 詳細文件
以下皆刻意不用 `@` 引入以省 token（每次對話固定成本），改為描述用途與讀取時機，需要時才主動讀取：

- docs/任務看板.md — 任務看板（發想／待辦／進行中／已完成）。**讀取時機**：使用者提到新想法／bug，或要盤點任務狀態時
- docs/SDD操作指南.md — SDD 開發流程操作手冊（場景分派、各場景指令範本、slash command／skill 建置記錄）。**讀取時機**：不確定當前任務該走哪個 SDD 場景，或要查/建置 `/sdd-*` 指令細節時
- docs/reference/ARCHITECTURE.md — 執行環境職責、message passing 一覽、chrome.storage 資料結構、Provider 抽象層與擴充點、目錄結構。**讀取時機**：改動跨執行環境通訊、新增 message／storage key／Provider，或碰 background／content script 邏輯前（第 1 節跨環境須知另有「關鍵規則」明文提醒，見上）；純改單一模組內部邏輯（如樣式調整、單一函式）通常不需要
- docs/reference/DEVELOPMENT.md — 命名規則、環境需求與指令、新增 AI 專家模板／譯文樣式／Provider／Claude 助手動作的具體步驟、計畫與 spike 流程。**讀取時機**：做上述任一種擴充，或要查命名規則／環境指令時
- docs/reference/FEATURES.md — 驗收條件對照＋各功能實際行為與已知限制。**讀取時機**：要回答「這功能現在支援什麼／有什麼限制」，或確認驗收狀態時
- docs/reference/TESTING.md — vitest 單元測試規劃（scanner、快取 hash、批次對齊 fallback）＋手動驗收清單。**讀取時機**：要寫測試或執行手動驗收時
- docs/reference/CHANGELOG.md — 變更紀錄。**讀取時機**：要回顧近期改了什麼、或確認某功能何時／為何加入時（近期異動也可用 `git log` 查，通常更快）
