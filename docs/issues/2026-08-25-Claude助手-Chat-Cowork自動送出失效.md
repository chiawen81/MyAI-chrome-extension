# Claude 助手：Chat／Cowork 改版後文字可填入但無法自動送出

> 看板編號：#23  
> 類型：Bug  
> 回報日期：2026-08-25  
> 狀態：**已建 Fix 計畫，待實作**（前置 spike／補充觀測皆已完成，修復方案 F1／F2／F4／F5 已定案）  
> Fix 計畫：[../plans/2026-09-09-修復-Claude助手Chat-Cowork自動送出失效.md](../plans/2026-09-09-修復-Claude助手Chat-Cowork自動送出失效.md)

## 問題摘要

Claude 網頁改為 Chat／Cowork 共用首頁後，右鍵選單的 Claude 助手仍能把文字填入輸入框，但需要自動送出的動作會等待 5 秒後降級為「保留填入內容」，沒有真正送出。

同時，降級路徑使用 `console.warn()`；Chrome 會把 content script warning 收進擴充功能錯誤頁，因此使用者在更新擴充功能時會看到「等不到 claude.ai 送出鈕」，容易誤認為擴充功能更新失敗。

## 影響範圍

- 受影響：摘要此頁、摘要選取文字、翻譯、翻譯＋摘要等需要自動送出的動作。
- 未完全失效：文字仍會保留在 Claude 輸入框，可由使用者手動送出。
- 不受影響：「將選取文字帶入 Claude」原本就只填入、不自動送出。
- 這不是 manifest、TypeScript 或擴充功能載入失敗；目前 `npm run typecheck` 通過。

## 已確認的技術背景

目前 `src/content/claude-inject/index.ts` 的流程為：

1. 尋找 `div.ProseMirror[contenteditable="true"]`。
2. 用 `document.execCommand('insertText')` 填入內容。
3. 在全頁 `button[aria-label]` 中尋找 `aria-label` 符合 `/send/i` 的按鈕。
4. 最多等待 5 秒；找不到時回傳 `{ ok: true, filled: true, submitted: false }`。
5. Background 只把 `filled: false` 視為失敗，因此本情境不會走 `?q=` 備援。

原選擇器來自 2026-07-11 對舊版 `claude.ai/new` Chat 介面的人工驗證。此次錯誤截圖的實際網址為 `/cowork/...`，現有程式沒有辨識或切換 Chat／Cowork 模式。

## 根因假設

修復前需由 spike 區分以下情況：

1. Chat／Cowork 的送出按鈕已改用不同的元素、`aria-label` 或 `data-testid`。
2. `execCommand('insertText')` 雖改變畫面文字，但沒有同步 Claude 新版編輯器的前端狀態，因此送出鈕沒有出現或仍為 disabled。
3. `/new` 會沿用使用者最近選擇的 Cowork 模式，導致原本預期交棒到一般 Chat 的動作進入 Cowork。
4. 上述問題同時存在。

## 前置 spike（需要使用者執行）

### 測試準備

1. 登入 `claude.ai`，開啟一個空白 Chat。
2. 按 `F12` 開啟 DevTools，切到 Console。
3. 若 Chrome 阻擋貼上，依 Console 提示手動輸入 `allow pasting`。
4. 貼上以下腳本。腳本只會填入測試文字，不會點擊送出。

