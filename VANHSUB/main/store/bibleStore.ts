import os from 'os';
import path from 'path';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';

export interface CharacterProfile {
  id: string;
  name: string;
  description: string;
  referenceImages: string[];
  gender: 'male' | 'female' | 'other';
  ageGroup?: string;
  lockedSeed?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SceneProfile {
  id: string;
  name: string;
  description: string;
  referenceImages: string[];
  environment: 'indoor' | 'outdoor' | 'space';
  lightingMood: string;
  colorPalette?: string;
  createdAt: string;
  updatedAt: string;
}

interface BibleStoreSchema {
  characters: CharacterProfile[];
  scenes: SceneProfile[];
}

const DEFAULT_CHARACTERS: CharacterProfile[] = [
  {
    id: 'char-agent-vanh',
    name: 'Điệp viên Vanh',
    description: 'Nam mật vụ người Việt, áo khoác măng-tô sẫm màu, ánh mắt tập trung sắc bén.',
    referenceImages: [],
    gender: 'male',
    ageGroup: '28 tuổi',
    lockedSeed: 424242,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'char-dr-lan-anh',
    name: 'Tiến sĩ Lan Anh',
    description: 'Nữ tiến sĩ công nghệ lượng tử, kính cận thanh lịch, áo blouse trắng hiện đại.',
    referenceImages: [],
    gender: 'female',
    ageGroup: '30 tuổi',
    lockedSeed: 108108,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const DEFAULT_SCENES: SceneProfile[] = [
  {
    id: 'scene-hanoi-cyberpunk',
    name: 'Chợ đêm Hà Nội tương lai (Cyberpunk Hanoi)',
    description: 'Khu phố cổ ngập ánh đèn neon xanh tím phản chiếu trên mặt đường ướt mưa, hơi nước bốc lên từ quán ăn vỉa hè.',
    referenceImages: [],
    environment: 'outdoor',
    lightingMood: 'Moody neon cyan and amber, volumetric steam',
    colorPalette: 'cyberpunk',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'scene-quantum-lab',
    name: 'Phòng Thí nghiệm Lượng tử (Quantum Lab)',
    description: 'Phòng thí nghiệm công nghệ cao với màn hình holographic nổi, ánh sáng trắng xanh lạnh.',
    referenceImages: [],
    environment: 'indoor',
    lightingMood: 'Cold sci-fi blue, sterile studio lights',
    colorPalette: 'teal_orange',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

let _store: Store<BibleStoreSchema> | null = null;

function getStore(): Store<BibleStoreSchema> {
  if (!_store) {
    let cwd: string | undefined = process.env.VANHSUB_BIBLE_DIR;
    if (!cwd) {
      try {
        const electron = require('electron');
        const electronApp = electron.app;
        if (!electronApp?.name && !electronApp?.getPath) {
          cwd = path.join(os.tmpdir(), 'vanhsub-bible');
        }
      } catch {
        cwd = path.join(os.tmpdir(), 'vanhsub-bible');
      }
    }

    _store = new Store<BibleStoreSchema>({
      name: 'vanhsub-bible',
      ...(cwd ? { cwd } : {}),
      defaults: {
        characters: DEFAULT_CHARACTERS,
        scenes: DEFAULT_SCENES,
      },
    });
  }
  return _store;
}

export const BibleStore = {
  // --- Character Bible ---
  getCharacters(): CharacterProfile[] {
    return getStore().get('characters', DEFAULT_CHARACTERS);
  },

  getCharacterById(id: string): CharacterProfile | undefined {
    return this.getCharacters().find((c) => c.id === id);
  },

  saveCharacter(profile: Partial<CharacterProfile> & { name: string }): CharacterProfile {
    const list = this.getCharacters();
    const now = new Date().toISOString();

    if (profile.id) {
      const idx = list.findIndex((c) => c.id === profile.id);
      if (idx >= 0) {
        const updated: CharacterProfile = {
          ...list[idx],
          ...profile,
          updatedAt: now,
        };
        list[idx] = updated;
        getStore().set('characters', list);
        return updated;
      }
    }

    const newChar: CharacterProfile = {
      id: profile.id || `char-${uuidv4().slice(0, 8)}`,
      name: profile.name,
      description: profile.description || '',
      referenceImages: profile.referenceImages || [],
      gender: profile.gender || 'male',
      ageGroup: profile.ageGroup || '25-30',
      lockedSeed: profile.lockedSeed,
      createdAt: now,
      updatedAt: now,
    };

    list.push(newChar);
    getStore().set('characters', list);
    return newChar;
  },

  deleteCharacter(id: string): boolean {
    const list = this.getCharacters().filter((c) => c.id !== id);
    getStore().set('characters', list);
    return true;
  },

  // --- Scene Bible ---
  getScenes(): SceneProfile[] {
    return getStore().get('scenes', DEFAULT_SCENES);
  },

  getSceneById(id: string): SceneProfile | undefined {
    return this.getScenes().find((s) => s.id === id);
  },

  saveScene(profile: Partial<SceneProfile> & { name: string }): SceneProfile {
    const list = this.getScenes();
    const now = new Date().toISOString();

    if (profile.id) {
      const idx = list.findIndex((s) => s.id === profile.id);
      if (idx >= 0) {
        const updated: SceneProfile = {
          ...list[idx],
          ...profile,
          updatedAt: now,
        };
        list[idx] = updated;
        getStore().set('scenes', list);
        return updated;
      }
    }

    const newScene: SceneProfile = {
      id: profile.id || `scene-${uuidv4().slice(0, 8)}`,
      name: profile.name,
      description: profile.description || '',
      referenceImages: profile.referenceImages || [],
      environment: profile.environment || 'outdoor',
      lightingMood: profile.lightingMood || 'Cinematic daylight',
      colorPalette: profile.colorPalette,
      createdAt: now,
      updatedAt: now,
    };

    list.push(newScene);
    getStore().set('scenes', list);
    return newScene;
  },

  deleteScene(id: string): boolean {
    const list = this.getScenes().filter((s) => s.id !== id);
    getStore().set('scenes', list);
    return true;
  },
};
