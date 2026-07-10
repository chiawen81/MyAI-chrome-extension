/**
 * Options 設定頁。
 * 所有欄位「改了就存」（不需按儲存鈕），右下角短暫顯示已儲存提示。
 * 分頁籤：翻譯服務 / 樣式 / AI 專家 / 進階。
 */
import { BUILTIN_EXPERTS } from '../shared/experts';
import { loadCustomExperts, loadSettings, saveCustomExperts, saveSettings } from '../shared/settings';
import { buildTranslationCss, TRANSLATION_ATTR } from '../shared/styles';
import type { ExpertTemplate, ProviderId, Settings, SimpleResponse, StylePresetId } from '../shared/types';

function $<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

let settings: Settings;
let customExperts: ExpertTemplate[];

void init();

async function init(): Promise<void> {
  settings = await loadSettings();
  customExperts = await loadCustomExperts();

  setupTabs();
  setupServiceTab();
  setupStyleTab();
  renderExpertList();
  setupAdvancedTab();
  void refreshCacheCount();

  $('#add-expert').addEventListener('click', () => {
    customExperts.push({
      id: `custom-${Date.now()}`,
      name: '未命名專家',
      systemPrompt:
        'You are a professional translator. Translate text from {{source_lang}} into {{target_lang}}.\nOutput only the translation.',
      builtin: false,
    });
    void persistExperts();
    renderExpertList();
  });
}

/** 儲存設定並顯示提示 */
async function persistSettings(): Promise<void> {
  await saveSettings(settings);
  flashSaved();
}

async function persistExperts(): Promise<void> {
  try {
    await saveCustomExperts(customExperts);
    flashSaved();
  } catch (err) {
    // sync storage 有單項 8KB 的限制，提示過長的 prompt 需要精簡
    alert(`儲存失敗（可能是模板過長超過同步儲存限制）：${err instanceof Error ? err.message : err}`);
  }
}

let savedTimer: number | undefined;
function flashSaved(): void {
  const indicator = $('#save-indicator');
  indicator.textContent = '✓ 已儲存';
  indicator.classList.add('visible');
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => indicator.classList.remove('visible'), 1500);
}

/* ------------------------------------------------------------------ */
/* 分頁籤                                                               */
/* ------------------------------------------------------------------ */

function setupTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((other) => other.classList.toggle('active', other === tab));
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `tab-${tab.dataset.tab}`);
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* 分頁一：翻譯服務                                                      */
/* ------------------------------------------------------------------ */

function setupServiceTab(): void {
  const provider = $<HTMLSelectElement>('#provider');
  const claudeKey = $<HTMLInputElement>('#claude-key');
  const claudeModel = $<HTMLInputElement>('#claude-model');
  const openaiKey = $<HTMLInputElement>('#openai-key');
  const openaiModel = $<HTMLInputElement>('#openai-model');

  provider.value = settings.provider;
  claudeKey.value = settings.claude.apiKey;
  claudeModel.value = settings.claude.model;
  openaiKey.value = settings.openai.apiKey;
  openaiModel.value = settings.openai.model;

  provider.addEventListener('change', () => {
    settings.provider = provider.value as ProviderId;
    void persistSettings();
  });
  claudeKey.addEventListener('change', () => {
    settings.claude.apiKey = claudeKey.value.trim();
    void persistSettings();
  });
  claudeModel.addEventListener('change', () => {
    settings.claude.model = claudeModel.value.trim();
    void persistSettings();
  });
  openaiKey.addEventListener('change', () => {
    settings.openai.apiKey = openaiKey.value.trim();
    void persistSettings();
  });
  openaiModel.addEventListener('change', () => {
    settings.openai.model = openaiModel.value.trim();
    void persistSettings();
  });

  // 測試連線：用「目前表單上的值」測，讓使用者輸入後不必先切換焦點儲存
  $('#test-connection').addEventListener('click', async () => {
    const providerId = provider.value as ProviderId;
    const apiKey = (providerId === 'claude' ? claudeKey : openaiKey).value.trim();
    const model = (providerId === 'claude' ? claudeModel : openaiModel).value.trim();
    const result = $('#test-result');

    if (!apiKey || !model) {
      result.textContent = '請先填入 API key 與模型名稱';
      result.className = 'result-error';
      return;
    }

    result.textContent = '測試中…';
    result.className = '';
    const response: SimpleResponse = await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      provider: providerId,
      apiKey,
      model,
    });

    if (response.ok) {
      result.textContent = '✓ 連線成功';
      result.className = 'result-ok';
    } else {
      result.textContent = `✗ ${response.error ?? '連線失敗'}`;
      result.className = 'result-error';
    }
  });
}

/* ------------------------------------------------------------------ */
/* 分頁二：樣式                                                         */
/* ------------------------------------------------------------------ */

