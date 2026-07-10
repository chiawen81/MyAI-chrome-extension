/**
 * 供應商工廠：依設定取得對應的 TranslationProvider 實例。
 */
import type { ProviderId } from '../shared/types';
import type { TranslationProvider } from './base';
import { claudeProvider } from './claude';
import { openaiProvider } from './openai';

const PROVIDERS: Record<ProviderId, TranslationProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
};

export function getProvider(id: ProviderId): TranslationProvider {
  return PROVIDERS[id];
}
