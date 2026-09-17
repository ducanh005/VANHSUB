import os from 'os';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import {
  AiStudioConfig,
  DEFAULT_AI_STUDIO_CONFIG,
  DeepPartial,
} from '../ai-studio/types';

// ============================================================================
// 1. Hardware DPAPI Secret Encryption (safeStorage)
// ============================================================================

export const ENC_PREFIX = 'enc:v1:';
export const ENC_HEADLESS_PREFIX = 'enc:v1:headless:';

/**
 * Safely acquires Electron's safeStorage API if available in current process.
 * Gracefully returns null in headless, unit test, or CLI runtimes.
 */
function getSafeStorage(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (typeof electron === 'object' && electron !== null) {
      const safeStorage = electron.safeStorage;
      if (
        safeStorage &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable()
      ) {
        return safeStorage;
      }
    }
  } catch {
    // Not running inside active Electron environment
  }
  return null;
}

/**
 * Encrypts a secret string using Windows DPAPI (via safeStorage).
 * If safeStorage is available, returns 'enc:v1:<base64>'.
 * If unavailable (e.g. CLI, headless test runners), uses obfuscated fallback:
 * returns 'enc:v1:headless:<base64>' so secrets are NEVER stored in plaintext on disk.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (plain.startsWith(ENC_PREFIX)) return plain; // Prevent double encryption (handles both enc:v1: and enc:v1:headless:)

  const storage = getSafeStorage();
  if (storage) {
    try {
      const encryptedBuffer = storage.encryptString(plain);
      return ENC_PREFIX + encryptedBuffer.toString('base64');
    } catch (err) {
      console.warn('[aiStudioStore] DPAPI encryption failed, falling back to headless obfuscation:', err);
    }
  }

  // Headless fallback: reversible base64 obfuscation so disk never has plaintext
  return ENC_HEADLESS_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
}

/**
 * Decrypts an encrypted secret string.
 * Decodes 'enc:v1:headless:<base64>' in headless environments.
 * Decrypts 'enc:v1:<base64>' using Electron safeStorage DPAPI when available.
 * Returns plaintext as-is if unencrypted.
 * Returns empty string if decryption fails.
 */
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored; // Plaintext fallback or legacy

  if (stored.startsWith(ENC_HEADLESS_PREFIX)) {
    try {
      const base64Data = stored.slice(ENC_HEADLESS_PREFIX.length);
      return Buffer.from(base64Data, 'base64').toString('utf8');
    } catch (err) {
      console.error('[aiStudioStore] Headless secret decoding failed:', err);
      return '';
    }
  }

  const storage = getSafeStorage();
  if (storage) {
    try {
      const base64Data = stored.slice(ENC_PREFIX.length);
      const buffer = Buffer.from(base64Data, 'base64');
      return storage.decryptString(buffer);
    } catch (err) {
      console.error('[aiStudioStore] DPAPI decryption failed:', err);
      return '';
    }
  }

  // Headless environment without DPAPI capability
  console.warn('[aiStudioStore] safeStorage unavailable to decrypt DPAPI secret');
  return '';
}

// ============================================================================
// 2. Storage Directory Resolution & Headless Fallback
// ============================================================================

/**
 * Resolves the configuration directory for 'vanhsub-ai-studio.json'.
 * Resolution order:
 * 1. process.env.VANHSUB_AI_STUDIO_DIR (test/custom override)
 * 2. Electron userData directory (when app is ready)
 * 3. Headless fallback: path.join(os.tmpdir(), 'vanhsub-ai-studio')
 */
export function resolveAiStudioCwd(): string | undefined {
  const envDir = process.env.VANHSUB_AI_STUDIO_DIR;
  if (envDir) {
    if (!fs.existsSync(envDir)) {
      try {
        fs.mkdirSync(envDir, { recursive: true });
      } catch {}
    }
    return envDir;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (typeof electron === 'object' && electron !== null) {
      const electronApp = electron.app;
      if (electronApp?.name || electronApp?.getPath) {
        // Running in full Electron app; electron-store will use app userData by default
        return undefined;
      }
    }
  } catch {
    // Not running inside Electron
  }

  // Headless / test fallback
  const tmpDir = path.join(os.tmpdir(), 'vanhsub-ai-studio');
  if (!fs.existsSync(tmpDir)) {
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
    } catch {}
  }
  return tmpDir;
}

