import type { AiStudioConfig, PartialAiStudioConfig } from '../types/aiStudio';

export const STUDIO_CONFIG_SECTIONS = ['llm', 'voice', 'flowEngine', 'rendering', 'subtitles'] as const;
export type StudioConfigSection = typeof STUDIO_CONFIG_SECTIONS[number];

export function mergeSettingsDraft(
  draft: AiStudioConfig,
  incoming: AiStudioConfig,
  dirtySections: Iterable<StudioConfigSection>
): AiStudioConfig {
  return Object.assign({}, incoming, Object.fromEntries([...dirtySections].map((key) => [key, draft[key]])));
}

/** Never send a stale project list or channel profile from the global settings form. */
export function settingsDraftPatch(draft: AiStudioConfig, sections: Iterable<StudioConfigSection>): PartialAiStudioConfig {
  return Object.fromEntries([...sections].map((key) => [key, draft[key]]));
}
