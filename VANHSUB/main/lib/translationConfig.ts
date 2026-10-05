import { createHash } from 'node:crypto';
import { SettingsStore } from '../store/settingsStore';

export function translationConfigHash(targetLanguage?: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'subtitle-translation-v1',
        targetLanguage,
        SettingsStore.get('geminiModel'),
        SettingsStore.get('glossary'),
        SettingsStore.get('translationStyleGuide'),
      ])
    )
    .digest('hex');
}
