# CLAUDE.md

## 專案概述
雙語對照翻譯（bilingual-translate-extension）— Chrome Extension (Manifest V3, TypeScript + Vite)，雙語翻譯工具。
需求規格：@REQUIREMENTS.md（合規約束見 0-A 節，為硬性限制）

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
- 任務執行節奏：實作類 task 連續執行到底，做到「文件同步與收尾」task 前
  停下，提示我到 chrome://extensions 手動驗收，通過後才收尾；
  例外：若某 task 必須先由我驗收或回報結果才能往下做（如依賴外部頁面
  結構的 spike、需真實 API key 的驗證），在計畫階段就判斷並於計畫文件
  的 Tasks 標註建議停點
- 任務想法（功能發想／bug／優化／SDD 調整）記錄於 docs/BOARD.md 任務看板；
  使用者提到新想法或回報 bug 時先上看板，不急著開計畫文件
- 功能開發前先在 docs/plans/ 建立計畫（YYYY-MM-DD-<feature>.md，
  結構：User Story → Spec → Tasks）；完成後移至 docs/plans/archive/
  並更新 docs/CHANGELOG.md；開工時同步把 BOARD.md 對應項目
  移到「進行中」並連結計畫文件
- git commit 訊息一律遵守 docs/COMMIT-CONVENTION.md（type(中文scope) 前綴＋數字列點 body；
  刻意不用 @ 引入，撰寫 commit 前才讀取該檔）
- 每次任務結束前執行文件同步檢查：
  行為變更 → FEATURES.md；新增 message/storage key/Provider → ARCHITECTURE.md；
  一律 → CHANGELOG.md；功能完成 → 計畫文件移至 plans/archive/、
  BOARD.md 項目移入「已完成」摺疊區（加完成日期）

## 詳細文件
- docs/BOARD.md — 任務看板（發想／待辦／進行中／已完成；刻意不用 @ 引入以省 token，需要時才讀取）
- @docs/ARCHITECTURE.md — 四執行環境職責、message passing 一覽、chrome.storage 資料結構、Provider 抽象層與擴充點、目錄結構
- @docs/DEVELOPMENT.md — 命名規則；新增 AI 專家模板／譯文樣式／Provider 的具體步驟；環境需求與計畫歸檔流程
- @docs/FEATURES.md — REQUIREMENTS.md 第 4 節驗收條件完成狀態＋各功能實際行為與已知限制
- @docs/TESTING.md — vitest 單元測試規劃（scanner、快取 hash、批次對齊 fallback）＋手動驗收清單
- @docs/CHANGELOG.md — 變更紀錄
