export interface DubbingPreferences {
  replaceAudio: boolean;
  syncMode: 'strict' | 'flexible' | 'video-stretch';
  mixOriginalAudio: boolean;
  vocalSeparation: boolean;
}

export function normalizeDubbingPreferences(value?: Partial<DubbingPreferences>): DubbingPreferences {
  const replaceAudio = value?.replaceAudio ?? true;
  const vocalSeparation = replaceAudio && !!value?.vocalSeparation;
  return { replaceAudio, vocalSeparation,
    syncMode: value?.syncMode === 'video-stretch' ? 'video-stretch' : 'strict',
    mixOriginalAudio: replaceAudio && !vocalSeparation && !!value?.mixOriginalAudio,
  };
}
