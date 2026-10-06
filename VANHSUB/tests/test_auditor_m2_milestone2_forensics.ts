/**
 * Independent Forensic Integrity Test Suite for Milestone 2 (M2)
 * Authored by: auditor_m2 (Forensic Auditor)
 *
 * Verifies:
 * 1. Zero static regex keyword arrays (STRONG_VIDEO_KEYWORDS_VI / STRONG_IMAGE_KEYWORDS_VI)
 * 2. Authentic Contextual AI Cinematographer & Dramatic Tension Analysis (no facades)
 * 3. Strict Veo duration clamping [2.0s, 8.0s] across all boundary cases
 * 4. Metaphorical expression discrimination vs genuine physical action
 * 5. Micro-action under extreme tension (gunpoint standoff)
 * 6. Two-Column Audiovisual Script contract integrity and UI structure
 */

import fs from 'fs';
import path from 'path';
import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import type { ScriptBeatLine, CinematographyPlan } from '../main/ai-studio/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${testName}`);
    if (details) console.error(`     Details: ${details}`);
  }
}

async function runForensicAudit() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   INDEPENDENT FORENSIC INTEGRITY AUDIT: MILESTONE 2 (M2)                 ║');
  console.log('║   Auditor: auditor_m2 | Mode: development                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const storyboardService = AiStudioStoryboardService.getInstance();

  // =========================================================================
  // Section 1: Static Codebase Analysis & Keyword Elimination Check
  // =========================================================================
  console.log('--- Section 1: Static Source Code Analysis (Zero Keyword Arrays) ---');

  const storyboardFile = fs.readFileSync(
    path.join(__dirname, '../main/ai-studio/services/AiStudioStoryboardService.ts'),
    'utf-8'
  );

  assert(
    !storyboardFile.includes('STRONG_VIDEO_KEYWORDS_VI'),
    '1.1 STRONG_VIDEO_KEYWORDS_VI is completely eliminated from AiStudioStoryboardService.ts'
  );

  assert(
    !storyboardFile.includes('STRONG_IMAGE_KEYWORDS_VI'),
    '1.2 STRONG_IMAGE_KEYWORDS_VI is completely eliminated from AiStudioStoryboardService.ts'
  );

  assert(
    storyboardFile.includes('planCinematography('),
    '1.3 planCinematography is implemented in AiStudioStoryboardService.ts'
  );

  assert(
    storyboardFile.includes('analyzeDramaticTension('),
    '1.4 analyzeDramaticTension is implemented in AiStudioStoryboardService.ts'
  );

  const scriptWorkspaceFile = fs.readFileSync(
    path.join(__dirname, '../renderer/components/ai-studio/ScriptWorkspaceView.tsx'),
    'utf-8'
  );

  assert(
    scriptWorkspaceFile.includes('Cột 1: Lời thoại') && scriptWorkspaceFile.includes('Cột 2: Hành động'),
    '1.5 ScriptWorkspaceView.tsx explicitly defines 2-Column Audiovisual Script headers'
  );

  assert(
    scriptWorkspaceFile.includes('handleCopyAudiovisualScript') && scriptWorkspaceFile.includes('Sao chép 2 cột'),
    '1.6 ScriptWorkspaceView.tsx provides 2-column audiovisual script copy functionality'
  );

  // =========================================================================
  // Section 2: Authentic Contextual Cinematography (Anti-Facade Checks)
  // =========================================================================
  console.log('\n--- Section 2: Semantic Evaluation & Dramatic Tension (Anti-Facade) ---');

  // 2.1 Action vs Static differentiation
  const actionPlan = storyboardService.planCinematography(
    'Nhân vật chính chạy thục mạng qua con ngõ hẹp để trốn thoát kẻ truy đuổi.',
    'Góc quay theo sát bước chân dồn dập',
    0.85
  );
  assert(
    actionPlan.media_type === 'video',
    '2.1 Dynamic physical chase scene correctly designated as video'
  );

  const staticPlan = storyboardService.planCinematography(
    'Bản đồ địa hình cổ xưa ghi lại các số liệu thống kê về diện tích đế chế.',
    'Hình ảnh bản đồ trải rộng trên bàn gỗ',
    0.2
  );
  assert(
    staticPlan.media_type === 'image',
    '2.2 Static historical map and data presentation correctly designated as image'
  );

  // 2.2 Metaphorical text handling (must NOT trigger false high tension)
  const metaphorTension = storyboardService.analyzeDramaticTension(
    'Doanh nghiệp chính thức bước vào giai đoạn tái cơ cấu sau nhiều năm phát triển.',
    'Biểu đồ tăng trưởng hiển thị trên màn hình'
  );
  assert(
    metaphorTension < 0.5,
    '2.3 Metaphorical expression ("bước vào giai đoạn") does not trigger false action tension',
    `Received tension: ${metaphorTension}`
  );

  // 2.3 Micro-action under extreme tension (gunpoint standoff: no action verbs, but high tension)
  const standoffTension = storyboardService.analyzeDramaticTension(
    'Anh đứng bất động trước họng súng đen ngòm của tên sát thủ, từng giọt mồ hôi lạnh chầm chậm lăn dài.',
    'Đôi mắt căng thẳng cực độ nhìn thẳng vào nòng súng'
  );
  assert(
    standoffTension >= 0.75,
    '2.4 Micro-action at gunpoint standoff recognized as high dramatic tension',
    `Received tension: ${standoffTension}`
  );

  const standoffDecision = storyboardService.decideMediaType(
    'Anh đứng bất động trước họng súng đen ngòm của tên sát thủ, từng giọt mồ hôi lạnh chầm chậm lăn dài.',
    'Đôi mắt căng thẳng cực độ nhìn thẳng vào nòng súng',
    5.0,
    { dramaticTension: standoffTension }
  );
  assert(
    standoffDecision.media_type === 'video' &&
    (standoffDecision.camera_angle === 'close_up' || standoffDecision.camera_angle === 'low_angle'),
    '2.5 Gunpoint standoff generates video with dramatic camera angle (close_up or low_angle)',
    `Angle: ${standoffDecision.camera_angle}, Media: ${standoffDecision.media_type}`
  );

  // =========================================================================
  // Section 3: Veo Duration Clamping [2.0s, 8.0s] Boundaries
  // =========================================================================
  console.log('\n--- Section 3: Veo Video Duration Clamping Boundaries ---');

  const durTooShort = storyboardService.planCinematography('Chiến đấu dồn dập', undefined, 0.9, 0.8);
  assert(
    durTooShort.duration_sec === 2.0,
    '3.1 Under-limit video duration (0.8s) strictly clamped to 2.0s',
    `Got ${durTooShort.duration_sec}`
  );

  const durTooLong = storyboardService.planCinematography('Chiến đấu dồn dập', undefined, 0.9, 14.2);
  assert(
    durTooLong.duration_sec === 8.0,
    '3.2 Over-limit video duration (14.2s) strictly clamped to 8.0s',
    `Got ${durTooLong.duration_sec}`
  );

  const durNegative = storyboardService.planCinematography('Chiến đấu dồn dập', undefined, 0.9, -3.5);
  assert(
    durNegative.duration_sec === 2.0,
    '3.3 Negative video duration (-3.5s) safely clamped to 2.0s',
    `Got ${durNegative.duration_sec}`
  );

  const durNaN = storyboardService.planCinematography('Chiến đấu dồn dập', undefined, 0.9, NaN);
  assert(
    durNaN.duration_sec === 2.0,
    '3.4 NaN video duration safely clamped to 2.0s',
    `Got ${durNaN.duration_sec}`
  );

  const durValid = storyboardService.planCinematography('Chiến đấu dồn dập', undefined, 0.9, 6.5);
  assert(
    durValid.duration_sec === 6.5,
    '3.5 Valid video duration (6.5s) preserved untouched',
    `Got ${durValid.duration_sec}`
  );

  // =========================================================================
  // Section 4: Camera Angle & Motion Contextual Selection
  // =========================================================================
  console.log('\n--- Section 4: Contextual Camera Angle & Motion Decisions ---');

  const wideScene = storyboardService.planCinematography(
    'Toàn cảnh thành phố nhìn từ trên cao lúc hoàng hôn buông xuống.',
    'Bối cảnh đô thị rực rỡ ánh đèn'
  );
  assert(
    wideScene.camera_angle === 'wide_establishing' && wideScene.camera_motion === 'pan_left_to_right',
    '4.1 City panoramic vista assigns wide_establishing angle with pan_left_to_right motion'
  );

  const emotionScene = storyboardService.planCinematography(
    'Ánh mắt nàng ngấn lệ khi nhìn thấy người thân trở về.',
    'Cận cảnh khuôn mặt chan chứa cảm xúc'
  );
  assert(
    emotionScene.camera_angle === 'close_up' && emotionScene.camera_motion === 'dolly_in',
    '4.2 Emotional close-up assigns close_up angle with dolly_in motion'
  );

  // =========================================================================
  // Section 5: Two-Column Script Data Model & Fallback Robustness
  // =========================================================================
  console.log('\n--- Section 5: Two-Column Script Model & Fallback Pipeline ---');

  const llmService = AiStudioLlmService.getInstance();
  const fallbackScript = llmService.generateFallbackScript('Bí ẩn đại dương');

  assert(
    fallbackScript.length >= 4,
    '5.1 Fallback script generates at least 4 beat lines'
  );

  const firstLine = fallbackScript[0];
  assert(
    Boolean(firstLine.text) &&
    Boolean(firstLine.visualAction) &&
    Boolean(firstLine.cameraAngle) &&
    Boolean(firstLine.cameraMovement) &&
    (firstLine.suggestedMediaType === 'video' || firstLine.suggestedMediaType === 'image'),
    '5.2 ScriptBeatLine contains valid Column 1 (voiceover) and Column 2 (visual/camera) properties'
  );

  assert(
    fallbackScript.every(
      (line) =>
        line.suggestedMediaType !== 'video' ||
        (line.estimatedDurationSec >= 2.0 && line.estimatedDurationSec <= 8.0)
    ),
    '5.3 All video beat lines strictly obey [2.0s, 8.0s] duration clamping'
  );

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n==========================================================================');
  console.log(`📊 FORENSIC AUDIT SUMMARY:`);
  console.log(`   Total Forensic Checks: ${totalTests}`);
  console.log(`   Passed:               ${passedTests} ✅`);
  console.log(`   Failed:               ${failedTests} ❌`);
  console.log('==========================================================================');

  if (failedTests > 0) {
    console.error('\n🚨 INTEGRITY VIOLATION DETECTED!');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL FORENSIC CHECKS PASSED: VERDICT IS CLEAN!');
    process.exit(0);
  }
}

void runForensicAudit();
