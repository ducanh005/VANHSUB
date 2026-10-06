import fs from 'fs';
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

/**
 * Character Anchor Configuration
 * Conforms to PROJECT.md § Interface Contracts (Contract 3)
 */
export interface CharacterAnchorConfig {
  characterId: string;
  name: string;
  visualTraits: string;
  referenceImagePaths: string[];
  lockedSeed?: number;
  gender?: 'male' | 'female' | 'other';
  ageGroup?: string;
  avatarLocalPath?: string;
  role?: string;
  flowAssetId?: string;
}

/**
 * Setting Anchor Configuration
 * Conforms to PROJECT.md § Interface Contracts (Contract 3)
 */
export interface SettingAnchorConfig {
  sceneId: string;
  name: string;
  environmentTraits: string;
  referenceImagePaths: string[];
  lightingMood?: string;
  colorPalette?: string;
  backgroundLocalPath?: string;
  flowAssetId?: string;
}

/**
 * Composite prompt for Imagen: [Style Prefix], [Character: Name, Traits], in scene: [Scene Description]
 * Conforms to PROJECT.md § Interface Contracts (Contract 3)
 */
export function composeCharacterPrompt(
  character: CharacterAnchorConfig,
  sceneDescription: string,
  stylePrefix = 'Cinematic, 8k photorealistic'
): string {
  const traits = character.visualTraits ? `, ${character.visualTraits}` : '';
  return `${stylePrefix}, [Character: ${character.name}${traits}], in scene: ${sceneDescription}`.trim();
}

/**
 * Composite motion prompt for Veo: [Character Name, Traits] [Subject Action], [Camera Movement]
 * Conforms to PROJECT.md § Interface Contracts (Contract 3) & F3.2
 */
export function buildVeoMotionPrompt(
  characterOrParams:
    | CharacterAnchorConfig
    | {
        character?: CharacterAnchorConfig;
        characterAnchorName?: string;
        characterAnchorPrompt?: string;
        characterName?: string;
        characterTraits?: string;
        visualAction?: string;
        subjectAction?: string;
        motionNote?: string;
        cameraMovement?: string;
      },
  subjectActionArg?: string,
  cameraMovementArg?: string
): string {
  if (
    characterOrParams &&
    typeof characterOrParams === 'object' &&
    'characterId' in characterOrParams &&
    'visualTraits' in characterOrParams
  ) {
    const char = characterOrParams as CharacterAnchorConfig;
    const action = subjectActionArg?.trim() || '';
    const motion = cameraMovementArg?.trim() || '';
    const traits = char.visualTraits ? `, ${char.visualTraits}` : '';
    const charHeader = `[${char.name}${traits}]`;
    if (action && motion) {
      return `${charHeader} ${action}, ${motion}`.trim();
    }
    if (action) {
      return `${charHeader} ${action}`.trim();
    }
    if (motion) {
      return `${charHeader} ${motion}`.trim();
    }
    return charHeader;
  }

  const p = (characterOrParams || {}) as {
    character?: CharacterAnchorConfig;
    characterAnchorName?: string;
    characterAnchorPrompt?: string;
    characterName?: string;
    characterTraits?: string;
    visualAction?: string;
    subjectAction?: string;
    motionNote?: string;
    cameraMovement?: string;
  };

  const char = p.character;
  const name = char?.name || p.characterAnchorName || p.characterName;
  const traits = char?.visualTraits || p.characterAnchorPrompt || p.characterTraits;
  const action = p.subjectAction || p.visualAction || subjectActionArg || '';
  const motion = p.cameraMovement || p.motionNote || cameraMovementArg || 'cinematic motion';

  if (name && traits) {
    const charHeader = `[${name}, ${traits}]`;
    return action ? `${charHeader} ${action}, ${motion}`.trim() : `${charHeader} ${motion}`.trim();
  }
  if (name) {
    const charHeader = `[${name}]`;
    return action ? `${charHeader} ${action}, ${motion}`.trim() : `${charHeader} ${motion}`.trim();
  }
  return action ? `${action}, ${motion}`.trim() : motion.trim();
}

interface BibleStoreSchema {
  characters: CharacterProfile[];
  scenes: SceneProfile[];
}

