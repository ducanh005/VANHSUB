export type TtsEngine = 'edge' | 'tiktok' | 'viettts';

/** Edge voice IDs end in Neural; other selectable voice IDs belong to TikTok. */
export function engineForVoice(voice: string): 'edge' | 'tiktok' {
  return voice.endsWith('Neural') ? 'edge' : 'tiktok';
}

export function resolveTtsEngine(voice: string, saved?: TtsEngine, explicit?: TtsEngine): TtsEngine {
  return explicit || (saved === 'viettts' ? saved : engineForVoice(voice));
}
