import Store from 'electron-store';

export interface AppSettings {
  geminiApiKey: string;
  geminiModel: string;
  targetLanguage: string;
}

// Lazy singleton — cùng pattern với taskStore.ts để tránh lỗi
// "Please specify the projectName option" khi app chưa ready.
let _store: Store<AppSettings> | null = null;

function getStore(): Store<AppSettings> {
  if (!_store) {
    _store = new Store<AppSettings>({
      name: 'vanhsub-settings',
      defaults: {
        geminiApiKey: '',
        geminiModel: 'gemini-2.0-flash',
        targetLanguage: 'vi',
      },
    });
  }
  return _store;
}

export const SettingsStore = {
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return getStore().get(key);
  },

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    getStore().set(key, value);
  },

  hasGeminiKey(): boolean {
    return getStore().get('geminiApiKey').trim().length > 0;
  },
};