const DEFAULT_CHARACTERS: CharacterProfile[] = [
  {
    id: 'char-bob-newbie-youtuber',
    name: 'Newbie YouTuber Bob',
    description: 'Chàng trai ngáo ngơ hài hước phong cách vẽ tay MS Paint meme: mắt to tròn lồi như mất ngủ, đầu to người nhỏ, mặc vest đen xộc xệch hoặc áo phông đơn giản, nét vẽ nguệch ngoạc ngu ngốc nhưng vô cùng biểu cảm.',
    referenceImages: [],
    gender: 'male',
    ageGroup: 'Crude MS Paint Doodle',
    lockedSeed: 202688,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
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

    if (cwd && !fs.existsSync(cwd)) {
      try {
        fs.mkdirSync(cwd, { recursive: true });
      } catch {}
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
    const list = getStore().get('characters', DEFAULT_CHARACTERS);
    // Tự động bổ sung Bob nếu store cũ chưa có
    if (Array.isArray(list) && !list.some((c) => c.id === 'char-bob-newbie-youtuber')) {
      const bob = DEFAULT_CHARACTERS[0];
      list.unshift(bob);
      getStore().set('characters', list);
    }
    return list;
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

  // --- Character & Setting Anchor Bridge (Milestone 3 / F3.1) ---

  toCharacterAnchor(profile: CharacterProfile): CharacterAnchorConfig {
    return {
      characterId: profile.id,
      name: profile.name,
      visualTraits: profile.description || '',
      referenceImagePaths: profile.referenceImages || [],
      lockedSeed: profile.lockedSeed,
      gender: profile.gender,
      ageGroup: profile.ageGroup,
      avatarLocalPath: profile.referenceImages?.[0],
    };
  },

  toSettingAnchor(profile: SceneProfile): SettingAnchorConfig {
    const traits = profile.description
      ? (profile.description.includes(profile.name) ? profile.description : `${profile.name}. ${profile.description}`)
      : profile.name;
    return {
      sceneId: profile.id,
      name: profile.name,
      environmentTraits: traits,
      referenceImagePaths: profile.referenceImages || [],
      lightingMood: profile.lightingMood,
      colorPalette: profile.colorPalette,
      backgroundLocalPath: profile.referenceImages?.[0],
    };
  },

  getCharacterAnchorById(id: string): CharacterAnchorConfig | undefined {
    const char = this.getCharacterById(id);
    return char ? this.toCharacterAnchor(char) : undefined;
  },

  getSettingAnchorById(id: string): SettingAnchorConfig | undefined {
    const scene = this.getSceneById(id);
    return scene ? this.toSettingAnchor(scene) : undefined;
  },

  getCharacterAnchors(): CharacterAnchorConfig[] {
    return this.getCharacters().map((c) => this.toCharacterAnchor(c));
  },

  getSettingAnchors(): SettingAnchorConfig[] {
    return this.getScenes().map((s) => this.toSettingAnchor(s));
  },

  resolveCharacterAnchor(identifier?: string | CharacterProfile | CharacterAnchorConfig | null): CharacterAnchorConfig | undefined {
    if (!identifier) return undefined;
    if (typeof identifier === 'string') {
      const char = this.getCharacterById(identifier) ||
        this.getCharacters().find((c) => c.name === identifier || c.name.toLowerCase() === identifier.toLowerCase());
      return char ? this.toCharacterAnchor(char) : undefined;
    }
    if ('characterId' in identifier && 'visualTraits' in identifier) {
      return identifier as CharacterAnchorConfig;
    }
    if ('id' in identifier && 'description' in identifier) {
      return this.toCharacterAnchor(identifier as CharacterProfile);
    }
    return undefined;
  },

  resolveSettingAnchor(identifier?: string | SceneProfile | SettingAnchorConfig | null): SettingAnchorConfig | undefined {
    if (!identifier) return undefined;
    if (typeof identifier === 'string') {
      const scene = this.getSceneById(identifier) ||
        this.getScenes().find((s) => s.name === identifier || s.name.toLowerCase() === identifier.toLowerCase());
      return scene ? this.toSettingAnchor(scene) : undefined;
    }
    if ('sceneId' in identifier && 'environmentTraits' in identifier) {
      return identifier as SettingAnchorConfig;
    }
    if ('id' in identifier && 'environment' in identifier) {
      return this.toSettingAnchor(identifier as SceneProfile);
    }
    return undefined;
  },

  bridgeToChannelProfile(options: {
    characterId?: string;
    sceneId?: string;
    existingProfile?: Record<string, any>;
  }): Record<string, any> {
    const result: Record<string, any> = { ...(options.existingProfile || {}) };
    if (options.characterId) {
      const charAnchor = this.getCharacterAnchorById(options.characterId);
      if (charAnchor) {
        result.hostName = charAnchor.name;
        result.hostDescription = charAnchor.visualTraits;
        if (charAnchor.referenceImagePaths.length > 0) {
          result.hostAvatarUrl = charAnchor.referenceImagePaths[0];
        }
        result.channelCharacters = [
          {
            id: charAnchor.characterId,
            name: charAnchor.name,
            descriptionEn: charAnchor.visualTraits,
            avatarUrl: charAnchor.referenceImagePaths[0],
          },
        ];
      }
    }
    if (options.sceneId) {
      const settingAnchor = this.getSettingAnchorById(options.sceneId);
      if (settingAnchor) {
        result.projectBackgroundPrompt = `${settingAnchor.environmentTraits}${
          settingAnchor.lightingMood ? ', ' + settingAnchor.lightingMood : ''
        }`;
      }
    }
    return result;
  },
};
