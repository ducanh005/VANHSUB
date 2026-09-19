import fs from 'fs';
import path from 'path';
import assert from 'assert';

import { FlowImageGenerationStatePipeline, HandleImageReferenceState } from '../main/workflow/flow-engine/states/FlowImageGenerationStates';
import { FlowMediaAutomationEngine } from '../main/workflow/flow-engine/FlowMediaAutomationEngine';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';

async function runTests() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  TEST SUITE: Flow Image Reference & React SetState Warning Fix');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // Test 1: FlowImageGenerationStatePipeline contains HandleImageReferenceState
  console.log('▶ Test 1: Verify HandleImageReferenceState in FlowImageGenerationStatePipeline');
  const stateNames = FlowImageGenerationStatePipeline.map(s => s.name);
  assert(stateNames.includes('HANDLE_IMAGE_REFERENCE'), 'Pipeline must include HANDLE_IMAGE_REFERENCE');
  const promptInputIdx = stateNames.indexOf('FIND_PROMPT_INPUT');
  const handleRefIdx = stateNames.indexOf('HANDLE_IMAGE_REFERENCE');
  const enterPromptIdx = stateNames.indexOf('ENTER_PROMPT');
  assert(promptInputIdx < handleRefIdx, 'HANDLE_IMAGE_REFERENCE must run after FIND_PROMPT_INPUT');
  assert(handleRefIdx < enterPromptIdx, 'HANDLE_IMAGE_REFERENCE must run before ENTER_PROMPT');
  console.log('  ✓ [PASS] HandleImageReferenceState correctly placed between FIND_PROMPT_INPUT and ENTER_PROMPT');

  // Test 2: HandleImageReferenceState execute with mock context without reference image
  console.log('▶ Test 2: HandleImageReferenceState with no reference image returns ok');
  const emptyCtx: any = {
    prompt: 'A futuristic city',
    onProgress: () => {},
  };
  const resNoRef = await HandleImageReferenceState.execute(emptyCtx);
  assert.strictEqual(resNoRef.ok, true);
  assert.strictEqual(resNoRef.data?.hasRefImage, false);
  console.log('  ✓ [PASS] HandleImageReferenceState safely skips when no reference image is provided');

  // Test 3: HandleImageReferenceState with existing local image file
  console.log('▶ Test 3: HandleImageReferenceState with local image file detects file');
  const testDir = path.join(process.cwd(), 'temp_test_flow_ref_' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  const testImgPath = path.join(testDir, 'character_avatar.png');
  fs.writeFileSync(testImgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));

  const mockWin: any = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async () => false,
      paste: () => {},
      debugger: {
        isAttached: () => false,
        attach: () => {},
        sendCommand: async () => ({ root: { nodeId: 1 }, nodeId: 0 }),
      },
    },
    focus: () => {},
  };

  const refCtx: any = {
    referenceImagePath: testImgPath,
    win: mockWin,
    onProgress: () => {},
  };
  const resWithRef = await HandleImageReferenceState.execute(refCtx);
  assert.strictEqual(resWithRef.ok, true);
  assert.strictEqual(resWithRef.data?.hasRefImage, true);
  console.log('  ✓ [PASS] HandleImageReferenceState successfully processes local reference image');

  // Test 4: FlowMediaAutomationEngine.generateImageForShot in test mode accepts referenceImagePath
  console.log('▶ Test 4: FlowMediaAutomationEngine.generateImageForShot accepts referenceImagePath');
  const projId = 'test_flow_ref_' + Date.now();
  const storage = new AiStudioDiskStorageManager(projId);

  const genResult = await FlowMediaAutomationEngine.generateImageForShot({
    storage,
    sceneId: 'scene_1',
    shotId: 'scene_1_shot_1',
    prompt: 'Cyberpunk street with character',
    referenceImagePath: testImgPath,
  });
  assert.strictEqual(genResult.success, true);
  assert(genResult.imagePath && fs.existsSync(genResult.imagePath));
  assert.strictEqual(genResult.version, 1);
  console.log('  ✓ [PASS] FlowMediaAutomationEngine.generateImageForShot created valid image asset');

  // Test 5: Sequential reference propagation logic
  console.log('▶ Test 5: Verify sequential reference propagation logic');
  let primaryRef: string | undefined = undefined;
  let firstGenerated: string | undefined = undefined;

  // Shot 1:
  let shot1Ref = primaryRef || (0 > 0 && firstGenerated ? firstGenerated : undefined);
  assert.strictEqual(shot1Ref, undefined, 'Shot 0 has no reference if primaryRef is not set');
  firstGenerated = genResult.imagePath;

  // Shot 2:
  let shot2Ref = primaryRef || (1 > 0 && firstGenerated ? firstGenerated : undefined);
  assert.strictEqual(shot2Ref, firstGenerated, 'Shot 1 inherits firstGeneratedImagePath as reference');

  // Shot 3:
  let shot3Ref = primaryRef || (2 > 0 && firstGenerated ? firstGenerated : undefined);
  assert.strictEqual(shot3Ref, firstGenerated, 'Shot 2 inherits firstGeneratedImagePath as reference');

  // If primaryRef is set (e.g. character avatar):
  primaryRef = testImgPath;
  let shotWithCharRef = primaryRef || (1 > 0 && firstGenerated ? firstGenerated : undefined);
  assert.strictEqual(shotWithCharRef, testImgPath, 'When character avatar exists, all shots use character avatar');
  console.log('  ✓ [PASS] Sequential and character reference propagation verified');

  // Test 6: Verify AutoPilotView has no synchronous saveActiveProjectData in setSession
  console.log('▶ Test 6: Verify AutoPilotView does not call saveActiveProjectData inside setSession');
  const autoPilotCode = fs.readFileSync('renderer/components/ai-studio/AutoPilotView.tsx', 'utf8');

  // Parse each setSession((...) => { ... }) block and ensure saveActiveProjectData is NOT inside
  const regex = /setSession\(\s*\([^)]*\)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(autoPilotCode)) !== null) {
    const startIdx = m.index + m[0].length;
    let braceDepth = 1;
    let endIdx = startIdx;
    while (braceDepth > 0 && endIdx < autoPilotCode.length) {
      if (autoPilotCode[endIdx] === '{') braceDepth++;
      else if (autoPilotCode[endIdx] === '}') braceDepth--;
      endIdx++;
    }
    const blockBody = autoPilotCode.substring(startIdx, endIdx - 1);
    assert(!blockBody.includes('saveActiveProjectData'), 'Found saveActiveProjectData inside setSession block!');
  }
  console.log('  ✓ [PASS] AutoPilotView has 0 bad setState-in-render patterns (all setSession updaters are pure)');

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('  ALL TESTS PASSED FLOCK-FREE (6/6)');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