function isPlainRecord(val: any): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// ============================================================================
// 3. Lazy Singleton Store Instance
// ============================================================================

let _aiStudioStore: Store<AiStudioConfig> | null = null;

/**
 * Returns the lazy-singleton electron-store instance for AI Studio.
 * Writes to 'vanhsub-ai-studio.json'.
 * Completely isolated from 'vanhsub-settings.json'.
 */
export function getAiStudioStore(): Store<AiStudioConfig> {
  if (!_aiStudioStore) {
    const cwd = resolveAiStudioCwd();
    const storeOptions = {
      name: 'vanhsub-ai-studio',
      clearInvalidConfig: true,
      ...(cwd ? { cwd } : {}),
      defaults: JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG)),
    };

    try {
      _aiStudioStore = new Store<AiStudioConfig>(storeOptions);
      // Access store once to trigger deserialize/syntax check
      void _aiStudioStore.store;
    } catch (err) {
      console.warn('[aiStudioStore] Corrupted config file detected on disk. Backing up and resetting to defaults:', err);
      const targetDir = cwd || (function () {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const electron = require('electron');
          return electron?.app?.getPath?.('userData');
        } catch {
          return undefined;
        }
      })();

      if (targetDir) {
        const filePath = path.join(targetDir, 'vanhsub-ai-studio.json');
        try {
          if (fs.existsSync(filePath)) {
            const backupPath = path.join(targetDir, `vanhsub-ai-studio.corrupted.${Date.now()}.json`);
            fs.renameSync(filePath, backupPath);
          }
        } catch (backupErr) {
          console.error('[aiStudioStore] Failed to backup corrupted file, unlinking:', backupErr);
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
      }

      _aiStudioStore = new Store<AiStudioConfig>(storeOptions);
    }
  }
  return _aiStudioStore;
}

/**
 * Test helper to reset the cached singleton instance.
 * Allows switching directories or re-initializing in unit tests.
 */
export function _resetAiStudioStoreInstance(): void {
  _aiStudioStore = null;
}

// ============================================================================
// 4. Configuration Access & Mutation Methods
// ============================================================================

/**
 * Retrieves the AI Studio configuration.
 * @param options.decrypted When true, decrypts `llm.apiKey` from DPAPI ciphertext.
 *                          When false or omitted, returns stored value (encrypted if DPAPI was used).
 */
export function getAiStudioConfig(options?: { decrypted?: boolean }): AiStudioConfig {
  let store: Store<AiStudioConfig>;
  try {
    store = getAiStudioStore();
  } catch (err) {
    console.warn('[aiStudioStore] Failed to acquire store in getAiStudioConfig, resetting:', err);
    _resetAiStudioStoreInstance();
    store = getAiStudioStore();
  }

  let raw: any;
  try {
    raw = store.store;
  } catch (err) {
    console.warn('[aiStudioStore] Error reading store, recovering with defaults:', err);
    _resetAiStudioStoreInstance();
    store = getAiStudioStore();
    try {
      raw = store.store;
    } catch {
      raw = {};
    }
  }

  const config: AiStudioConfig = isPlainRecord(raw) ? JSON.parse(JSON.stringify(raw)) : ({} as any);

  // Merge with defaults to protect against corrupted or partially populated JSON files
  const merged: AiStudioConfig = {
    llm: { ...DEFAULT_AI_STUDIO_CONFIG.llm, ...(isPlainRecord(config.llm) ? config.llm : {}) },
    voice: { ...DEFAULT_AI_STUDIO_CONFIG.voice, ...(isPlainRecord(config.voice) ? config.voice : {}) },
    flowEngine: { ...DEFAULT_AI_STUDIO_CONFIG.flowEngine, ...(isPlainRecord(config.flowEngine) ? config.flowEngine : {}) },
    rendering: { ...DEFAULT_AI_STUDIO_CONFIG.rendering, ...(isPlainRecord(config.rendering) ? config.rendering : {}) },
    subtitles: { ...DEFAULT_AI_STUDIO_CONFIG.subtitles, ...(isPlainRecord(config.subtitles) ? config.subtitles : {}) },
  };

  if (options?.decrypted) {
    merged.llm.apiKey = decryptSecret(merged.llm.apiKey);
  }

  return merged;
}

