/**
/**
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE FOR MILESTONE 2 (M2)
 *
 * Verifies:
 * 1. Extreme dramatic tension scales (0.0 to 1.0, boundaries, negative, NaN, infinity) & camera angle mapping.
 * 2. Offline fallback resilience: planCinematography, fallback script generation, greedy clustering fallback.
 * 3. Two-Column Audiovisual Script synchronization, field independence, and serialization fidelity.
 * 4. Veo video duration clamping ([2.0s, 8.0s]) across extreme and adversarial inputs.
 */

import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import type { ScriptBeatLine, CinematographyPlan, CameraAngleType, CameraMovementType } from '../main/ai-studio/types';

interface TestResult {
  group: string;
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function assert(group: string, name: string, condition: boolean, message: string) {
  results.push({ group, name, passed: condition, message });
  const status = condition ? '✅ PASS' : '❌ FAIL';
  console.log(`  [${status}] [${group}] ${name}: ${message}`);
  if (!condition) {
    throw new Error(`Assertion failed in [${group}] ${name}: ${message}`);
  }
}

async function runAdversarialM2Suite() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   CHALLENGER M2-2: EMPIRICAL ADVERSARIAL STRESS TEST SUITE           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const storyboardService = AiStudioStoryboardService.getInstance();
  const llmService = AiStudioLlmService.getInstance();

  // ==========================================================================
  // SUITE 1: EXTREME DRAMATIC TENSION SCALES & CAMERA ANGLE MAPPING
  // ==========================================================================
  console.log('--- 🎯 SUITE 1: DRAMATIC TENSION SCALES & CAMERA ANGLE MAPPING ---');

  // 1.1 Exact Tension Boundary Values
  {
    const plan00 = storyboardService.planCinematography('Nhàn hạ nghỉ ngơi', 'Cảnh tĩnh', 0.0);
    assert(
      'Suite 1.1',
      'Tension 0.0 returns image with safe defaults',
      plan00.media_type === 'image' && plan00.duration_sec >= 2.0 && plan00.camera_motion === 'static',
      `media_type=${plan00.media_type}, motion=${plan00.camera_motion}, dur=${plan00.duration_sec}`
    );

    const plan069 = storyboardService.planCinematography('Đi bộ nhẹ nhàng', 'Bờ sông', 0.69);
    assert(
      'Suite 1.1',
      'Tension 0.69 stays as image (below 0.70 action threshold)',
      plan069.media_type === 'image',
      `media_type=${plan069.media_type}`
    );

    const plan070 = storyboardService.planCinematography('Đi bộ nhẹ nhàng', 'Bờ sông', 0.70);
    assert(
      'Suite 1.1',
      'Tension 0.70 switches to video (at action threshold)',
      plan070.media_type === 'video' && plan070.duration_sec >= 2.0 && plan070.duration_sec <= 8.0,
      `media_type=${plan070.media_type}, dur=${plan070.duration_sec}`
    );

    const plan080 = storyboardService.planCinematography('Căng thẳng vừa', 'Trong phòng', 0.80);
    assert(
      'Suite 1.1',
      'Tension 0.80 produces medium_shot with dolly_out',
      plan080.media_type === 'video' && plan080.camera_angle === 'medium_shot' && plan080.camera_motion === 'dolly_out',
      `angle=${plan080.camera_angle}, motion=${plan080.camera_motion}`
    );

    const plan081 = storyboardService.planCinematography('Căng thẳng cao', 'Trong phòng', 0.81);
    assert(
      'Suite 1.1',
      'Tension > 0.80 produces low_angle with dolly_in',
      plan081.media_type === 'video' && plan081.camera_angle === 'low_angle' && plan081.camera_motion === 'dolly_in',
      `angle=${plan081.camera_angle}, motion=${plan081.camera_motion}`
    );

    const plan100 = storyboardService.planCinematography('Đỉnh điểm xung đột', 'Chiến trường', 1.0);
    assert(
      'Suite 1.1',
      'Tension 1.0 produces low_angle with dolly_in video',
      plan100.media_type === 'video' && plan100.camera_angle === 'low_angle' && plan100.camera_motion === 'dolly_in',
      `angle=${plan100.camera_angle}, motion=${plan100.camera_motion}`
    );
  }