function setupStyleTab(): void {
  const preset = $<HTMLSelectElement>('#style-preset');
  const color = $<HTMLInputElement>('#style-color');
  const background = $<HTMLInputElement>('#style-bg');
  const size = $<HTMLInputElement>('#style-size');
  const font = $<HTMLInputElement>('#style-font');

  preset.value = settings.style.preset;
  color.value = settings.style.textColor;
  background.value = settings.style.backgroundColor;
  size.value = String(settings.style.fontSizePercent);
  font.value = settings.style.fontFamily;

  // 預覽用的 <style>：與 content script 使用同一套 CSS 產生邏輯，所見即所得
  const previewStyle = document.createElement('style');
  document.head.appendChild(previewStyle);
  $('#style-preview').setAttribute(TRANSLATION_ATTR, '');

  const updatePreview = (): void => {
    previewStyle.textContent = buildTranslationCss(settings.style);
  };
  updatePreview();

  const apply = (): void => {
    settings.style = {
      preset: preset.value as StylePresetId,
      textColor: color.value.trim(),
      backgroundColor: background.value.trim(),
      fontSizePercent: Number(size.value) || 100,
      fontFamily: font.value.trim(),
    };
    updatePreview();
    void persistSettings();
  };

  for (const input of [preset, color, background, size, font]) {
    input.addEventListener('change', apply);
    input.addEventListener('input', apply);
  }
}

/* ------------------------------------------------------------------ */
/* 分頁三：AI 專家                                                       */
/* ------------------------------------------------------------------ */

function renderExpertList(): void {
  const list = $('#expert-list');
  list.innerHTML = '';

  // 內建專家：唯讀展示
  for (const expert of BUILTIN_EXPERTS) {
    const card = document.createElement('div');
    card.className = 'expert-card';

    const header = document.createElement('div');
    header.className = 'expert-header';
    header.innerHTML = `<span class="expert-name"></span><span class="badge">內建</span>`;
    header.querySelector('.expert-name')!.textContent = expert.name;

    const prompt = document.createElement('pre');
    prompt.textContent = expert.systemPrompt;

    card.append(header, prompt);
    list.appendChild(card);
  }

  // 自訂專家：可編輯、可刪除
  customExperts.forEach((expert, index) => {
    const card = document.createElement('div');
    card.className = 'expert-card';

    const header = document.createElement('div');
    header.className = 'expert-header';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = expert.name;
    nameInput.style.maxWidth = '260px';
    header.appendChild(nameInput);

    const promptArea = document.createElement('textarea');
    promptArea.value = expert.systemPrompt;

    const actions = document.createElement('div');
    actions.className = 'expert-actions';
    const saveButton = document.createElement('button');
    saveButton.textContent = '儲存';
    const deleteButton = document.createElement('button');
    deleteButton.textContent = '刪除';

    saveButton.addEventListener('click', () => {
      customExperts[index] = {
        ...expert,
        name: nameInput.value.trim() || '未命名專家',
        systemPrompt: promptArea.value,
      };
      void persistExperts();
      renderExpertList();
    });

    deleteButton.addEventListener('click', () => {
      if (!confirm(`確定刪除「${expert.name}」？`)) return;
      customExperts.splice(index, 1);
      // 若刪掉的是目前使用中的專家，設定退回「通用」
      if (settings.expertId === expert.id) {
        settings.expertId = 'general';
        void persistSettings();
      }
      void persistExperts();
      renderExpertList();
    });

    actions.append(saveButton, deleteButton);
    card.append(header, promptArea, actions);
    list.appendChild(card);
  });
}

/* ------------------------------------------------------------------ */
/* 分頁四：進階                                                         */
/* ------------------------------------------------------------------ */

function setupAdvancedTab(): void {
  const concurrency = $<HTMLInputElement>('#concurrency');
  const maxChars = $<HTMLInputElement>('#max-chars');
  const ytBatch = $<HTMLInputElement>('#yt-batch');

  concurrency.value = String(settings.concurrency);
  maxChars.value = String(settings.maxCharsPerPage);
  ytBatch.value = String(settings.youtubeBatchSize);

  concurrency.addEventListener('change', () => {
    settings.concurrency = clampNumber(concurrency, 1, 10, 3);
    void persistSettings();
  });
  maxChars.addEventListener('change', () => {
    settings.maxCharsPerPage = clampNumber(maxChars, 1000, 1000000, 10000);
    void persistSettings();
  });
  ytBatch.addEventListener('change', () => {
    settings.youtubeBatchSize = clampNumber(ytBatch, 10, 100, 40);
    void persistSettings();
  });

  $('#clear-cache').addEventListener('click', async () => {
    const result = $('#clear-cache-result');
    result.textContent = '清除中…';
    result.className = '';
    const response: SimpleResponse = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    result.textContent = response.ok ? '✓ 已清除' : `✗ ${response.error}`;
    result.className = response.ok ? 'result-ok' : 'result-error';
    void refreshCacheCount();
  });
}

/** 讀取數字輸入框並限制在合理範圍；無效值退回預設 */
function clampNumber(input: HTMLInputElement, min: number, max: number, fallback: number): number {
  const value = Number(input.value);
  const clamped = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  input.value = String(clamped);
  return clamped;
}

async function refreshCacheCount(): Promise<void> {
  const response: SimpleResponse = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' });
  $('#cache-count').textContent = response.ok ? String(response.count ?? 0) : '無法取得';
}
