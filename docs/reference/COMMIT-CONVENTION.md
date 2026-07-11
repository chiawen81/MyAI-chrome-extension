# COMMIT-CONVENTION

git commit 訊息格式規範。所有 commit（含 AI 代寫）一律遵守。

## 標題

格式：`type(scope): 簡述`

### type（限用以下八種）

| type | 用途 |
|---|---|
| `feat` | 新增功能 |
| `fix` | 修 bug |
| `docs` | 只改文件 |
| `chore` | 雜務（依賴更新、.gitignore、設定調整等，不影響程式行為） |
| `refactor` | 重構（改結構不改外部行為） |
| `style` | 純格式調整（縮排、命名等，非 CSS） |
| `test` | 新增或修改測試 |
| `build` | 建置系統變更（vite.config、package.json scripts 等） |

### scope（影響範圍）

**一律用中文**，如 `fix(網頁翻譯): ...`；不要寫模組英文名（錯誤示範：`fix(web-translate)`）。

本專案常用 scope 對照：

| scope | 對應模組 |
|---|---|
| 網頁翻譯 | src/content/web-translate |
| YouTube字幕 | src/content/youtube |
| 快捷面板 | src/popup |
| 設定頁 | src/options |
| 背景服務 | src/background |
| 供應商 | src/providers |
| 共用 | src/shared |

跨多個模組或無明確範圍時可省略括號，如 `docs: 更新測試清單`。

## 詳細內容（body）

1. 標題與詳細內容之間**空一行**。
2. 用數字列點的父子層呈現：

   ```
   1. 父標題1
     (1) 子項目1
     (2) 子項目2
   2. 父標題2
     (1) 子項目1
   ```

3. **相同主題的異動放同一個父層**，用子層展開細節。
4. 內容要讓 AI 和人都看得懂：
   - 不要太長、不要堆專有名詞
   - 以「哪一個**功能**做了什麼調整」為主
   - 技術細節可省略，除非是很關鍵的地方（如根因、跨模組契約變更）

## 範例

```
fix(網頁翻譯): 修復第一次按翻譯沒反應與首屏譯文過慢

1. 第一次按「翻譯此頁」沒反應
  (1) 原因：翻譯程式注入後還沒準備好，指令就送出了
  (2) 修法：注入後先確認就緒（輪詢 PING）再送指令
2. 首屏譯文出現太慢
  (1) 段落改成小組送翻，翻好一組先顯示一組，不等整批
  (2) 首屏譯文從約 30 秒縮短到數秒
```

## 其他

- AI 代寫的 commit 結尾保留 `Co-Authored-By: Claude ...` 署名行（與 body 空一行）。
