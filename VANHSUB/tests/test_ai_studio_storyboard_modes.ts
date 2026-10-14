import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import { AiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shot-modes-'));
  const originalCluster = AiStudioLlmService.getInstance().clusterAndGenerateStoryboard;
  let clusterCalls = 0;
  AiStudioLlmService.getInstance().clusterAndGenerateStoryboard = async () => { clusterCalls++; throw new Error('Explicit shot mode must not cluster'); };
  try {
    const service = new AiStudioStoryboardService();
    const script = { scenes: Array.from({ length: 4 }, (_, i) => ({ scene_id: `scene_${i + 1}`, narration: `Câu thoại ${i + 1}`, visual_note: 'Quiet landscape' })) };
    const timing = { scenes: script.scenes.map((scene, index) => ({ scene_id: scene.scene_id, start_sec: index * 0.5, end_sec: (index + 1) * 0.5, duration_sec: 0.5 })) };
    for (const granularity of ['fast', 'balanced', 'detailed'] as const) {
      const storage = new AiStudioDiskStorageManager(`single-${granularity}`, { baseDir: root });
      const result = await service.generateStoryboard({ storage, script, timing, shotMode: 'single', granularity, enableClustering: true, llmConfig: { provider: 'deepseek' } as any });
      assert.equal(result.scenes.length, 4);
      assert.equal(result.scenes.flatMap(scene => scene.shots).length, 4);
      for (let i = 0; i < 4; i++) {
        assert.deepEqual(result.scenes[i].assigned_sentences, [i + 1]);
        assert.equal(result.scenes[i].shots[0].duration_sec, 0.5);
        assert.equal(result.scenes[i].shots[0].start_sec, i * 0.5);
      }
    }
    const longScript = { scenes: [{ scene_id: 'long', narration: 'A car races down the road', visual_note: 'Action chase', suggestedMediaType: 'video' }] };
    const longTiming = { scenes: [{ scene_id: 'long', start_sec: 0, end_sec: 14, duration_sec: 14 }] };
    const single = await service.generateStoryboard({ storage: new AiStudioDiskStorageManager('long-single', { baseDir: root }), script: longScript, timing: longTiming, shotMode: 'single' });
    assert.equal(single.scenes[0].shots.length, 1);
    assert.equal(single.scenes[0].shots[0].duration_sec, 14, 'A short generation clip must not truncate narration timeline');
    assert.ok(single.scenes[0].shots[0].expected_duration_sec <= 8);
    const multi = await service.generateStoryboard({ storage: new AiStudioDiskStorageManager('long-multi', { baseDir: root }), script: longScript, timing: longTiming, shotMode: 'multi', enableClustering: true });
    assert.ok(multi.scenes[0].shots.length > 1);
    assert.ok(Math.abs(multi.scenes[0].shots.reduce((sum, shot) => sum + (shot.duration_sec || 0), 0) - 14) < 0.01);
    assert.equal(clusterCalls, 0);
    console.log('PASS: single mode remains 1:1 at all granularities; multi mode decomposes; playback duration preserves narration');
  } finally {
    AiStudioLlmService.getInstance().clusterAndGenerateStoryboard = originalCluster;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
