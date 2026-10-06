/**
 * tests/test_adversarial_chatgpt_facade_m4.ts
 *
 * Empirical Adversarial Challenger Test Suite for Facade Adapter: ChatGptWebSessionManager.ts
 * Milestone 4: AI Studio Pipeline Adaptor & Facade
 * Role: critic, specialist (Empirical Challenger)
 *
 * Verification Objectives (as specified in DISPATCH.md):
 * 1. Concurrency collision: Simultaneous calls to generateScriptWeb and executePromptTurn,
 *    verifying the isBusy guard, re-entrancy prevention, and serialization.
 * 2. Prompt echo injection: Feed adversarial responses where user prompt text is reflected,
 *    verifying that sanitizePromptEchoFromOutput and isUserPromptEcho purge 100% of user prompt text,
 *    and that validateScriptBeatLines / validateIdeaBlueprint reject contaminated outputs.
 * 3. Headless environment anti-cheat guard: Verify that openLoginWindow correctly throws
 *    when in headless CLI test environment without Electron, preventing silent mock cheating.
 * 4. Error resilience & recovery: Guarantee no deadlocks, state cleanup on exceptions,
 *    Veo duration clamping [2.0s, 8.0s], and Audiovisual two-column extraction purity.
 *
 * Execution:
 *   npx tsx tests/test_adversarial_chatgpt_facade_m4.ts
 */

import assert from 'assert';
import {
  ChatGptWebSessionManager,
  parseChatGptScriptResponse,
  parseChatGptBlueprintResponse,
  calculateScriptPacingMetrics,
  buildScriptPromptForWeb,
  validateScriptBeatLines,
  validateIdeaBlueprint,
  sanitizePromptEchoFromOutput,
  isUserPromptEcho,
  buildPromptWithMarkers,
  type ChatGptLoginStatus,
  type ScriptPacingMetrics,
} from '../main/ai-studio/chatgpt/ChatGptWebSessionManager';

import {
  ChatGptScriptCollector,
  type ScriptCollectionResult,
  type ScriptCollectionOptions,
} from '../main/ai-studio/chatgpt/ChatGptScriptCollector';

import type { ScriptBeatLine, IdeaBlueprint } from '../main/ai-studio/types';

// ==============================================================================
// Test Runner Harness
// ==============================================================================

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: any;
  durationMs: number;
}

const results: TestResult[] = [];
let currentSuite = '';

