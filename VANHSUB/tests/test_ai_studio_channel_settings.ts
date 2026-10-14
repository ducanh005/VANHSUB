import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-studio-settings-'));
  process.env.VANHSUB_AI_STUDIO_DIR = root;
  try {
    const backend = await import('../main/store/aiStudioStore');
    const { useAiStudioStore } = await import('../renderer/lib/store/aiStudioStore');
    const { DEFAULT_CHANNEL_PROFILE_CONFIG } = await import('../renderer/types/aiStudio');
    const { mergeSettingsDraft, settingsDraftPatch } = await import('../renderer/lib/studioConfigDraft');
    (globalThis as any).window = { vanhsub: { aiStudio: {
      updateConfig: async (patch: any) => backend.updateAiStudioConfig(patch, { decrypted: true }),
      getConfig: async () => backend.getDecryptedAiStudioConfig(),
    } } };
    useAiStudioStore.setState({ config: backend.getDecryptedAiStudioConfig() });
    const store = () => useAiStudioStore.getState();
    for (const id of ['A', 'B']) {
      assert.equal(await store().saveProject({ id, name: id, channelProfile: { ...DEFAULT_CHANNEL_PROFILE_CONFIG, projectName: id }, outputDir: path.join(root, id), updatedAt: Date.now() }), true);
    }
    await store().switchProject('A');
    const staleProjects = structuredClone(store().config.savedProjects!);
    assert.equal(await store().updateChannelProfileConfig({ hostDescription: 'New host', masterPrompt: 'New prompt', specificVoice: 'vi-VN-NamMinhNeural' }), true);
    assert.equal(store().config.savedProjects!.find((p) => p.id === 'A')!.channelProfile.hostDescription, 'New host');
    backend.updateAiStudioConfig({ savedProjects: staleProjects.map((p) => p.id === 'A' ? { ...p, lastSessionId: 'progress-checkpoint' } : p) });
    await store().loadConfig();
    await store().switchProject('B');
    assert.equal(store().config.channelProfile!.hostDescription, '');
    await store().switchProject('A');
    assert.equal(store().config.channelProfile!.hostDescription, 'New host');
    assert.equal(store().config.channelProfile!.masterPrompt, 'New prompt');
    assert.equal(store().config.channelProfile!.specificVoice, 'vi-VN-NamMinhNeural');
    assert.equal(store().config.savedProjects!.find((p) => p.id === 'A')!.lastSessionId, 'progress-checkpoint');
    backend._resetAiStudioStoreInstance();
    assert.equal(backend.getDecryptedAiStudioConfig().savedProjects!.find((p) => p.id === 'A')!.channelProfile.masterPrompt, 'New prompt');

    const before = store().config;
    const draft = { ...before, voice: { ...before.voice, rate: '+20%' } };
    const incoming = { ...before, rendering: { ...before.rendering, resolution: '720p' as const }, savedProjects: [{ ...before.savedProjects![0], lastSessionId: 'newer-session' }, ...before.savedProjects!.slice(1)] };
    const merged = mergeSettingsDraft(draft, incoming, ['voice']);
    assert.equal(merged.voice.rate, '+20%', 'Checkpoint updates must not discard the voice draft');
    assert.equal(merged.rendering.resolution, '720p', 'Untouched sections adopt incoming settings');
    assert.equal(merged.savedProjects![0].lastSessionId, 'newer-session');
    const patch = settingsDraftPatch(merged, ['voice']);
    assert.deepEqual(Object.keys(patch), ['voice'], 'Global settings must not overwrite project data or untouched sections');
    assert.equal(await store().updateConfig(patch), true);
    const savedBeforeFailure = structuredClone(backend.getDecryptedAiStudioConfig());
    (globalThis as any).window.vanhsub.aiStudio.updateConfig = async () => { throw new Error('simulated save failure'); };
    assert.equal(await store().updateChannelProfileConfig({ hostDescription: 'Unsaved host' }), false);
    assert.equal(store().error, 'simulated save failure');
    assert.equal(store().config.channelProfile!.hostDescription, 'New host');
    assert.deepEqual(backend.getDecryptedAiStudioConfig(), savedBeforeFailure);
    console.log('PASS: persistent channel edits, switch/restart, stale checkpoint profile protection, settings draft preservation and failed save rollback');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