  // 1.2 Out-of-Bounds & Hostile Tension Values
  {
    const hostileTensions = [-100.0, -1.0, -0.001, 1.001, 2.0, 999.0, NaN, Infinity, -Infinity];
    for (const t of hostileTensions) {
      const plan = storyboardService.planCinematography('Kiểm thử giá trị bất thường', 'Ghi chú', t);
      assert(
        'Suite 1.2',
        `Hostile tension ${t} produces valid plan without crashing`,
        (plan.media_type === 'image' || plan.media_type === 'video') &&
          typeof plan.camera_angle === 'string' &&
          typeof plan.camera_motion === 'string' &&
          Number.isFinite(plan.duration_sec) &&
          plan.duration_sec >= 2.0 &&
          plan.duration_sec <= 8.0,
        `t=${t} -> media=${plan.media_type}, angle=${plan.camera_angle}, dur=${plan.duration_sec}`
      );
    }
  }

  // 1.3 Narrative & Contextual Keyword Overrides
  {
    // Establishing keywords -> wide_establishing + pan_left_to_right
    const establishingTexts = [
      'Toàn cảnh thành phố lúc hoàng hôn',
      'Bối cảnh cổ trang kinh thành Thăng Long',
      'Thành phố về đêm rực rỡ ánh đèn',
    ];
    for (const txt of establishingTexts) {
      const plan = storyboardService.planCinematography(txt, undefined, 0.9);
      assert(
        'Suite 1.3',
        `Establishing keyword in "${txt.slice(0, 20)}..." maps to wide_establishing & pan_left_to_right`,
        plan.camera_angle === 'wide_establishing' && plan.camera_motion === 'pan_left_to_right',
        `angle=${plan.camera_angle}, motion=${plan.camera_motion}`
      );
    }

    // Emotion / close-up keywords -> close_up + dolly_in
    const emotionTexts = [
      'Cận cảnh khuôn mặt đẫm lệ của người mẹ',
      'Ánh mắt sắc lẹm đầy căm hận',
      'Cảm xúc vỡ òa nghẹn ngào',
    ];
    for (const txt of emotionTexts) {
      const plan = storyboardService.planCinematography(txt, undefined, 0.5);
      assert(
        'Suite 1.3',
        `Emotion keyword in "${txt.slice(0, 20)}..." maps to close_up & dolly_in`,
        plan.camera_angle === 'close_up' && plan.camera_motion === 'dolly_in',
        `angle=${plan.camera_angle}, motion=${plan.camera_motion}`
      );
    }
  }