```js
(() => {
  const findEditor = () =>
    document.querySelector('div.ProseMirror[contenteditable="true"]') ??
    document.querySelector('[contenteditable="true"]');

  const scan = (stage = 'scan') => {
    const editor = findEditor();
    const editorRect = editor?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('button')]
      .map((button, index) => {
        const rect = button.getBoundingClientRect();
        const nearEditor = editorRect
          ? Math.abs(rect.left - editorRect.right) < 600 && Math.abs(rect.top - editorRect.top) < 400
          : false;
        return {
          index,
          nearEditor,
          visible: rect.width > 0 && rect.height > 0,
          disabled: button.disabled,
          type: button.getAttribute('type'),
          ariaLabel: button.getAttribute('aria-label'),
          title: button.getAttribute('title'),
          testId: button.getAttribute('data-testid'),
          text: (button.innerText || '').trim().slice(0, 40),
        };
      })
      .filter(
        (button) =>
          button.nearEditor ||
          button.type === 'submit' ||
          /send|送出|傳送/i.test(`${button.ariaLabel} ${button.title} ${button.text}`),
      );

    console.group(`[bt-claude-spike] ${stage}`);
    console.log('URL:', location.href);
    console.log(
      'editor:',
      editor
        ? {
            tag: editor.tagName,
            className: editor.className,
            role: editor.getAttribute('role'),
            ariaLabel: editor.getAttribute('aria-label'),
            text: editor.innerText,
          }
        : null,
    );
    console.table(buttons);
    console.groupEnd();
    return { url: location.href, editorFound: !!editor, buttons };
  };

  const fill = () => {
    const editor = findEditor();
    if (!editor) return console.warn('[bt-claude-spike] 找不到輸入框');
    editor.focus();
    document.execCommand('selectAll', false);
    const inserted = document.execCommand('insertText', false, '[bt-spike] programmatic fill');
    console.log('[bt-claude-spike] execCommand result:', inserted);
    setTimeout(() => scan('1s after execCommand'), 1000);
  };

  window.btClaudeSpike = { scan, fill };
  scan('initial');
  console.log(
    '下一步：執行 btClaudeSpike.fill()；一秒後在輸入框末尾人工鍵入 x，再執行 btClaudeSpike.scan("after manual x")',
  );
})();
```

### 執行步驟

1. Console 輸入 `btClaudeSpike.fill()`，等待一秒。
2. 在輸入框文字末尾人工鍵入一個 `x`，不要送出。
3. Console 輸入 `btClaudeSpike.scan('after manual x')`。
4. 複製兩次表格輸出或截圖，然後清掉測試文字。
5. 切換成一個空白 Cowork，重新貼上腳本並重做步驟 1–4。

### 回報資料

請提供 Chat 與 Cowork 各自的：

- URL。
- `initial` 輸出。
- `1s after execCommand` 輸出。
- `after manual x` 輸出。

若程式填入後沒有送出鈕，而人工鍵入 `x` 後才出現，即可確認至少存在編輯器狀態同步問題。

## 預定修復方向

> 以下為回報當時的初步方向；spike（2026-09-09）後的定案內容以 Fix 計畫 §2.3 為準——第 3 點的「輸入事件流程」經證偽已作廢（`execCommand('insertText')` 仍有效），第 1 點改由 DOM 切換 composer 內的 Chat／Cowork toggle（兩模式 URL 相同，URL 參數做法無效）。

1. 交棒時確保使用一般 Chat，避免無意間沿用 Cowork 模式；實際方式由 spike 確認目前介面可用的穩定入口。
2. 將輸入框與送出控制項的搜尋限制在同一個 composer／form，避免掃描全頁並誤點其他按鈕。
3. 依新版 DOM 補強 selector；若 spike 證實前端狀態不同步，改用新版編輯器能正確接收的輸入事件流程。
4. 點擊送出後驗證輸入框已清空或訊息已建立，不能只因呼叫 `click()` 就回報成功。
5. 「已填入但未送出」改為資訊級紀錄或靜默降級，不再讓 Chrome 擴充功能錯誤頁顯示誤導性警告。
6. 保留找不到輸入框時的 `?q=` 備援；避免在已成功填入完整內容後重新導頁而遺失長內容。

## 驗收條件

- 從 Chat 起始時，需要自動送出的四種動作皆能成功送出。
- Claude 目前停在 Cowork 模式時，交棒仍進入預期的一般 Chat，不意外建立 Cowork 任務。
- 「將選取文字帶入 Claude」維持只填不送。
- 指定模型與不指定模型皆正常。
- 換行、中文、英文及長內容可正確填入。
- 找不到輸入框時仍可走 `?q=` 備援。
- 找不到送出鈕時保留文字，且 Chrome 擴充功能錯誤頁不再出現預期降級 warning。
- 修復後通過 `npm run build`，再由使用者於 Chat／Cowork 兩種起始狀態手動驗收。