function suite(name: string) {
  currentSuite = name;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  SUITE: ${name}`);
  console.log(`${'='.repeat(80)}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ suite: currentSuite, name, passed: true, durationMs });
    console.log(`  ✓ [PASS] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({ suite: currentSuite, name, passed: false, error: err, durationMs });
    console.error(`  ✗ [FAIL] ${name} (${durationMs}ms)`);
    console.error(`    Error: ${err?.message || err}`);
    if (err?.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
    }
  }
}

// ==============================================================================
// Helper Mocks & Stubs for Controlled Adversarial Injection
// ==============================================================================

interface CollectorStubController {
  setCheckLoginStatus: (status: { isLoggedIn: boolean; userEmail?: string }) => void;
  setCollectHandler: (
    handler: (opts: ScriptCollectionOptions) => Promise<ScriptCollectionResult>
  ) => void;
  restore: () => void;
}

function installCollectorStub(): CollectorStubController {
  const collector = ChatGptScriptCollector.getInstance();
  const originalCheckLogin = collector.checkLoginStatus.bind(collector);
  const originalCollect = collector.collect.bind(collector);

  let mockLoginStatus = { isLoggedIn: true, userEmail: 'test_user@vanhsub.ai' };
  let mockCollectHandler: (opts: ScriptCollectionOptions) => Promise<ScriptCollectionResult> =
    async (opts) => ({
      text: `=== BEGIN SCRIPT ===\nCÂU 1: Mở đầu ấn tượng.\nCÂU 2: Diễn biến hấp dẫn.\nCÂU 3: Kết thúc sâu sắc.\n=== END SCRIPT ===`,
      rawText: `=== BEGIN SCRIPT ===\nCÂU 1: Mở đầu ấn tượng.\nCÂU 2: Diễn biến hấp dẫn.\nCÂU 3: Kết thúc sâu sắc.\n=== END SCRIPT ===`,
      turnCount: 1,
      durationMs: 50,
      wordCount: 18,
      isTruncated: false,
      continuedTurns: 0,
      continuationTriggered: false,
      conversationUrl: 'https://chatgpt.com/c/mock-convo-id-123',
    });

  collector.checkLoginStatus = async () => mockLoginStatus;
  collector.collect = async (opts: any) => mockCollectHandler(opts);

  return {
    setCheckLoginStatus: (st) => {
      mockLoginStatus = st;
    },
    setCollectHandler: (h) => {
      mockCollectHandler = h;
    },
    restore: () => {
      collector.checkLoginStatus = originalCheckLogin;
      collector.collect = originalCollect;
    },
  };
}

// ==============================================================================
// MAIN ADVERSARIAL TEST EXECUTION
// ==============================================================================

async function runAdversarialTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  ADVERSARIAL STRESS TEST SUITE: CHATGPT WEB SESSION MANAGER FACADE (M4)      ║');
  console.log('║  Empirical Verification: Concurrency, Echo Injection, Anti-Cheat Guard       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  const stub = installCollectorStub();

  try {
    // ==========================================================================
    // 1. CONCURRENCY COLLISION & SERIALIZATION
    // ==========================================================================
    suite('1. Concurrency Collision & Serialization');

    await test('1.1 Simultaneous collision between generateScriptWeb and executePromptTurn', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: true });

      // Simulate a realistic 120ms collection duration
      stub.setCollectHandler(async (opts) => {
        await new Promise((r) => setTimeout(r, 120));
        return {
          text: `=== BEGIN SCRIPT ===\nCÂU 1: Câu thoại thứ nhất.\nCÂU 2: Câu thoại thứ hai.\nCÂU 3: Câu thoại thứ ba.\n=== END SCRIPT ===`,
          rawText: `=== BEGIN SCRIPT ===\nCÂU 1: Câu thoại thứ nhất.\nCÂU 2: Câu thoại thứ hai.\nCÂU 3: Câu thoại thứ ba.\n=== END SCRIPT ===`,
          turnCount: 1,
          durationMs: 120,
          wordCount: 15,
          isTruncated: false,
          continuedTurns: 0,
          continuationTriggered: false,
          conversationUrl: 'https://chatgpt.com/c/concurrency-test-1',
        };
      });

      assert.strictEqual(mgr.isBusy(), false, 'Manager must initially NOT be busy');

      // Trigger both simultaneously
      const task1Promise = mgr.generateScriptWeb('Chủ đề khoa học 1');
      const task2Promise = mgr.executePromptTurn('Prompt turn 2');

      // During active execution, isBusy() must be true
      assert.strictEqual(mgr.isBusy(), true, 'Manager must be busy while task 1 is in progress');
      assert.strictEqual(mgr.isBusySession(), true, 'isBusySession alias must be true');
      assert.strictEqual(mgr.isBusyState(), true, 'isBusyState alias must be true');

      const resultsSettled = await Promise.allSettled([task1Promise, task2Promise]);

      const fulfilled = resultsSettled.filter((r) => r.status === 'fulfilled');
      const rejected = resultsSettled.filter((r) => r.status === 'rejected');

      assert.strictEqual(fulfilled.length, 1, 'Exactly one task must be fulfilled');
      assert.strictEqual(rejected.length, 1, 'Exactly one task must be rejected due to concurrency guard');

      const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
      assert(
        rejectionReason?.message?.includes('ChatGPT Web đang bận thực hiện tác vụ khác'),
        `Expected busy rejection message, got: ${rejectionReason?.message}`
      );

      // After settling, busy state must be reset to false
      assert.strictEqual(mgr.isBusy(), false, 'Manager busy state must reset to false after completion');
    });

    await test('1.2 High-volume race barrage: 10 concurrent requests at exact same tick', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: true });

      stub.setCollectHandler(async () => {
        await new Promise((r) => setTimeout(r, 80));
        return {
          text: `=== BEGIN SCRIPT ===\nCÂU 1: Phân cảnh mở đầu.\nCÂU 2: Phân cảnh cao trào.\nCÂU 3: Phân cảnh kết thúc.\n=== END SCRIPT ===`,
          rawText: `=== BEGIN SCRIPT ===\nCÂU 1: Phân cảnh mở đầu.\nCÂU 2: Phân cảnh cao trào.\nCÂU 3: Phân cảnh kết thúc.\n=== END SCRIPT ===`,
          turnCount: 1,
          durationMs: 80,
          wordCount: 15,
          isTruncated: false,
          continuedTurns: 0,
          continuationTriggered: false,
          conversationUrl: 'https://chatgpt.com/c/barrage-test',
        };
      });

      // Fire 5 generateScriptWeb and 5 executePromptTurn simultaneously
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(mgr.generateScriptWeb(`Chủ đề ${i}`));
        promises.push(mgr.executePromptTurn(`Prompt ${i}`));
      }

      const settled = await Promise.allSettled(promises);
      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');

      assert.strictEqual(fulfilled.length, 1, 'Exactly 1 request out of 10 must succeed');
      assert.strictEqual(rejected.length, 9, 'All 9 competing requests must be cleanly rejected');

      for (const rej of rejected) {
        const reason = (rej as PromiseRejectedResult).reason;
        assert(
          reason?.message?.includes('ChatGPT Web đang bận thực hiện tác vụ khác'),
          `Rejection reason must match busy guard: ${reason?.message}`
        );
      }

      assert.strictEqual(mgr.isBusy(), false, 'Busy flag must be false after all 10 settle');
    });

    await test('1.3 Deadlock immunity: Failure during collection immediately releases busy lock', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: true });

      // Force collect to blow up with an uncaught exception
      stub.setCollectHandler(async () => {
        await new Promise((r) => setTimeout(r, 20));
        throw new Error('Fatal simulated network failure during stream');
      });

      let failed = false;
      try {
        await mgr.generateScriptWeb('Chủ đề lỗi mạng');
      } catch (err: any) {
        failed = true;
        assert(err.message.includes('Fatal simulated network failure'));
      }
      assert(failed, 'Call must throw the simulated network failure');

      // The busy flag MUST be reset to false via finally
      assert.strictEqual(mgr.isBusy(), false, 'busy flag must be reset to false even after exception');

      // Immediate subsequent call must NOT be blocked by deadlock
      stub.setCollectHandler(async () => ({
        text: `=== BEGIN SCRIPT ===\nCÂU 1: Đã phục hồi.\nCÂU 2: Đã sẵn sàng.\nCÂU 3: Tiếp tục hoạt động.\n=== END SCRIPT ===`,
        rawText: `=== BEGIN SCRIPT ===\nCÂU 1: Đã phục hồi.\nCÂU 2: Đã sẵn sàng.\nCÂU 3: Tiếp tục hoạt động.\n=== END SCRIPT ===`,
        turnCount: 1,
        durationMs: 10,
        wordCount: 15,
        isTruncated: false,
        continuedTurns: 0,
        continuationTriggered: false,
        conversationUrl: 'https://chatgpt.com/c/recovery-test',
      }));

      const recoveryResult = await mgr.executePromptTurn('Kiểm tra phục hồi sau deadlock');
      assert(recoveryResult.includes('Đã phục hồi'), 'Immediate subsequent call must succeed');
      assert.strictEqual(mgr.isBusy(), false, 'busy remains false');
    });

    // ==========================================================================
    // 2. PROMPT ECHO INJECTION & ADVERSARIAL SANITIZATION
    // ==========================================================================
    suite('2. Prompt Echo Injection & Adversarial Sanitization');

    await test('2.1 Prompt echo preamble: Full prompt instruction reflected before script', async () => {
      const userPrompt = `
Bạn là nhà biên kịch YouTube cao cấp chuyên viết kịch bản lồng tiếng kể chuyện tài liệu dài triệu view.
NHIỆM VỤ CỐT TỬ VỀ ĐỘ DÀI VÀ NỘI DUNG:
- Độ dài mục tiêu: 5-8 phút (khoảng 1200-1800 từ, từ 40 đến 60 câu).
QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:
1. BẮT BUỘC bọc toàn bộ nội dung kịch bản trong marker:
=== BEGIN SCRIPT ===
CÂU 1: [Hook mở đầu búa bổ...]
=== END SCRIPT ===
CHÚ Ý: Mỗi câu viết trên 1 dòng riêng biệt.
      `.trim();

      const adversarialEchoResponse = `
NHIỆM VỤ:
Viết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho video ngắn độ dài 1-2 phút.
QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:
BẮT BUỘC bọc toàn bộ các câu trong marker:
CHÚ Ý: Mỗi câu viết trên 1 dòng riêng biệt theo đúng cú pháp "CÂU X: ...".
=== BEGIN SCRIPT ===
CÂU 1: Bí ẩn của đại dương đen thẳm đang chờ bạn khám phá!
CÂU 2: Ở độ sâu 10.000 mét, áp lực nước có thể bóp nát kim loại.
CÂU 3: Hãy đăng ký kênh để đồng hành cùng những bí ẩn tiếp theo!
=== END SCRIPT ===
Hy vọng bạn hài lòng với kịch bản này!
      `.trim();

      const sanitized = sanitizePromptEchoFromOutput(adversarialEchoResponse, userPrompt);

      // Verify prompt instruction echoes are completely purged
      assert(!sanitized.includes('NHIỆM VỤ:'), 'Must purge NHIỆM VỤ:');
      assert(!sanitized.includes('QUY ĐỊNH ĐỊNH DẠNG'), 'Must purge QUY ĐỊNH ĐỊNH DẠNG');
      assert(!sanitized.includes('BẮT BUỘC bọc'), 'Must purge BẮT BUỘC bọc');
      assert(!sanitized.includes('CHÚ Ý:'), 'Must purge CHÚ Ý:');

      // Verify valid script is kept
      assert(sanitized.includes('CÂU 1: Bí ẩn của đại dương'), 'Must preserve valid line 1');
      assert(sanitized.includes('CÂU 2: Ở độ sâu'), 'Must preserve valid line 2');
      assert(sanitized.includes('CÂU 3: Hãy đăng ký kênh'), 'Must preserve valid line 3');

      const beats = parseChatGptScriptResponse(sanitized, 'Đại dương');
      assert.strictEqual(beats.length, 3, 'Must parse exactly 3 beats');
      for (const beat of beats) {
        assert.strictEqual(isUserPromptEcho(beat.text), false, 'Beat text must not be an echo');
      }

      const val = validateScriptBeatLines(beats, 3);
      assert.strictEqual(val.isValid, true, 'Cleaned beats must be strictly valid');
    });

    await test('2.2 Conversational lead-in reflecting prompt text before markers', async () => {
      const adversarialInput = `
Chào bạn! Tôi đã nhận được yêu cầu: "Bạn là nhà biên kịch YouTube cao cấp chuyên viết kịch bản lồng tiếng kể chuyện tài liệu dài triệu view".
Sau đây là nội dung chi tiết:
=== BEGIN SCRIPT ===
CÂU 1: Vũ trụ bao la ẩn chứa những bí mật không tưởng.
CÂU 2: Hố đen là nơi mà ngay cả ánh sáng cũng không thể thoát ra.
CÂU 3: Hãy đăng ký kênh để khám phá vũ trụ cùng chúng tôi!
=== END SCRIPT ===
Chúc bạn sản xuất video thành công!
      `.trim();

      const sanitized = sanitizePromptEchoFromOutput(adversarialInput);
      assert(!sanitized.includes('Chào bạn!'), 'Must strip conversational greeting before BEGIN SCRIPT');
      assert(!sanitized.includes('Bạn là nhà biên kịch YouTube cao cấp'), 'Must strip prompt echo before marker');
      assert(sanitized.startsWith('=== BEGIN SCRIPT ==='), 'Sanitized text must begin cleanly at BEGIN SCRIPT marker');

      const beats = parseChatGptScriptResponse(sanitized, 'Vũ trụ');
      assert.strictEqual(beats.length, 3);
      assert.strictEqual(beats[0].text, 'Vũ trụ bao la ẩn chứa những bí mật không tưởng.');
    });

    await test('2.3 Leaked 60+ char prompt instruction sentence inside script body', async () => {
      const longInstruction =
        'BẮT BUỘC: Mỗi phân cảnh phải chứa ít nhất một dữ kiện lịch sử đã được kiểm chứng độc lập.';
      const sentPrompt = `
Kịch bản lịch sử Việt Nam.
${longInstruction}
Yêu cầu định dạng CÂU X: ...
      `.trim();

      // Assistant maliciously or accidentally echoes the long instruction sentence
      const outputWithLeakedSentence = `
=== BEGIN SCRIPT ===
CÂU 1: Năm 938, Ngô Quyền đánh tan quân Nam Hán trên sông Bạch Đằng.
CÂU 2: ${longInstruction}
CÂU 3: Chiến thắng này đã mở ra kỷ nguyên độc lập tự chủ lâu dài cho dân tộc.
=== END SCRIPT ===
      `.trim();

      const sanitized = sanitizePromptEchoFromOutput(outputWithLeakedSentence, sentPrompt);
      assert(!sanitized.includes(longInstruction), '60+ char prompt sentence must be eradicated from output');

      const beats = parseChatGptScriptResponse(sanitized, 'Bạch Đằng');
      for (const b of beats) {
        assert(!b.text.includes(longInstruction), 'No beat may contain the instruction sentence');
      }
    });

    await test('2.4 Contaminated beat in parseChatGptScriptResponse & validateScriptBeatLines', async () => {
      // Line 2 contains a known prompt echo marker
      const rawScript = `
=== BEGIN SCRIPT ===
CÂU 1: Đây là câu mở đầu lôi cuốn người xem ngay lập tức.
CÂU 2: CÂU 1: [Câu thoại mở đầu giật gân, cuốn hút người xem trong 3 giây đầu]
CÂU 3: Đây là phân cảnh nội dung chi tiết về nhân vật.
CÂU 4: Hãy bấm đăng ký kênh để đón xem tập tiếp theo nhé!
=== END SCRIPT ===
      `.trim();

      const beats = parseChatGptScriptResponse(rawScript, 'Test Prompt Echo');
      // Line 2 matches isUserPromptEcho and must be excluded by parseChatGptScriptResponse
      assert.strictEqual(beats.length, 3, 'Contaminated echo line must be skipped by parser');
      assert.strictEqual(beats[0].text, 'Đây là câu mở đầu lôi cuốn người xem ngay lập tức.');
      assert.strictEqual(beats[1].text, 'Đây là phân cảnh nội dung chi tiết về nhân vật.');
      assert.strictEqual(beats[2].text, 'Hãy bấm đăng ký kênh để đón xem tập tiếp theo nhé!');

      // Now construct an artificially contaminated beat to stress validateScriptBeatLines
      const contaminatedBeats: ScriptBeatLine[] = [
        {
          id: 'b1',
          index: 1,
          text: 'Câu hợp lệ đầu tiên',
          beatType: 'hook',
        },
        {
          id: 'b2',
          index: 2,
          text: 'tiếp tục viết phần còn lại', // Matches isUserPromptEcho short echo
          beatType: 'body',
        },
        {
          id: 'b3',
          index: 3,
          text: 'Câu kết thúc hợp lệ',
          beatType: 'outro',
        },
      ];

      const val = validateScriptBeatLines(contaminatedBeats, 3);
      assert.strictEqual(val.isValid, false, 'Contaminated beats must fail validation');
      assert(
        val.reason?.includes('bị lẫn prompt của người dùng'),
        `Validation reason must cite user prompt echo, got: ${val.reason}`
      );
    });

    await test('2.5 Pure prompt echo response rejection in generateScriptWeb and executePromptTurn', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: true });

      // Assistant returns ONLY prompt echo (e.g. repetition of system prompt instructions)
      stub.setCollectHandler(async () => ({
        text: 'Bạn là nhà biên kịch YouTube cao cấp chuyên viết kịch bản lồng tiếng kể chuyện tài liệu dài triệu view.',
        rawText: 'Bạn là nhà biên kịch YouTube cao cấp chuyên viết kịch bản lồng tiếng kể chuyện tài liệu dài triệu view.',
        turnCount: 1,
        durationMs: 40,
        wordCount: 18,
        isTruncated: false,
        continuedTurns: 0,
        continuationTriggered: false,
        conversationUrl: 'https://chatgpt.com/c/pure-echo-test',
      }));

      // In generateScriptWeb
      let threwInGen = false;
      try {
        await mgr.generateScriptWeb('Test Pure Echo');
      } catch (err: any) {
        threwInGen = true;
        assert(
          err.message.includes('Phát hiện phản hồi bị bắt nhầm prompt người dùng'),
          `Expected prompt echo error, got: ${err.message}`
        );
      }
      assert(threwInGen, 'generateScriptWeb must throw when output is pure prompt echo');

      // In executePromptTurn
      let threwInExec = false;
      try {
        await mgr.executePromptTurn('Test Pure Echo Turn');
      } catch (err: any) {
        threwInExec = true;
        assert(
          err.message.includes('Phát hiện phản hồi bị bắt nhầm prompt người dùng'),
          `Expected prompt echo error, got: ${err.message}`
        );
      }
      assert(threwInExec, 'executePromptTurn must throw when output is pure prompt echo');
    });

    await test('2.6 Two-Column Audiovisual extraction and Veo duration clamping under extreme values', async () => {
      // 1. Line-by-line parsing with long sentence (>30 words) on video media
      const longSentence = 'Đây là một câu thoại có độ dài rất lớn bao gồm nhiều từ ngữ liên tiếp nhằm mục đích tạo ra thời lượng âm thanh vượt ngưỡng tám giây để kiểm tra thuật toán clamping của Google Flow Veo có hoạt động chính xác hay không.';
      const adversarialAudiovisual = `
=== BEGIN SCRIPT ===
CÂU 1: ${longSentence} | VISUAL: Toàn cảnh rặng san hô từ trên cao | CAMERA: Drone forward | MEDIA: video
CÂU 2: Những loài cá nhiều màu sắc tung tăng bơi lội trong làn nước biển trong xanh. | VISUAL: Cận cảnh đàn cá hề | CAMERA: Macro static | MEDIA: video
CÂU 3: Bức ảnh san hô hóa thạch hàng triệu năm dưới đáy biển sâu. | VISUAL: Hóa thạch san hô cổ đại | MEDIA: image
CÂU 4: Hãy bảo vệ môi trường biển cùng chúng tôi để giữ gìn vẻ đẹp hoang sơ này! | VISUAL: Biển xanh hoàng hôn | CAMERA: Slow zoom out | MEDIA: video
=== END SCRIPT ===
      `.trim();

      const beats = parseChatGptScriptResponse(adversarialAudiovisual, 'San hô');
      assert.strictEqual(beats.length, 4, 'Must parse 4 beats');

      // Dialogue text purity: zero VISUAL or CAMERA notes leaked into spoken text
      assert.strictEqual(beats[0].text, longSentence);
      assert.strictEqual(beats[1].text, 'Những loài cá nhiều màu sắc tung tăng bơi lội trong làn nước biển trong xanh.');
      assert.strictEqual(beats[2].text, 'Bức ảnh san hô hóa thạch hàng triệu năm dưới đáy biển sâu.');
      assert.strictEqual(beats[3].text, 'Hãy bảo vệ môi trường biển cùng chúng tôi để giữ gìn vẻ đẹp hoang sơ này!');

      // Attribute deconstruction
      assert.strictEqual(beats[0].visualAction, 'Toàn cảnh rặng san hô từ trên cao');
      assert.strictEqual(beats[0].cameraMovement, 'Drone forward');
      assert.strictEqual(beats[0].suggestedMediaType, 'video');

      // Veo Duration Clamping [2.0s, 8.0s]:
      // Beat 1: Word count ~44 words -> >13s -> Clamped to 8.0s
      assert.strictEqual(beats[0].estimatedDurationSec, 8.0, 'Long video line must be clamped down to 8.0s');
      assert(beats[1].estimatedDurationSec! >= 2.0 && beats[1].estimatedDurationSec! <= 8.0, 'Beat 2 in bounds [2.0s, 8.0s]');
      assert(beats[2].estimatedDurationSec! >= 2.0, 'Image duration >= 2.0s');

      // Beat typing classification
      assert.strictEqual(beats[0].beatType, 'hook');
      assert.strictEqual(beats[3].beatType, 'outro');

      const validation = validateScriptBeatLines(beats, 3);
      assert.strictEqual(validation.isValid, true);

      // 2. JSON array parsing with explicit extreme duration values (999.0s and 0.5s)
      const jsonSample = `
=== BEGIN SCRIPT ===
\`\`\`json
[
  { "text": "Câu thoại 1 cực dài", "suggestedMediaType": "video", "estimatedDurationSec": 999.0, "visualAction": "Cảnh 1" },
  { "text": "Câu thoại 2 siêu ngắn", "suggestedMediaType": "video", "estimatedDurationSec": 0.5, "visualAction": "Cảnh 2" },
  { "text": "Câu thoại 3 hình ảnh", "suggestedMediaType": "image", "estimatedDurationSec": 0.8, "visualAction": "Cảnh 3" },
  { "text": "Câu thoại 4 kết thúc", "suggestedMediaType": "video", "estimatedDurationSec": 5.0, "visualAction": "Cảnh 4" }
]
\`\`\`
=== END SCRIPT ===
      `.trim();

      const jsonBeats = parseChatGptScriptResponse(jsonSample, 'Test JSON');
      assert.strictEqual(jsonBeats.length, 4, 'Must parse 4 JSON beats');
      assert.strictEqual(jsonBeats[0].estimatedDurationSec, 8.0, 'JSON video 999s must be clamped down to 8.0s');
      assert.strictEqual(jsonBeats[1].estimatedDurationSec, 2.0, 'JSON video 0.5s must be clamped up to 2.0s');
      assert.strictEqual(jsonBeats[2].estimatedDurationSec, 2.0, 'JSON image 0.8s must be clamped up to 2.0s');
      assert.strictEqual(jsonBeats[3].estimatedDurationSec, 5.0, 'JSON video 5.0s stays 5.0s');
    });

    await test('2.7 Fuzz resilience of sanitizePromptEchoFromOutput and parsers', async () => {
      // Null, undefined, empty, numbers, objects
      assert.strictEqual(sanitizePromptEchoFromOutput(null as any), '');
      assert.strictEqual(sanitizePromptEchoFromOutput(undefined as any), '');
      assert.strictEqual(sanitizePromptEchoFromOutput(''), '');
      assert.strictEqual(sanitizePromptEchoFromOutput('   \n  \t '), '');
      assert.strictEqual(sanitizePromptEchoFromOutput(12345 as any), '');

      assert.deepStrictEqual(parseChatGptScriptResponse(null as any, 'topic'), []);
      assert.deepStrictEqual(parseChatGptScriptResponse(undefined as any, 'topic'), []);
      assert.deepStrictEqual(parseChatGptScriptResponse('', 'topic'), []);
      assert.deepStrictEqual(parseChatGptScriptResponse('   ', 'topic'), []);

      assert.strictEqual(isUserPromptEcho(null as any), false);
      assert.strictEqual(isUserPromptEcho(undefined as any), false);
      assert.strictEqual(isUserPromptEcho(''), false);
      assert.strictEqual(isUserPromptEcho('   '), false);
    });

    // ==========================================================================
    // 3. HEADLESS ENVIRONMENT ANTI-CHEAT GUARD
    // ==========================================================================
    suite('3. Headless Environment Anti-Cheat Guard');

    await test('3.1 Direct openLoginWindow throws explicit error in headless CLI', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();

      // Ensure LIVE_CHROME is NOT set
      const origEnv = process.env.PLAYWRIGHT_LIVE_CHROME;
      delete process.env.PLAYWRIGHT_LIVE_CHROME;

      try {
        let threwWithoutWait = false;
        try {
          await mgr.openLoginWindow(false);
        } catch (err: any) {
          threwWithoutWait = true;
          assert(
            err.message.includes('Môi trường Electron không khả dụng để mở trình duyệt ChatGPT'),
            `Unexpected error message: ${err.message}`
          );
        }
        assert(threwWithoutWait, 'openLoginWindow(false) must throw in headless CLI');

        let threwWithWait = false;
        try {
          await mgr.openLoginWindow(true);
        } catch (err: any) {
          threwWithWait = true;
          assert(
            err.message.includes('Môi trường Electron không khả dụng để mở trình duyệt ChatGPT'),
            `Unexpected error message: ${err.message}`
          );
        }
        assert(threwWithWait, 'openLoginWindow(true) must throw in headless CLI without 5-minute hanging');
      } finally {
        if (origEnv !== undefined) {
          process.env.PLAYWRIGHT_LIVE_CHROME = origEnv;
        }
      }
    });

    await test('3.2 Unauthenticated generateScriptWeb propagates headless error without mock cheat', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: false }); // Unauthenticated!

      let progressMessages: string[] = [];
      let threw = false;

      try {
        await mgr.generateScriptWeb('Chủ đề test chưa login', 'youtube_story', 'offscreen', (m) =>
          progressMessages.push(m)
        );
      } catch (err: any) {
        threw = true;
        assert(
          err.message.includes('Môi trường Electron không khả dụng để mở trình duyệt ChatGPT'),
          `Expected headless error, got: ${err.message}`
        );
      }

      assert(threw, 'Must throw headless error when attempting to open login in CLI');
      assert(
        progressMessages.some((msg) => msg.includes('Đang mở cửa sổ đăng nhập')),
        'Must log login opening progress'
      );
      assert.strictEqual(mgr.isBusy(), false, 'Busy flag must be cleanly reset to false');
    });

    await test('3.3 Unauthenticated executePromptTurn propagates headless error without mock cheat', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: false }); // Unauthenticated!

      let threw = false;
      try {
        await mgr.executePromptTurn('Test prompt unauthenticated');
      } catch (err: any) {
        threw = true;
        assert(
          err.message.includes('Môi trường Electron không khả dụng để mở trình duyệt ChatGPT'),
          `Expected headless error, got: ${err.message}`
        );
      }

      assert(threw, 'executePromptTurn must throw headless error when unauthenticated in CLI');
      assert.strictEqual(mgr.isBusy(), false, 'Busy flag must be cleanly reset to false');
    });

    // ==========================================================================
    // 4. ADVERSARIAL TARGETED RETRY & SCHEMA VALIDATION
    // ==========================================================================
    suite('4. Adversarial Targeted Retry & Schema Validation');

    await test('4.1 Malformed script triggers targeted retry and recovers', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: true });

      let attempts = 0;
      let progressLogged: string[] = [];

      stub.setCollectHandler(async (opts) => {
        attempts++;
        if (attempts === 1) {
          // Attempt 1: Malformed output with < 3 beats
          return {
            text: 'Đây là câu trả lời ngắn không đúng định dạng.',
            rawText: 'Đây là câu trả lời ngắn không đúng định dạng.',
            turnCount: 1,
            durationMs: 30,
            wordCount: 10,
            isTruncated: false,
            continuedTurns: 0,
            continuationTriggered: false,
            conversationUrl: 'https://chatgpt.com/c/retry-test',
          };
        } else {
          // Attempt 2 (Retry): Proper formatted script
          assert(opts.prompt.includes('Kịch bản bạn vừa viết chưa đúng định dạng'));
          return {
            text: `=== BEGIN SCRIPT ===\nCÂU 1: Câu mở đầu sau retry.\nCÂU 2: Nội dung thân bài sau retry.\nCÂU 3: Lời kết sau retry.\n=== END SCRIPT ===`,
            rawText: `=== BEGIN SCRIPT ===\nCÂU 1: Câu mở đầu sau retry.\nCÂU 2: Nội dung thân bài sau retry.\nCÂU 3: Lời kết sau retry.\n=== END SCRIPT ===`,
            turnCount: 2,
            durationMs: 40,
            wordCount: 20,
            isTruncated: false,
            continuedTurns: 0,
            continuationTriggered: false,
            conversationUrl: 'https://chatgpt.com/c/retry-test',
          };
        }
      });

      const result = await mgr.generateScriptWeb('Chủ đề retry', 'youtube_story', 'offscreen', (msg) => {
        progressLogged.push(msg);
      });

      assert.strictEqual(attempts, 2, 'Must execute exactly 2 attempts (initial + retry)');
      assert(
        progressLogged.some((m) => m.includes('Kịch bản chưa đúng định dạng. Đang tự động retry')),
        'Must report retry progress to user'
      );
      assert(result.includes('Câu mở đầu sau retry'), 'Final result must be the recovered script');

      const beats = parseChatGptScriptResponse(result, 'Chủ đề retry');
      assert.strictEqual(beats.length, 3, 'Must parse 3 recovered beats');
    });

    await test('4.2 Malformed Idea Blueprint JSON triggers repair prompt and recovers', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      stub.setCheckLoginStatus({ isLoggedIn: true });

      let attempts = 0;
      let progressLogged: string[] = [];

      stub.setCollectHandler(async (opts) => {
        attempts++;
        if (attempts === 1) {
          // Attempt 1: Defective JSON missing hookConcept, outline, estimatedDurationSec
          return {
            text: `=== BEGIN JSON ===\n{\n  "title": "Chủ đề thiếu trường"\n}\n=== END JSON ===`,
            rawText: `=== BEGIN JSON ===\n{\n  "title": "Chủ đề thiếu trường"\n}\n=== END JSON ===`,
            turnCount: 1,
            durationMs: 30,
            wordCount: 8,
            isTruncated: false,
            continuedTurns: 0,
            continuationTriggered: false,
            conversationUrl: 'https://chatgpt.com/c/idea-repair',
          };
        } else {
          // Attempt 2: Repaired JSON conforming to schema
          assert(opts.prompt.includes('Khối JSON trước đó chưa hợp lệ'));
          return {
            text: `=== BEGIN JSON ===\n{\n  "title": "Bí Mật Kim Tự Tháp",\n  "hookConcept": "Ai đã xây dựng kỳ quan này trong 20 năm?",\n  "narrativeAngle": "Khảo cổ học vệ tinh và tài liệu giấy cói Merer",\n  "outline": [\n    "1. Phát hiện mới tại Wadi al-Jarf",\n    "2. Nhật ký thuyền trưởng Merer",\n    "3. Kỹ thuật vận chuyển đá bằng đường thủy"\n  ],\n  "estimatedDurationSec": 420\n}\n=== END JSON ===`,
            rawText: `=== BEGIN JSON ===\n{\n  "title": "Bí Mật Kim Tự Tháp",\n  "hookConcept": "Ai đã xây dựng kỳ quan này trong 20 năm?",\n  "narrativeAngle": "Khảo cổ học vệ tinh và tài liệu giấy cói Merer",\n  "outline": [\n    "1. Phát hiện mới tại Wadi al-Jarf",\n    "2. Nhật ký thuyền trưởng Merer",\n    "3. Kỹ thuật vận chuyển đá bằng đường thủy"\n  ],\n  "estimatedDurationSec": 420\n}\n=== END JSON ===`,
            turnCount: 2,
            durationMs: 40,
            wordCount: 45,
            isTruncated: false,
            continuedTurns: 0,
            continuationTriggered: false,
            conversationUrl: 'https://chatgpt.com/c/idea-repair',
          };
        }
      });

      const result = await mgr.executePromptTurn(
        'Tạo ý tưởng video Kim Tự Tháp',
        'offscreen',
        (msg) => progressLogged.push(msg),
        false,
        undefined,
        'idea'
      );

      assert.strictEqual(attempts, 2, 'Must execute exactly 2 attempts');
      assert(
        progressLogged.some((m) => m.includes('Ý tưởng chưa đủ trường')),
        'Must log schema repair progress'
      );

      const blueprint = parseChatGptBlueprintResponse(result, 'Kim Tự Tháp');
      const val = validateIdeaBlueprint(blueprint);
      assert.strictEqual(val.isValid, true, 'Repaired blueprint must pass validation');
      assert.strictEqual(blueprint.title, 'Bí Mật Kim Tự Tháp');
      assert.strictEqual(blueprint.outline?.length, 3);
      assert.strictEqual(blueprint.estimatedDurationSec, 420);
    });

    // ==========================================================================
    // 5. THREAD CONTINUITY & LIFECYCLE MANAGEMENT
    // ==========================================================================
    suite('5. Thread Continuity & Lifecycle Management');

    await test('5.1 Conversation URL propagation and reset lifecycle', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();
      mgr.resetConversation();

      assert.strictEqual(mgr.getLastConversationUrl(), null);

      mgr.setLastConversationUrl('https://chatgpt.com/c/url-step-1');
      assert.strictEqual(mgr.getLastConversationUrl(), 'https://chatgpt.com/c/url-step-1');

      mgr.resetConversation();
      assert.strictEqual(mgr.getLastConversationUrl(), null);

      mgr.setLastConversationUrl('https://chatgpt.com/c/url-step-2');
      await mgr.closeWindow();
      await mgr.logout();
      assert.strictEqual(mgr.getLastConversationUrl(), null, 'Logout must clear last conversation URL');
    });

    // ==========================================================================
    // 6. DEEP EDGE CASES & SYNTACTIC INVARIANTS
    // ==========================================================================
    suite('6. Deep Edge Cases & Syntactic Invariants');

    await test('6.1 Fallback paragraph/sentence splitting when response lacks "CÂU X:" prefixes', async () => {
      const naturalProse = `
Đại dương sâu thẳm luôn là nơi chứa đựng những điều kỳ bí nhất hành tinh chúng ta.
Hàng ngàn loài sinh vật kỳ dị sinh sống dưới áp lực hàng ngàn tấn nước biển.
Các nhà khoa học vẫn đang tiếp tục chế tạo các tàu ngầm thế hệ mới để thám hiểm.
Hãy cùng chúng tôi khám phá những bí ẩn chưa từng được công bố trong video hôm nay!
      `.trim();

      const beats = parseChatGptScriptResponse(naturalProse, 'Đại dương');
      assert(beats.length >= 3, `Expected at least 3 beats from natural prose, got ${beats.length}`);
      assert.strictEqual(beats[0].beatType, 'hook');
      assert.strictEqual(beats[beats.length - 1].beatType, 'outro');
      assert.strictEqual(beats[beats.length - 2].beatType, 'climax');

      const val = validateScriptBeatLines(beats, 3);
      assert.strictEqual(val.isValid, true);
    });

    await test('6.2 Idea Blueprint regex recovery on catastrophic JSON syntax corruption', async () => {
      const brokenJson = `
=== BEGIN JSON ===
{
  "title": "Bí Ẩn Hố Đen Vũ Trụ",
  "hookConcept": "Điều gì xảy ra khi bạn rơi vào chân trời sự kiện?",
  "narrativeAngle": "Vật lý thiên văn lượng tử và thuyết tương đối rộng",
  "outline": [
    "1. Khái niệm chân trời sự kiện",
    "2. Hiệu ứng mì ống spaghettification"
    "3. Bức xạ Hawking và kết luận"
  ],,,
  "estimatedDurationSec": 360,
  INVALID_TRAILING_GARBAGE
=== END JSON ===
      `.trim();

      const bp = parseChatGptBlueprintResponse(brokenJson, 'Hố Đen');
      assert.strictEqual(bp.title, 'Bí Ẩn Hố Đen Vũ Trụ');
      assert.strictEqual(bp.hookConcept, 'Điều gì xảy ra khi bạn rơi vào chân trời sự kiện?');
      assert.strictEqual(bp.narrativeAngle, 'Vật lý thiên văn lượng tử và thuyết tương đối rộng');
      assert(bp.outline.length >= 3, 'Outline must have at least 3 items');
      assert(bp.estimatedDurationSec > 0, 'Estimated duration must be positive');
      assert.strictEqual(bp.estimatedDurationSec, 300, 'Regex fallback defaults to 300s for 16:9');

      const val = validateIdeaBlueprint(bp);
      assert.strictEqual(val.isValid, true, 'Recovered blueprint must pass validation');
    });

    await test('6.3 Pacing metrics calculations across all duration tiers', async () => {
      // Shorts 30-60s
      const p30 = calculateScriptPacingMetrics(
        { topic: 'T', aspectRatio: '9:16' } as any,
        { targetShortDuration: '30_60_sec' }
      );
      assert.strictEqual(p30.isShorts, true);
      assert.strictEqual(p30.targetDurationSec, 45);
      assert.strictEqual(p30.minSentences, 5);
      assert.strictEqual(p30.maxSentences, 8);

      // Shorts 60-90s
      const p60 = calculateScriptPacingMetrics(
        { topic: 'T', aspectRatio: '9:16' } as any,
        { targetShortDuration: '60_90_sec' }
      );
      assert.strictEqual(p60.isShorts, true);
      assert.strictEqual(p60.targetDurationSec, 75);
      assert.strictEqual(p60.minSentences, 8);
      assert.strictEqual(p60.maxSentences, 14);

      // Long video 5-8 min
      const pLong5_8 = calculateScriptPacingMetrics(
        { topic: 'T', aspectRatio: '16:9' } as any,
        { targetLongDuration: '5_8_min' }
      );
      assert.strictEqual(pLong5_8.isShorts, false);
      assert.strictEqual(pLong5_8.targetDurationSec, 390);
      assert.strictEqual(pLong5_8.minSentences, 40);
      assert.strictEqual(pLong5_8.maxSentences, 60);

      // Long video 8-12 min
      const pLong8_12 = calculateScriptPacingMetrics(
        { topic: 'T', aspectRatio: '16:9' } as any,
        { targetLongDuration: '8_12_min' }
      );
      assert.strictEqual(pLong8_12.isShorts, false);
      assert.strictEqual(pLong8_12.targetDurationSec, 600);
      assert.strictEqual(pLong8_12.minSentences, 60);
      assert.strictEqual(pLong8_12.maxSentences, 90);
    });

    await test('6.4 Legacy script injection constants and session getters', async () => {
      const mgr = ChatGptWebSessionManager.getInstance();

      // In Node environment without Electron, getSession returns null safely
      const ses = mgr.getSession();
      assert.strictEqual(ses, null, 'getSession() in Node CLI environment returns null without error');

      // Verify that INSTALL_FETCH_HOOK_SCRIPT and POLL_STATE_SCRIPT are valid JS
      const { INSTALL_FETCH_HOOK_SCRIPT, POLL_STATE_SCRIPT } = await import(
        '../main/ai-studio/chatgpt/ChatGptWebSessionManager'
      );
      assert.doesNotThrow(() => {
        new Function(INSTALL_FETCH_HOOK_SCRIPT);
      }, 'INSTALL_FETCH_HOOK_SCRIPT must be syntactically valid');

      assert.doesNotThrow(() => {
        new Function(POLL_STATE_SCRIPT);
      }, 'POLL_STATE_SCRIPT must be syntactically valid');
    });

  } finally {
    stub.restore();
  }

  // ============================================================================
  // SUMMARY REPORT
  // ============================================================================
  console.log(`\n${'='.repeat(80)}`);
  console.log('  ADVERSARIAL STRESS TEST SUMMARY REPORT');
  console.log(`${'='.repeat(80)}`);

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  console.log(`Total Scenarios Tested : ${results.length}`);
  console.log(`Passed                 : ${passed.length} (${Math.round((passed.length / results.length) * 100)}%)`);
  console.log(`Failed                 : ${failed.length}`);

  if (failed.length > 0) {
    console.error(`\n❌ FAILED TESTS (${failed.length}):`);
    for (const f of failed) {
      console.error(`  - [${f.suite}] ${f.name}: ${f.error?.message || f.error}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS RATE! ✅');
    process.exit(0);
  }
}

runAdversarialTests().catch((fatal) => {
  console.error('Fatal crash in adversarial runner:', fatal);
  process.exit(1);
});