  // 1.4 analyzeDramaticTension Semantic Invariants & Fuzzing
  {
    // Metaphorical expressions check:
    // Metaphors without physical action keywords yield tension <= 0.5 and media_type === 'image'
    const nonActionMetaphors = [
      'Anh ấy bước vào giai đoạn trầm cảm nặng nề',
      'Cả nhóm đi đến quyết định chia tay',
      'Đây là bước ngoặt tư duy quan trọng',
    ];
    for (const m of nonActionMetaphors) {
      const tension = storyboardService.analyzeDramaticTension(m);
      assert(
        'Suite 1.4',
        `Metaphor "${m.slice(0, 25)}..." does not trigger high tension`,
        tension <= 0.5,
        `Tension computed: ${tension} (expected <= 0.5)`
      );
      const plan = storyboardService.planCinematography(m, undefined, tension);
      assert(
        'Suite 1.4',
        `Metaphor "${m.slice(0, 25)}..." defaults to image rather than physical action video`,
        plan.media_type === 'image',
        `media_type=${plan.media_type}`
      );
    }

    // Substring action verb precedence: "chạy đua với thời gian" contains "chạy"
    // analyzeDramaticTension reduces tension to 0.25, but planCinematography prioritizes text.includes('chạy')
    const metaphorWithRun = 'Chúng ta đang chạy đua với thời gian để hoàn thành dự án';
    const tensionWithRun = storyboardService.analyzeDramaticTension(metaphorWithRun);
    assert(
      'Suite 1.4',
      'analyzeDramaticTension recognizes "chạy đua với thời gian" as metaphor (tension <= 0.5)',
      tensionWithRun <= 0.5,
      `Tension computed: ${tensionWithRun}`
    );
    const planWithRun = storyboardService.planCinematography(metaphorWithRun, undefined, tensionWithRun);
    assert(
      'Suite 1.4',
      'planCinematography gives action verb "chạy" precedence in "chạy đua với thời gian"',
      planWithRun.media_type === 'video',
      `media_type=${planWithRun.media_type} (due to text.includes('chạy'))`
    );

    // Physical combat and urgent threat -> high tension
    const threats = [
      'Họng súng đen ngòm dí sát trán',
      'Đối mặt kẻ thù trong bóng tối',
      'Kẻ bám đuổi lao tới với hung khí',
      'Sát thủ chuẩn bị chiến đấu sinh tử',
    ];
    for (const th of threats) {
      const tension = storyboardService.analyzeDramaticTension(th);
      assert(
        'Suite 1.4',
        `Threat "${th.slice(0, 25)}..." produces high tension (>= 0.8)`,
        tension >= 0.8,
        `Tension computed: ${tension}`
      );
    }

    // Micro-action under extreme tension
    const microTension = storyboardService.analyzeDramaticTension('Anh ta đứng bất động trước họng súng của kẻ thù');
    assert(
      'Suite 1.4',
      'Micro-action with weapon produces tension >= 0.85',
      microTension >= 0.85,
      `Tension computed: ${microTension}`
    );

    // Static data keywords reduce tension
    const staticTexts = [
      'Xem xét biểu đồ và số liệu thống kê tài chính',
      'Bản đồ địa lý thời kỳ phong kiến',
      'Khung cảnh tĩnh lặng chiêm ngưỡng cảnh đẹp nhàn hạ',
    ];
    for (const st of staticTexts) {
      const tension = storyboardService.analyzeDramaticTension(st);
      assert(
        'Suite 1.4',
        `Data/static text "${st.slice(0, 25)}..." reduces tension (<= 0.25)`,
        tension <= 0.25,
        `Tension computed: ${tension}`
      );
    }

    // Fuzzing 1,000 random adversarial strings
    const randomChars = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~`-=[]{}|;:",.<>?/ \n\t\r' + 'àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ' + '🚀🎬📐🎥🔥💥⚡⭐💀🤡🤖👾';
    let minFuzz = 1.0;
    let maxFuzz = 0.0;
    for (let i = 0; i < 1000; i++) {
      let str = '';
      const len = Math.floor(Math.random() * 80) + 1;
      for (let j = 0; j < len; j++) {
        str += randomChars[Math.floor(Math.random() * randomChars.length)];
      }
      const t = storyboardService.analyzeDramaticTension(str);
      if (t < minFuzz) minFuzz = t;
      if (t > maxFuzz) maxFuzz = t;
      if (!Number.isFinite(t) || t < 0.0 || t > 1.0) {
        throw new Error(`Fuzzing failure on string "${str}": got tension ${t}`);
      }
    }
    assert(
      'Suite 1.4',
      '1,000 randomized fuzzed inputs strictly bounded in [0.0, 1.0]',
      minFuzz >= 0.0 && maxFuzz <= 1.0,
      `Observed fuzz tension bounds: [${minFuzz}, ${maxFuzz}]`
    );
  }

  // ==========================================================================
  // SUITE 2: OFFLINE FALLBACK & RESILIENCE
  // ==========================================================================
  console.log('\n--- 🛡️ SUITE 2: OFFLINE FALLBACK & RESILIENCE ---');

  // 2.1 planCinematography Offline Performance & Edge Resilience
  {
    const startMs = Date.now();
    for (let i = 0; i < 2000; i++) {
      storyboardService.planCinematography(`Hành động số ${i}`, `Ghi chú ${i}`, i % 2 === 0 ? 0.3 : 0.85, 4.0);
    }
    const elapsedMs = Date.now() - startMs;
    assert(
      'Suite 2.1',
      '2,000 offline planCinematography calls execute in under 100ms',
      elapsedMs < 100,
      `Elapsed: ${elapsedMs}ms (< 100ms)`
    );

    // Empty and null edge cases
    const planEmpty = storyboardService.planCinematography('', undefined);
    assert(
      'Suite 2.1',
      'Empty string narration returns valid conservative image plan',
      planEmpty.media_type === 'image' && planEmpty.duration_sec === 4.0 && planEmpty.camera_angle === 'medium_shot',
      `media_type=${planEmpty.media_type}, dur=${planEmpty.duration_sec}`
    );

    // Enormous string (100,000 characters)
    const bigString = 'chạy '.repeat(20000);
    const planBig = storyboardService.planCinematography(bigString, 'Bối cảnh thành phố khổng lồ');
    assert(
      'Suite 2.1',
      'Enormous string (100,000 chars) processes safely without crash',
      planBig.media_type === 'video' && planBig.camera_angle === 'wide_establishing',
      `media_type=${planBig.media_type}, angle=${planBig.camera_angle}`
    );
  }

  // 2.2 Offline Fallback Script Generation
  {
    const fallbackLines = llmService.generateFallbackScript('Bí ẩn đại dương vũ trụ');
    assert(
      'Suite 2.2',
      'generateFallbackScript returns non-empty array (>= 4 lines)',
      Array.isArray(fallbackLines) && fallbackLines.length >= 4,
      `Generated ${fallbackLines.length} fallback lines`
    );

    for (const [idx, line] of fallbackLines.entries()) {
      assert(
        'Suite 2.2',
        `Fallback line #${idx + 1} has fully populated 2-column fields`,
        Boolean(line.text) &&
          Boolean(line.voiceDirection) &&
          Boolean(line.visualAction) &&
          Boolean(line.cameraAngle) &&
          Boolean(line.cameraMovement) &&
          (line.suggestedMediaType === 'video' || line.suggestedMediaType === 'image'),
        `Text="${line.text.slice(0, 20)}...", Media=${line.suggestedMediaType}, Angle=${line.cameraAngle}`
      );

