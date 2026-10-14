import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectVisualJobs } from '../main/ai-studio/visualJobs';
import { AiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';
import { VisualProviderRouter } from '../main/ai-studio/providers/VisualProviderRouter';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-visual-jobs-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  try {
    const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const { aiStudioVisualService } = await import('../main/ai-studio/services/AiStudioVisualService');
    const { DEFAULT_AI_STUDIO_CONFIG } = await import('../main/ai-studio/types');
    const { captureSessionConfig } = await import('../main/ai-studio/sessionConfig');
    const existing = path.join(root, 'old.png'); fs.writeFileSync(existing, 'existing image');
    const scenes: any[] = [{ id: 'shot-a', lineIndex: 0, imagePath: existing, assetPath: existing, motionType: 'ken_burns', status: 'ready' }, { id: 'shot-b', lineIndex: 1, motionType: 'video', status: 'pending' }, { id: 'shot-c', lineIndex: 2, imagePath: existing, assetPath: existing, motionType: 'ken_burns', status: 'ready' }];
    assert.deepEqual(selectVisualJobs(scenes).map(scene => scene.id), ['shot-b']);
    assert.deepEqual(selectVisualJobs(scenes, 'regenerate_selected', ['shot-c']).map(scene => scene.id), ['shot-c']);
    assert.equal(selectVisualJobs(scenes, 'regenerate_all').length, 3);
    assert.throws(() => selectVisualJobs(scenes, 'regenerate_selected', []), /chọn/);
    assert.throws(() => selectVisualJobs(scenes, 'regenerate_selected', ['wrong']), /chọn/);
    const engine = new AiStudioPipelineEngine();
    const state: any = { sessionId: 'scope-test', topic: 'Test', currentStage: 6, stageName: 'visuals', status: 'failed', progress: 70,
      workspaceDir: path.join(root, 'episode'), mediaDir: path.join(root, 'media'), gatedMode: true, configSnapshot: captureSessionConfig(DEFAULT_AI_STUDIO_CONFIG),
      stages: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i + 1, { status: 'success', stageName: 'Test' }])), artifacts: { scenes: structuredClone(scenes).map((scene, index) => index === 1 ? { ...scene, motionType: 'ken_burns', status: 'ready', imagePath: existing, assetPath: existing } : scene) }, createdAt: Date.now(), updatedAt: Date.now() };
    engine.persistSessionStateAtomic(state);
    let called: string[] = [], nonce: string | undefined;
    aiStudioVisualService.dispatchVisualAssets = async (jobs, config, output, _progress, _signal, done) => {
      called = jobs.map(scene => scene.id); nonce = config.generationNonce;
      for (let i = 0; i < jobs.length; i++) {
        jobs[i].assetPath = path.join(output, `${jobs[i].id}-${Date.now()}.png`);
        fs.writeFileSync(jobs[i].assetPath!, 'new media'); jobs[i].imagePath = jobs[i].assetPath; jobs[i].status = 'ready';
        await done?.(jobs[i], i);
      }
      return { scenes: jobs, generatedCount: jobs.length, modeUsed: 'google_flow' };
    };
    await (engine as any).runPipelineLoop(state, 6, () => {}, new AbortController().signal, { mode: 'regenerate_selected', selectedShotIds: ['shot-c'] });
    assert.deepEqual(called, ['shot-c']);
    assert.ok(nonce);
    assert.equal(state.artifacts.scenes.length, 3);
    assert.equal(state.artifacts.scenes[0].assetPath, existing);
    assert.equal(state.artifacts.scenes[1].status, 'ready');
    assert.notEqual(state.artifacts.scenes[2].assetPath, existing);
    state.artifacts.scenes[1].imagePath = undefined;
    state.artifacts.scenes[1].assetPath = undefined;
    await assert.rejects(() => (engine as any).runPipelineLoop(state, 6, () => {}, new AbortController().signal, { mode: 'regenerate_selected', selectedShotIds: ['shot-c'] }), /thiếu media/);
    assert.notEqual(state.stages[6].status, 'success', 'Cannot approve render while unselected shots remain missing');
    const router = new VisualProviderRouter();
    const params = { prompt: 'Same prompt', sceneId: 'shot', mediaType: 'image' as const, workspaceScope: root };
    const same = router.generateIdempotencyKey(params);
    assert.equal(same, router.generateIdempotencyKey(params));
    assert.notEqual(same, router.generateIdempotencyKey({ ...params, workspaceScope: root + '-other' }));
    assert.notEqual(same, router.generateIdempotencyKey({ ...params, generationNonce: 'explicit-regenerate' }));
    let requests = 0;
    const executor = async (req: any) => { requests++; fs.writeFileSync(req.targetPath, 'new image'); return { localPath: req.targetPath, provider: 'google_flow_rpc' as const, mediaType: 'image' as const, state: 'COMPLETED' as const }; };
    await router.executeWithIdempotency({ idempotencyKey: same, prompt: 'Same prompt', mediaType: 'image', aspectRatio: '16:9', targetPath: path.join(root, 'first.png') }, executor);
    await router.executeWithIdempotency({ idempotencyKey: same, prompt: 'Same prompt', mediaType: 'image', aspectRatio: '16:9', targetPath: path.join(root, 'unused.png') }, executor);
    assert.equal(requests, 1);
    const forced = router.generateIdempotencyKey({ ...params, generationNonce: 'explicit-regenerate' });
    await router.executeWithIdempotency({ idempotencyKey: forced, prompt: 'Same prompt', mediaType: 'image', aspectRatio: '16:9', targetPath: path.join(root, 'second.png') }, executor);
    assert.equal(requests, 2);
    const service = new AiStudioVisualService(); (service as any).rpcClient = {};
    const paths: string[] = [];
    service.generateViaGoogleFlow = async (scene, output) => { paths.push(output); fs.writeFileSync(output, 'new'); return output; };
    await service.dispatchVisualAssets([{ ...scenes[0] }], {}, root);
    await service.dispatchVisualAssets([{ ...scenes[0] }], {}, root);
    assert.notEqual(paths[0], paths[1]);
    const generatedModes: string[] = [];
    service.generateViaGoogleFlow = async (scene, output, config) => {
      generatedModes.push(scene.motionType);
      if (scene.motionType === 'video') scene.imagePath = existing;
      fs.writeFileSync(output, 'new'); return output;
    };
    const { FlowBridgeServer } = await import('../main/workflow/flow-engine/rpc/FlowBridgeServer');
    const bridge = FlowBridgeServer.getInstance();
    const wasConnected = bridge.isConnected;
    bridge.isConnected = () => true;
    const both = await service.regenerateSceneAsset({ sceneId: 'shot', visualPrompt: 'Prompt', mode: 'both' }, root);
    assert.equal(both.imagePath, existing);
    assert.ok(both.videoPath);
    await service.regenerateSceneAsset({ sceneId: 'shot', visualPrompt: 'Prompt', mode: 'image', flowConfig: { outputMode: 'video' } }, root);
    assert.deepEqual(generatedModes, ['video', 'ken_burns']);
    bridge.isConnected = wasConnected;
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing image');
    console.log('PASS: selected/missing/all scope, real engine subset merge, fresh regeneration cache identity, retry cache and non-overwriting dispatch paths');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
