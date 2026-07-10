# CHANGELOG

## 2026-07-10
- 建立核心文件：ARCHITECTURE.md（四執行環境／訊息協定／storage 結構／Provider 擴充點／目錄）、DEVELOPMENT.md（命名規則與擴充步驟）、FEATURES.md（驗收對照與行為描述）、TESTING.md（vitest 規劃＋手動驗收清單）；CLAUDE.md「詳細文件」段落更新為實際索引
- 初始化開發流程骨架：CLAUDE.md、docs/plans/（含 archive/）、docs/CHANGELOG.md
- 跨 context 訊息型別自 shared/types.ts 抽出至 shared/messages.ts（types.ts re-export 維持相容）