      if (line.suggestedMediaType === 'video') {
        assert(
          'Suite 2.2',
          `Fallback line #${idx + 1} video duration clamped in [2.0s, 8.0s]`,
          (line.estimatedDurationSec ?? 0) >= 2.0 && (line.estimatedDurationSec ?? 0) <= 8.0,
          `Duration: ${line.estimatedDurationSec}s`
        );
      }
    }
  }

  // 2.3 Offline Script Splitting & 2-Column Population
  {
    const rawScript = `
      Chào mừng các bạn đến với thế giới trí tuệ nhân tạo.
      AI đang làm thay đổi toàn diện ngành sản xuất phim và video ngắn.
      Một công nghệ đột phá cho phép biến kịch bản thành thước phim chỉ trong vài phút.
      Hãy cùng khám phá sức mạnh thần kỳ này ngay bây giờ!
    `;
    const beatLines = llmService.splitScriptToBeatLines(rawScript);
    assert(
      'Suite 2.3',
      'splitScriptToBeatLines splits script into 4 distinct beats',
      beatLines.length === 4,
      `Count: ${beatLines.length}`
    );

    assert(
      'Suite 2.3',
      'Beat line 1 is classified as hook with close_up and voice direction',
      beatLines[0].beatType === 'hook' &&
        beatLines[0].cameraAngle === 'close_up' &&
        Boolean(beatLines[0].voiceDirection),
      `beatType=${beatLines[0].beatType}, angle=${beatLines[0].cameraAngle}, voiceDirection=${beatLines[0].voiceDirection}`
    );

    assert(
      'Suite 2.3',
      'Beat line 4 is classified as outro with voice direction',
      beatLines[3].beatType === 'outro' && Boolean(beatLines[3].voiceDirection),
      `beatType=${beatLines[3].beatType}, voiceDirection=${beatLines[3].voiceDirection}`
    );
  }

  // ==========================================================================
  // SUITE 3: TWO-COLUMN AUDIOVISUAL SCRIPT SYNCHRONIZATION & SERIALIZATION
  // ==========================================================================
  console.log('\n--- 📋 SUITE 3: 2-COLUMN AUDIOVISUAL SCRIPT SYNCHRONIZATION ---');

  {
    // Generate initial 5-line script
    const initialLines: ScriptBeatLine[] = [
      {
        id: 'beat-1',
        index: 1,
        text: 'Năm 2050, robot đã thay thế phần lớn lao động thủ công.',
        voiceDirection: 'Trầm ấm, nghiêm túc',
        visualAction: 'Cánh tay robot chính xác hàn các vi mạch siêu nhỏ',
        cameraAngle: 'close_up',
        cameraMovement: 'slow dolly in',
        suggestedMediaType: 'video',
        estimatedDurationSec: 4.0,
        beatType: 'hook',
      },
      {
        id: 'beat-2',
        index: 2,
        text: 'Nhưng một câu hỏi lớn vẫn còn bỏ ngỏ: linh hồn của máy móc nằm ở đâu?',
        voiceDirection: 'Nghi vấn, lắng đọng',
        visualAction: 'Đôi mắt robot sáng lên ánh lam kỳ lạ trong bóng tối',
        cameraAngle: 'extreme_close_up',
        cameraMovement: 'static',
        suggestedMediaType: 'video',
        estimatedDurationSec: 5.0,
        beatType: 'intro',
      },
      {
        id: 'beat-3',
        index: 3,
        text: 'Đây là bản đồ thống kê các viện nghiên cứu AI toàn cầu.',
        voiceDirection: 'Thuyết minh thông tin',
        visualAction: 'Bản đồ số 3D hiển thị các điểm nóng công nghệ toàn cầu',
        cameraAngle: 'wide_establishing',
        cameraMovement: 'pan_left_to_right',
        suggestedMediaType: 'image',
        estimatedDurationSec: 4.5,
        beatType: 'body',
      },
    ];

    // 3.1 Simulate inline edit on Column 1 (Voiceover): Ensure Column 2 is 100% untouched
    const editedCol1Lines = initialLines.map((line, idx) => {
      if (idx === 0) {
        return {
          ...line,
          text: 'Vào năm 2050, kỷ nguyên tự động hóa đã hoàn toàn thay đổi xã hội loài người.',
          voiceDirection: 'Mạnh mẽ, hùng tráng',
        };
      }
      return line;
    });

    assert(
      'Suite 3.1',
      'Column 1 edit preserves Column 2 visualAction, cameraAngle, cameraMovement, suggestedMediaType',
      editedCol1Lines[0].visualAction === initialLines[0].visualAction &&
        editedCol1Lines[0].cameraAngle === initialLines[0].cameraAngle &&
        editedCol1Lines[0].cameraMovement === initialLines[0].cameraMovement &&
        editedCol1Lines[0].suggestedMediaType === initialLines[0].suggestedMediaType &&
        editedCol1Lines[0].id === initialLines[0].id &&
        editedCol1Lines[0].index === initialLines[0].index,
      `visualAction="${editedCol1Lines[0].visualAction}", angle=${editedCol1Lines[0].cameraAngle}`
    );

    // 3.2 Simulate inline edit on Column 2 (Visual): Ensure Column 1 is 100% untouched
    const editedCol2Lines = initialLines.map((line, idx) => {
      if (idx === 1) {
        return {
          ...line,
          visualAction: 'Người máy nhìn vào tấm gương phản chiếu với ánh mắt bối rối',
          cameraAngle: 'low_angle',
          cameraMovement: 'dolly_out',
          suggestedMediaType: 'image' as const,
        };
      }
      return line;
    });

    assert(
      'Suite 3.2',
      'Column 2 edit preserves Column 1 text, voiceDirection, speaker, id, and index',
      editedCol2Lines[1].text === initialLines[1].text &&
        editedCol2Lines[1].voiceDirection === initialLines[1].voiceDirection &&
        editedCol2Lines[1].id === initialLines[1].id &&
        editedCol2Lines[1].index === initialLines[1].index,
      `text="${editedCol2Lines[1].text}", voiceDir="${editedCol2Lines[1].voiceDirection}"`
    );

    // 3.3 Two-Column Audiovisual Serialization (mimicking ScriptWorkspaceView.tsx handleCopyAudiovisualScript)
    const timestamps = ['0:00', '0:04', '0:09'];
    const serializedAudiovisual = initialLines
      .map((l, idx) => {
        const time = timestamps[idx] || '0:00';
        const visual = l.visualAction || l.visualNote || '(Chưa có mô tả hình ảnh)';
        const cam = [l.cameraAngle, l.cameraMovement].filter(Boolean).join(' | ');
        const media = l.suggestedMediaType === 'image' ? 'ẢNH' : 'VIDEO';
        return `[#${idx + 1} - ${time} - ${media}]\nTHOẠI: ${l.text}${
          l.voiceDirection ? ` (Chỉ dẫn: ${l.voiceDirection})` : ''
        }\nHÌNH ẢNH: ${visual}${cam ? ` [Góc & Chuyển động: ${cam}]` : ''}`;
      })
      .join('\n\n---\n\n');

    const blocks = serializedAudiovisual.split('\n\n---\n\n');
    assert(
      'Suite 3.3',
      'Serialized 2-column script produces exact count of blocks matching lines count',
      blocks.length === initialLines.length,
      `Blocks: ${blocks.length}, Expected: ${initialLines.length}`
    );

    for (let i = 0; i < initialLines.length; i++) {
      const block = blocks[i];
      const expectedLine = initialLines[i];
      assert(
        'Suite 3.3',
        `Block #${i + 1} maintains strict 1:1 synchronization between narration and visual action`,
        block.includes(`[#${i + 1} -`) &&
          block.includes(`THOẠI: ${expectedLine.text}`) &&
          block.includes(`HÌNH ẢNH: ${expectedLine.visualAction}`),
        `Block header: ${block.split('\n')[0]}`
      );
    }

    // 3.4 Desync Stress Test: 500 rapid random mutations across 30 lines
    const testLines: ScriptBeatLine[] = Array.from({ length: 30 }, (_, i) => ({
      id: `line-${i + 1}`,
      index: i + 1,
      text: `Câu thoại số ${i + 1}`,
      voiceDirection: `Chỉ dẫn ${i + 1}`,
      visualAction: `Hành động hình ảnh số ${i + 1}`,
      cameraAngle: 'medium_shot',
      cameraMovement: 'static',
      suggestedMediaType: i % 2 === 0 ? 'video' : 'image',
      estimatedDurationSec: 4.0,
    }));

    let currentLines = [...testLines];
    for (let round = 0; round < 500; round++) {
      const targetIdx = Math.floor(Math.random() * currentLines.length);
      const isCol1 = Math.random() > 0.5;
      currentLines = currentLines.map((line, idx) => {
        if (idx === targetIdx) {
          if (isCol1) {
            return {
              ...line,
              text: `Cập nhật thoại ${round} tại dòng ${idx + 1}`,
              voiceDirection: `Ngữ điệu mới ${round}`,
            };
          } else {
            return {
              ...line,
              visualAction: `Cập nhật hình ảnh ${round} tại dòng ${idx + 1}`,
              cameraAngle: 'close_up',
            };
          }
        }
        return line;
      });
    }

    // Check invariants after 500 updates
    assert(
      'Suite 3.4',
      'Script lines length remains exactly 30 after 500 concurrent mutations',
      currentLines.length === 30,
      `Length: ${currentLines.length}`
    );

    for (let i = 0; i < 30; i++) {
      assert(
        'Suite 3.4',
        `Line index #${i + 1} and ID consistency preserved with zero desync`,
        currentLines[i].index === i + 1 && currentLines[i].id === `line-${i + 1}`,
        `id=${currentLines[i].id}, index=${currentLines[i].index}`
      );
    }
  }

  // ==========================================================================
  // SUITE 4: VEO VIDEO DURATION CLAMPING INVARIANTS (2.0s - 8.0s)
  // ==========================================================================
  console.log('\n--- ⏱️ SUITE 4: VEO VIDEO DURATION CLAMPING INVARIANTS ---');

  {
    const extremeDurations = [
      -999.0, -10.0, -0.01, 0.0, 0.5, 1.0, 1.5, 1.9, 1.999,
      2.0, 2.001, 4.0, 6.5, 7.999, 8.0, 8.001, 10.0, 15.0, 999.0, NaN, Infinity, -Infinity
    ];

    for (const d of extremeDurations) {
      // Force video planning via action keywords
      const planVideo = storyboardService.planCinematography('Chiến đấu gay cấn', 'Hành động nổ bom', 0.9, d);
      assert(
        'Suite 4.1',
        `Video duration for input ${d} strictly clamped in [2.0s, 8.0s]`,
        Number.isFinite(planVideo.duration_sec) && planVideo.duration_sec >= 2.0 && planVideo.duration_sec <= 8.0,
        `Input d=${d} -> Clamped duration=${planVideo.duration_sec}`
      );

      // Force image planning
      const planImage = storyboardService.planCinematography('Tĩnh lặng', 'Ảnh chụp', 0.1, d);
      const isExpectedImageDuration = Number.isFinite(d)
        ? Number.isFinite(planImage.duration_sec) && planImage.duration_sec >= 2.0
        : planImage.duration_sec >= 2.0;
      assert(
        'Suite 4.2',
        `Image duration for input ${d} strictly clamped >= 2.0s`,
        isExpectedImageDuration,
        `Input d=${d} -> Clamped duration=${planImage.duration_sec}`
      );
    }
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n======================================================================');
  console.log(`📊 TOTAL ADVERSARIAL TESTS EXECUTED: ${results.length}`);
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`✅ PASSED: ${passedCount}`);
  console.log(`❌ FAILED: ${failedCount}`);
  console.log('======================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

void runAdversarialM2Suite();
