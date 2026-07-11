---
description: SDD 場景六（6-A）：功能完成收尾——文件同步與計畫歸檔
argument-hint: 計畫檔名（docs/plans/ 下的檔案）
disable-model-invocation: true
---

計畫 $ARGUMENTS 對應的功能已通過手動驗收，請執行完成收尾：

1. docs/plans/$ARGUMENTS 移至 docs/plans/archive/
   （若輸入未含 .md 副檔名或路徑，請自行補全；找不到該檔案時停下向我確認，不要猜）
2. docs/reference/FEATURES.md：更新此功能狀態與行為描述（含已知限制）
3. docs/reference/CHANGELOG.md：補上本次變更
4. 檢查本次開發是否新增 message／storage key／Provider，有則同步 docs/reference/ARCHITECTURE.md
5. 列出你這次同步了哪些文件讓我核對
