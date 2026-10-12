import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AiStudioPipelineEngine } from '../main/ai-studio/AiStudioPipelineEngine';
import { updateAiStudioConfig, _resetAiStudioStoreInstance } from '../main/store/aiStudioStore';

async function main() {
  console.log('--- 🧪 REGRESSION TEST: Project Media Isolation Across Different Output Dirs ---');

  const rootTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_proj_isolation_test_'));
  const storeTestDir = path.join(rootTestDir, 'store');
  const projectADir = path.join(rootTestDir, 'ProjectA_Dir');
  const projectBDir = path.join(rootTestDir, 'ProjectB_Dir');

  fs.mkdirSync(storeTestDir, { recursive: true });
  fs.mkdirSync(projectADir, { recursive: true });
  fs.mkdirSync(projectBDir, { recursive: true });

  process.env.VANHSUB_AI_STUDIO_DIR = storeTestDir;
  _resetAiStudioStoreInstance();

  const sessionAId = 'session_proj_A_123';
  const sessionBId = 'session_proj_B_456';

  // Create dummy sample media files
  const sampleImgA = path.join(rootTestDir, 'sample_A.png');
  const sampleImgB = path.join(rootTestDir, 'sample_B.png');
  fs.writeFileSync(sampleImgA, 'PNG_DATA_A');
  fs.writeFileSync(sampleImgB, 'PNG_DATA_B');

  // Configure two projects with the exact same sceneId: scene_01_shot_1
  updateAiStudioConfig({
    savedProjects: [
      {
        id: 'proj_A',
        name: 'Project A',
        outputDir: projectADir,
        channelProfile: {} as any,
        lastSessionId: sessionAId,
        savedSession: {
          sessionId: sessionAId,
          status: 'idle',
          currentStage: 4,
          artifacts: {
            scenes: [
              {
                id: 'scene_01_shot_1',
                shotId: 'scene_01_shot_1',
                lineIndex: 0,
                startMs: 0,
                endMs: 4000,
                durationMs: 4000,
                lineText: 'Scene 1 Project A',
                visualPrompt: 'Prompt A',
                motionType: 'ken_burns',
                status: 'pending',
              },
            ],
          },
        } as any,
        updatedAt: Date.now(),
      },
      {
        id: 'proj_B',
        name: 'Project B',
        outputDir: projectBDir,
        channelProfile: {
          customMediaDir: path.join(projectBDir, 'custom_media_b'),
        } as any,
        lastSessionId: sessionBId,
        savedSession: {
          sessionId: sessionBId,
          status: 'idle',
          currentStage: 4,
          artifacts: {
            scenes: [
              {
                id: 'scene_01_shot_1',
                shotId: 'scene_01_shot_1',
                lineIndex: 0,
                startMs: 0,
                endMs: 4000,
                durationMs: 4000,
                lineText: 'Scene 1 Project B',
                visualPrompt: 'Prompt B',
                motionType: 'ken_burns',
                status: 'pending',
              },
            ],
          },
        } as any,
        updatedAt: Date.now(),
      },
    ],
    // Make Project B active globally
    activeProjectId: 'proj_B',
    channelProfile: {
      customMediaDir: path.join(projectBDir, 'custom_media_b'),
    } as any,
  });

  const engine = new AiStudioPipelineEngine();

  // Test 1: Import media into Project A while Project B is active globally
  console.log('  1. Importing into Project A while Project B is active...');
  const resA = await engine.importSceneMedia({
    sessionId: sessionAId,
    sceneId: 'scene_01_shot_1',
    filePath: sampleImgA,
    mediaType: 'image',
  });

  assert.strictEqual(resA.success, true, 'Import A should succeed');
  assert.ok(resA.assetPath.startsWith(projectADir), `Asset path A (${resA.assetPath}) MUST be inside Project A (${projectADir})`);
  assert.ok(!resA.assetPath.includes('ProjectB_Dir'), 'Asset path A MUST NOT leak into Project B directory');
  assert.strictEqual(fs.existsSync(resA.assetPath), true, 'Imported file must exist in Project A');

  // Test 2: Import media into Project B
  console.log('  2. Importing into Project B...');
  const resB = await engine.importSceneMedia({
    sessionId: sessionBId,
    sceneId: 'scene_01_shot_1',
    filePath: sampleImgB,
    mediaType: 'image',
  });

  assert.strictEqual(resB.success, true, 'Import B should succeed');
  assert.ok(resB.assetPath.startsWith(projectBDir), `Asset path B (${resB.assetPath}) MUST be inside Project B (${projectBDir})`);
  assert.ok(!resB.assetPath.includes('ProjectA_Dir'), 'Asset path B MUST NOT leak into Project A directory');
  assert.strictEqual(fs.existsSync(resB.assetPath), true, 'Imported file must exist in Project B');

  // Test 3: Verify content isolation
  const contentA = fs.readFileSync(resA.assetPath, 'utf8');
  const contentB = fs.readFileSync(resB.assetPath, 'utf8');
  assert.strictEqual(contentA, 'PNG_DATA_A');
  assert.strictEqual(contentB, 'PNG_DATA_B');

  // Test 4: Scenario (b) - Owner Not Found: Throws/returns error, zero files written
  console.log('  3. Scenario (b): Testing Owner Not Found...');
  const unknownSessionId = 'session_orphan_99999';
  const resOrphan = await engine.importSceneMedia({
    sessionId: unknownSessionId,
    sceneId: 'scene_01_shot_1',
    filePath: sampleImgA,
    mediaType: 'image',
  });
  assert.strictEqual(resOrphan.success, false, 'Import on unknown session must fail');
  assert.ok(
    resOrphan.error?.includes('PROJECT_OWNER_NOT_FOUND'),
    `Error must contain PROJECT_OWNER_NOT_FOUND, got: ${resOrphan.error}`
  );
  assert.throws(
    () => engine.resolveOwnerProject(unknownSessionId),
    /PROJECT_OWNER_NOT_FOUND/,
    'resolveOwnerProject on unknown session must throw PROJECT_OWNER_NOT_FOUND'
  );

  // Test 5: Scenario (c) - Conflicting Owners: Throws/returns error before any write
  console.log('  4. Scenario (c): Testing Conflicting Project Owners...');
  const conflictSessionId = 'session_conflict_888';
  updateAiStudioConfig({
    savedProjects: [
      {
        id: 'proj_X',
        name: 'Project X',
        outputDir: path.join(rootTestDir, 'ProjectX_Dir'),
        lastSessionId: conflictSessionId,
        channelProfile: {} as any,
        updatedAt: Date.now(),
      },
      {
        id: 'proj_Y',
        name: 'Project Y',
        outputDir: path.join(rootTestDir, 'ProjectY_Dir'),
        lastSessionId: conflictSessionId,
        channelProfile: {} as any,
        updatedAt: Date.now(),
      },
    ],
  });

  const resConflict = await engine.importSceneMedia({
    sessionId: conflictSessionId,
    sceneId: 'scene_01_shot_1',
    filePath: sampleImgA,
    mediaType: 'image',
  });
  assert.strictEqual(resConflict.success, false, 'Import with conflicting owners must fail');
  assert.ok(
    resConflict.error?.includes('CONFLICTING_PROJECT_OWNERS'),
    `Error must contain CONFLICTING_PROJECT_OWNERS, got: ${resConflict.error}`
  );
  assert.throws(
    () => engine.resolveOwnerProject(conflictSessionId),
    /CONFLICTING_PROJECT_OWNERS/,
    'resolveOwnerProject with conflicting owners must throw CONFLICTING_PROJECT_OWNERS'
  );

  // Test 6: Scenario (d) - In-flight job maintains storage binding when activeProjectId switches
  console.log('  5. Scenario (d): Testing Mid-Flight Active Project Switch...');
  const flightSessionId = 'session_inflight_777';
  const flightDirA = path.join(rootTestDir, 'FlightProjectA_Dir');
  const flightDirB = path.join(rootTestDir, 'FlightProjectB_Dir');
  fs.mkdirSync(flightDirA, { recursive: true });
  fs.mkdirSync(flightDirB, { recursive: true });

  updateAiStudioConfig({
    savedProjects: [
      {
        id: 'proj_flight_A',
        name: 'Flight Project A',
        outputDir: flightDirA,
        lastSessionId: flightSessionId,
        channelProfile: {} as any,
        updatedAt: Date.now(),
      },
      {
        id: 'proj_flight_B',
        name: 'Flight Project B',
        outputDir: flightDirB,
        channelProfile: {} as any,
        updatedAt: Date.now(),
      },
    ],
    activeProjectId: 'proj_flight_A',
  });

  // Acquire storage manager for flightSessionId while Project A is active
  const storage1 = engine.getDiskStorageManager(flightSessionId);
  assert.strictEqual(storage1.baseDir, flightDirA, 'Initial storage binding must point to Project A');

  // Now switch active project globally to Project B
  updateAiStudioConfig({
    activeProjectId: 'proj_flight_B',
  });

  // Re-acquire or operate on flightSessionId - must retain binding to Project A!
  const storage2 = engine.getDiskStorageManager(flightSessionId);
  assert.strictEqual(
    storage2.baseDir,
    flightDirA,
    'Mid-flight storage binding MUST NOT switch to Project B after activeProjectId changes'
  );

  console.log('✅ [PASS] All Project Media Isolation Regression Tests passed successfully!');

  // Cleanup
  try {
    fs.rmSync(rootTestDir, { recursive: true, force: true });
  } catch {}
}

main().catch((err) => {
  console.error('❌ [FAIL] Project Media Isolation Regression Test failed:', err);
  process.exit(1);
});