/**
 * Retrieves the AI Studio configuration with `llm.apiKey` guaranteed decrypted.
 * Suitable for backend services making outbound LLM API requests.
 */
export function getDecryptedAiStudioConfig(): AiStudioConfig {
  return getAiStudioConfig({ decrypted: true });
}

/**
 * Updates AI Studio configuration with partial changes.
 * Performs deep section merging to avoid overwriting unchanged sibling keys.
 * Automatically encrypts plaintext API keys with DPAPI before persisting to disk.
 */
export function updateAiStudioConfig(
  partial: DeepPartial<AiStudioConfig>,
  options?: { decrypted?: boolean }
): AiStudioConfig {
  if (!partial || typeof partial !== 'object') {
    return getAiStudioConfig(options);
  }

  let store = getAiStudioStore();
  const current = getAiStudioConfig({ decrypted: false });

  const updated: AiStudioConfig = {
    llm: {
      ...current.llm,
      ...(isPlainRecord(partial.llm) ? partial.llm : {}),
    },
    voice: {
      ...current.voice,
      ...(isPlainRecord(partial.voice) ? partial.voice : {}),
    },
    flowEngine: {
      ...current.flowEngine,
      ...(isPlainRecord(partial.flowEngine) ? partial.flowEngine : {}),
    },
    rendering: {
      ...current.rendering,
      ...(isPlainRecord(partial.rendering) ? partial.rendering : {}),
    },
    subtitles: {
      ...current.subtitles,
      ...(isPlainRecord(partial.subtitles) ? partial.subtitles : {}),
    },
  };

  // Encrypt llm.apiKey if modified
  if (partial.llm && 'apiKey' in partial.llm && partial.llm.apiKey !== undefined) {
    if (typeof partial.llm.apiKey === 'string') {
      const rawKey = partial.llm.apiKey.trim();
      if (!rawKey) {
        updated.llm.apiKey = '';
      } else if (rawKey.startsWith(ENC_PREFIX)) {
        // Already encrypted, retain without double-encrypting (handles both enc:v1: and enc:v1:headless:)
        updated.llm.apiKey = rawKey;
      } else {
        // New plaintext key, encrypt with DPAPI or headless fallback
        updated.llm.apiKey = encryptSecret(rawKey);
      }
    } else {
      throw new TypeError(`Invalid apiKey type: expected string, got ${typeof partial.llm.apiKey}`);
    }
  }

  // Persist to disk
  try {
    store.store = updated;
  } catch (err) {
    console.warn('[aiStudioStore] Error persisting update, reinitializing store:', err);
    _resetAiStudioStoreInstance();
    store = getAiStudioStore();
    store.store = updated;
  }

  if (options?.decrypted) {
    return {
      ...updated,
      llm: {
        ...updated.llm,
        apiKey: decryptSecret(updated.llm.apiKey),
      },
    };
  }

  return JSON.parse(JSON.stringify(updated));
}

/**
 * Resets the entire AI Studio configuration back to specification defaults.
 * Writes clean defaults to 'vanhsub-ai-studio.json' on disk.
 */
export function resetAiStudioConfig(): AiStudioConfig {
  let store: Store<AiStudioConfig>;
  try {
    store = getAiStudioStore();
  } catch (err) {
    console.warn('[aiStudioStore] Failed to acquire store in resetAiStudioConfig, recovering:', err);
    _resetAiStudioStoreInstance();
    store = getAiStudioStore();
  }

  const freshDefaults: AiStudioConfig = JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG));
  try {
    store.store = freshDefaults;
  } catch (err) {
    console.warn('[aiStudioStore] Error writing fresh defaults, recovering:', err);
    _resetAiStudioStoreInstance();
    store = getAiStudioStore();
    store.store = freshDefaults;
  }
  return JSON.parse(JSON.stringify(freshDefaults));
}

// ============================================================================
// 5. Facade Object (Vanhsub Convention)
// ============================================================================

export const AiStudioStore = {
  getStore: getAiStudioStore,
  getConfig: getAiStudioConfig,
  getDecryptedConfig: getDecryptedAiStudioConfig,
  updateConfig: updateAiStudioConfig,
  resetConfig: resetAiStudioConfig,
  hasApiKey(): boolean {
    const cfg = getDecryptedAiStudioConfig();
    return Boolean(cfg.llm.apiKey && cfg.llm.apiKey.trim().length > 0);
  },
};
