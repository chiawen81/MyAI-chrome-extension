/**
 * Popup 快捷面板。
 * - 翻譯／還原目前分頁（透過 background 注入並轉發）
 * - 快速切換目標語言、供應商與 AI 專家（直接寫回設定）
 * - 顯示目前使用的模型名稱、開啟設定頁
 */
import { BUILTIN_EXPERTS } from '../shared/experts';
import { LANGUAGES } from '../shared/languages';
import { loadCustomExperts, loadSettings, saveSettings } from '../shared/settings';
import type { Settings, SimpleResponse } from '../shared/types';

/** 簡短的 querySelector 包裝（popup 的元素都必定存在） */
function $<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

const toggleButton = $<HTMLButtonElement>('#toggle-btn');
const targetLangSelect = $<HTMLSelectElement>('#target-lang');
const providerSelect = $<HTMLSelectElement>('#provider');
const modelName = $<HTMLDivElement>('#model-name');
const expertSelect = $<HTMLSelectElement>('#expert');

let settings: Settings;
let activeTabId: number | undefined;

void init();

async function init(): Promise<void> {
  settings = await loadSettings();

  // 目標語言選單
  for (const lang of LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = lang.label;
    targetLangSelect.appendChild(option);
  }
  targetLangSelect.value = settings.targetLang;

  // AI 專家選單（內建 + 自訂）
  const customExperts = await loadCustomExperts();
  for (const expert of [...BUILTIN_EXPERTS, ...customExperts]) {
    const option = document.createElement('option');
    option.value = expert.id;
    option.textContent = expert.builtin ? expert.name : `${expert.name}（自訂）`;
    expertSelect.appendChild(option);
  }
  expertSelect.value = settings.expertId;

  providerSelect.value = settings.provider;
  updateModelName();

  // 查詢目前分頁的翻譯狀態，決定按鈕文字
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  if (activeTabId !== undefined) {
    const state: SimpleResponse = await chrome.runtime.sendMessage({
      type: 'POPUP_GET_STATE',
      tabId: activeTabId,
    });
    updateToggleButton(state.active === true);
  }

  bindEvents();
}

function updateModelName(): void {
  modelName.textContent = `模型：${settings[settings.provider].model || '（未設定）'}`;
}

function updateToggleButton(active: boolean): void {
  toggleButton.textContent = active ? '還原原文' : '翻譯此頁';
  toggleButton.classList.toggle('active', active);
}

function bindEvents(): void {
  // 翻譯／還原
  toggleButton.addEventListener('click', async () => {
    if (activeTabId === undefined) return;
    toggleButton.disabled = true;
    const result: SimpleResponse = await chrome.runtime.sendMessage({
      type: 'POPUP_TOGGLE',
      tabId: activeTabId,
    });
    toggleButton.disabled = false;

    if (result.ok) {
      updateToggleButton(result.active === true);
    } else {
      // 失敗原因放 tooltip（chrome:// 無法注入、content script 未回應等），
      // 2 秒後恢復按鈕，讓使用者可以重試
      toggleButton.textContent = '此頁面無法翻譯';
      toggleButton.title = result.error ?? '';
      setTimeout(() => {
        toggleButton.title = '';
        updateToggleButton(false);
      }, 2000);
    }
  });

  // 快速切換設定：改了就直接存
  targetLangSelect.addEventListener('change', () => {
    settings.targetLang = targetLangSelect.value;
    void saveSettings(settings);
  });

  providerSelect.addEventListener('change', () => {
    settings.provider = providerSelect.value as Settings['provider'];
    updateModelName();
    void saveSettings(settings);
  });

  expertSelect.addEventListener('change', () => {
    settings.expertId = expertSelect.value;
    void saveSettings(settings);
  });

  // 開啟設定頁
  $<HTMLAnchorElement>('#open-options').addEventListener('click', (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}
