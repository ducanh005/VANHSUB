import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toStoredScriptScenes } from '../main/ai-studio/scriptStorage';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-visual-directions-'));
  try {
    const lines: any[] = [{ id: 'l1', index: 1, text: 'Lời kể về Tokyo hiện đại.', visualAction: 'Một robot tưới cây cà chua trong căn hộ Tokyo hiện đại.', visualPromptEn: 'Stale generated prompt about a medieval temple', cameraAngle: 'close_up', cameraMovement: 'pan_right_to_left', suggestedMediaType: 'image', voiceDirection: 'Giọng bình tĩnh' },
      { id: 'l2', index: 2, text: 'A quiet landscape', visualNote: 'A still plant', cameraAngle: 'high_angle', cameraMovement: 'static', suggestedMediaType: 'video' }];
    const storage = new AiStudioDiskStorageManager('directions', { baseDir: root });
    storage.saveScript({ scenes: toStoredScriptScenes(lines) });
    const script = storage.readScript()!;
    assert.equal(script.scenes[0].visual_note, lines[0].visualAction);
    assert.equal(script.scenes[0].voiceDirection, 'Giọng bình tĩnh');
    assert.equal(script.scenes[1].suggestedMediaType, 'video');
    const service = new AiStudioStoryboardService();
    const result = await service.generateStoryboard({ storage, script, shotMode: 'single', timing: { scenes: script.scenes.map((scene, index) => ({ scene_id: scene.scene_id, start_sec: index * 4, end_sec: (index + 1) * 4, duration_sec: 4 })) } });
    const first = result.scenes[0].shots[0];
    assert.equal(first.media_type, 'image');
    assert.equal(first.camera_angle, 'close_up');
    assert.equal(first.camera_movement, 'pan_right_to_left');
    assert.ok(first.image_prompt.includes('robot tưới cây cà chua'));
    assert.ok(first.image_prompt.includes('Tokyo hiện đại'));
    assert.ok(first.image_prompt.includes('Close-up'));
    assert.ok(!first.image_prompt.includes('19th century'));
    assert.ok(!first.image_prompt.includes('medieval temple'));
    assert.ok(first.motion_note.includes('pan left'));
    const second = result.scenes[1].shots[0];
    assert.equal(second.media_type, 'video', 'Explicit video is honored even for a static narration');
    assert.equal(second.camera_angle, 'high_angle');
    assert.equal(second.camera_movement, 'static');
    assert.equal(second.visual_action, 'A still plant');
    assert.equal(toStoredScriptScenes([{ id: 'x', index: 1, text: 'Narration only' }])[0].visual_note, undefined);
    console.log('PASS: disk script retains visual/voice directions; storyboard honors manual setting, camera and media choices');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
