/**
 * tests/test_reviewer_m2_ai_studio_adversarial.ts
 *
 * Independent Adversarial Stress Test Suite for Milestone 2 (M2) Review:
 * - Contextual AI Cinematographer Engine
 * - Camera Angle & Motion Planning
 * - Veo Video Duration Clamping (2.0s - 8.0s)
 * - Two-Column Audiovisual Script Data Models & Schemas
 * - PROJECT.md Contract 2 Interface Conformance
 *
 * Runner: .\node_modules\.bin\tsx.cmd tests/test_reviewer_m2_ai_studio_adversarial.ts
 */

import assert from 'assert';
import { AiStudioStoryboardService, aiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioLlmService, aiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import type { CinematographyPlan, ScriptBeatLine } from '../main/ai-studio/types';

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║   ADVERSARIAL STRESS TEST: REVIEWER M2-2 (AI STUDIO MILESTONE 2) ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const findings: string[] = [];

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err?.message || err}`);
    failedTests++;
    findings.push(`${name}: ${err?.message || err}`);
  }
}

async function main() {
  const service = AiStudioStoryboardService.getInstance();

  // ============================================================================
  // Test Category 1: Direct Service Execution (Bypassing SpecificationOracles)
  // ============================================================================
  console.log('--- 🧪 CATEGORY 1: Direct Production Service Testing ---');

  await runTest('ADV-1.1: Direct planCinematography high-tension action scene returns video', () => {
    const plan = service.planCinematography(
      'Sát thủ rút súng đuổi theo mục tiêu qua con hẻm tối',
      'Máy quay tracking rượt đuổi tốc độ cao',
      0.85
    );
    assert.strictEqual(plan.media_type, 'video');
    assert.ok(plan.camera_angle === 'close_up' || plan.camera_angle === 'low_angle' || plan.camera_angle === 'medium_shot');
    assert.ok(plan.camera_motion !== 'static');
    assert(plan.duration_sec >= 2.0 && plan.duration_sec <= 8.0);
  });

  await runTest('ADV-1.2: Direct planCinematography quiet documentary landscape returns image', () => {
    const plan = service.planCinematography(
      'Bản đồ địa lý và biểu đồ thống kê sản lượng lúa gạo năm 1945',
      'Biểu đồ tĩnh kèm các đường chỉ số rõ nét',
      0.15
    );
    assert.strictEqual(plan.media_type, 'image');
    assert(plan.duration_sec >= 2.0);
  });

  await runTest('ADV-1.3: Static accessor planCinematography matches instance execution', () => {
    const staticPlan = AiStudioStoryboardService.planCinematography(
      'Toàn cảnh thành phố Hà Nội về đêm',
      'Đại lộ thênh thang với các tòa nhà rực rỡ',
      0.4
    );
    const instancePlan = service.planCinematography(
      'Toàn cảnh thành phố Hà Nội về đêm',
      'Đại lộ thênh thang với các tòa nhà rực rỡ',
      0.4
    );
    assert.deepStrictEqual(staticPlan, instancePlan);
    assert.strictEqual(staticPlan.camera_angle, 'wide_establishing');
    assert.strictEqual(staticPlan.camera_motion, 'pan_left_to_right');
  });

  // ============================================================================
  // Test Category 2: Extreme Duration Clamping Stress Testing
  // ============================================================================
  console.log('\n--- ⚡ CATEGORY 2: Duration Clamping Boundaries [2.0s, 8.0s] ---');

  await runTest('ADV-2.1: Video duration clamping on lower boundaries (0, negative, 0.5s, 1.99s)', () => {
    const testCases = [0, -10, 0.001, 0.5, 1.2, 1.99, -Infinity];
    for (const d of testCases) {
      const plan = service.planCinematography('Nhân vật chạy thục mạng', undefined, 0.9, d);
      assert.strictEqual(plan.media_type, 'video');
      assert.strictEqual(plan.duration_sec, 2.0, `Expected 2.0s for input ${d}, got ${plan.duration_sec}`);
    }
  });

  await runTest('ADV-2.2: Video duration clamping on upper boundaries (8.01s, 12s, 100s, Infinity)', () => {
    const testCases = [8.01, 8.5, 12.0, 30.0, 100.0];
    for (const d of testCases) {
      const plan = service.planCinematography('Nhân vật chiến đấu quyết liệt', undefined, 0.9, d);
      assert.strictEqual(plan.media_type, 'video');
      assert.strictEqual(plan.duration_sec, 8.0, `Expected 8.0s for input ${d}, got ${plan.duration_sec}`);
    }
  });

  await runTest('ADV-2.3: Video duration handling of NaN and undefined', () => {
    const planNaN = service.planCinematography('Nhân vật chạy', undefined, 0.9, NaN);
    assert.strictEqual(planNaN.duration_sec, 2.0, 'NaN should fallback safely to 2.0s');

    const planUndef = service.planCinematography('Nhân vật chạy', undefined, 0.9, undefined);
    assert.strictEqual(planUndef.duration_sec, 5.0, 'Undefined duration should use sensible 5.0s default');
  });

  await runTest('ADV-2.4: Image duration minimum clamp is 2.0s', () => {
    const planImageShort = service.planCinematography('Tĩnh lặng', undefined, 0.1, 0.5);
    assert.strictEqual(planImageShort.media_type, 'image');
    assert.strictEqual(planImageShort.duration_sec, 2.0, 'Image duration must be at least 2.0s');

    const planImageLong = service.planCinematography('Tĩnh lặng', undefined, 0.1, 15.0);
    assert.strictEqual(planImageLong.media_type, 'image');
    assert.strictEqual(planImageLong.duration_sec, 15.0, 'Image duration can exceed 8.0s for slideshow/Ken Burns');
  });

  // ============================================================================
  // Test Category 3: Metaphor vs Physical Action Resilience
  // ============================================================================
  console.log('\n--- 🧠 CATEGORY 3: Metaphorical Language & Semantic Disambiguation ---');

  await runTest('ADV-3.1: Metaphorical phrases do NOT false-trigger violent action tension', () => {
    const textMetaphor = 'Ông ấy bước vào giai đoạn trầm cảm sau khi công ty sụp đổ';
    const tension = service.analyzeDramaticTension(textMetaphor);
    // Should be low or moderate tension, not >= 0.8
    assert(tension < 0.8, `Tension for metaphor was ${tension}, expected < 0.8`);
  });

  await runTest('ADV-3.2: Empty, whitespace-only, and punctuation-only inputs handle gracefully', () => {
    const emptyPlan = service.planCinematography('', undefined);
    assert.strictEqual(emptyPlan.media_type, 'image');
    assert.strictEqual(emptyPlan.camera_motion, 'static');
    assert.strictEqual(emptyPlan.duration_sec, 4.0);

    const spacesPlan = service.planCinematography('   \n\t  ', '   ');
    assert.strictEqual(spacesPlan.media_type, 'image');

    const punctPlan = service.planCinematography('...?!@#', undefined);
    assert.strictEqual(punctPlan.media_type, 'image');
  });

  // ============================================================================
  // Test Category 4: Two-Column Script Schema Conformance (AiStudioLlmService)
  // ============================================================================
  console.log('\n--- 📋 CATEGORY 4: Two-Column Audiovisual Script Schema Conformance ---');

  await runTest('ADV-4.1: splitScriptToBeatLines produces complete 2-column beat lines', () => {
    const rawScript = `
      Chào mừng các bạn đến với bí mật chưa từng được tiết lộ dưới đáy đại dương!
      Tàu ngầm Alvin bắt đầu lặn sâu xuống độ sâu 4000 mét trong bóng tối dày đặc.
      Đột nhiên, một sinh vật phát quang khổng lồ lướt ngang qua ô kính quan sát.
      Hãy đăng ký kênh để không bỏ lỡ những phát hiện chấn động tiếp theo.
    `;
    const lines = aiStudioLlmService.splitScriptToBeatLines(rawScript);
    assert.strictEqual(lines.length, 4, 'Should parse exactly 4 lines');

    // Check Column 1 (Audio / Voiceover)
    for (const line of lines) {
      assert.strictEqual(typeof line.text, 'string');
      assert.ok(line.text.length > 5);
      // Check Column 2 (Visual & Camera)
      assert.strictEqual(typeof line.visualAction, 'string');
      assert.ok(line.visualAction.length > 0);
      assert.ok(line.suggestedMediaType === 'video' || line.suggestedMediaType === 'image');
      assert.ok(typeof line.cameraAngle === 'string');
      assert.ok(typeof line.cameraMovement === 'string');
      // Duration clamp
      assert(line.estimatedDurationSec! >= 2.0 && line.estimatedDurationSec! <= 8.0);
    }

    // First line should be hook, last outro
    assert.strictEqual(lines[0].beatType, 'hook');
    assert.strictEqual(lines[3].beatType, 'outro');
  });

  await runTest('ADV-4.2: generateStoryboardScenes enforces 2.0s-8.0s on video scenes', () => {
    const beatLines: ScriptBeatLine[] = [
      {
        id: 'beat-1',
        index: 1,
        text: 'Hook ngắn',
        estimatedDurationSec: 1.0, // too short
        suggestedMediaType: 'video',
      },
      {
        id: 'beat-2',
        index: 2,
        text: 'Cảnh hành động rất dài',
        estimatedDurationSec: 15.0, // too long
        suggestedMediaType: 'video',
      },
      {
        id: 'beat-3',
        index: 3,
        text: 'Ảnh phong cảnh tĩnh',
        estimatedDurationSec: 10.0,
        suggestedMediaType: 'image',
      },
    ];

    const scenes = aiStudioLlmService.generateStoryboardScenes(beatLines, {
      aspectRatio: '16:9',
      outputMode: 'video',
      outputsPerScene: 1,
      downloadDir: '',
      concurrency: 1,
      stylePromptPrefix: 'Cinematic',
      negativePrompt: 'blur',
    });

    assert.strictEqual(scenes.length, 3);
    // Scene 1 clamped up to 2.0s
    const dur1 = scenes[0].durationMs / 1000;
    assert.strictEqual(dur1, 2.0, `Expected scene 1 clamped to 2.0s, got ${dur1}`);

    // Scene 2 clamped down to 8.0s
    const dur2 = scenes[1].durationMs / 1000;
    assert.strictEqual(dur2, 8.0, `Expected scene 2 clamped to 8.0s, got ${dur2}`);
  });

  // ============================================================================
  // Test Category 5: Contract 2 Verification (PROJECT.md Interface Specification)
  // ============================================================================
  console.log('\n--- 🔍 CATEGORY 5: PROJECT.md Contract 2 Interface Conformance ---');

  await runTest('ADV-5.1: Check planShotCinematography method on AiStudioStoryboardService', () => {
    const svc = aiStudioStoryboardService as any;
    const hasPlanShot = typeof svc.planShotCinematography === 'function';
    assert.ok(
      hasPlanShot,
      'AiStudioStoryboardService MUST expose planShotCinematography(scene, fullContext) as specified in PROJECT.md § Interface Contracts Contract 2'
    );
  });

  await runTest('ADV-5.2: Check CinematographyPlan return type conformity', () => {
    const dummyScene: ScriptBeatLine = {
      id: 'test-scene-1',
      index: 1,
      text: 'Đặc nhiệm chạy vào căn phòng',
      visualAction: 'Máy quay tracking theo chân đặc nhiệm',
    };
    const plan = service.planCinematography(dummyScene.text, dummyScene.visualAction);
    const validMediaTypes = ['video', 'image'];
    const validAngles = ['wide_establishing', 'medium_shot', 'close_up', 'low_angle', 'high_angle', 'point_of_view'];
    const validMotions = ['pan_left_to_right', 'pan_right_to_left', 'dolly_in', 'dolly_out', 'pedestal_up', 'static'];

    assert.ok(validMediaTypes.includes(plan.media_type), `Invalid media_type: ${plan.media_type}`);
    assert.ok(validAngles.includes(plan.camera_angle), `Invalid camera_angle: ${plan.camera_angle}`);
    assert.ok(validMotions.includes(plan.camera_motion), `Invalid camera_motion: ${plan.camera_motion}`);
    assert.strictEqual(typeof plan.duration_sec, 'number');
    assert.strictEqual(typeof plan.visual_action_description, 'string');
  });

  // Summary
  console.log('\n==================================================================');
  console.log(`TOTAL ADVERSARIAL TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  if (findings.length > 0) {
    console.log('\nFAILING FINDINGS:');
    findings.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('==================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
