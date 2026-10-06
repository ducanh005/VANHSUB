/**
 * tests/test_m2_remediation_master_prompt_echo.ts
 *
 * Verification suite for Milestone 2 remediation:
 * 1. Full production Master Prompt containing Part B blocks (B1, B2, B3, B4) is NOT falsely flagged as prompt echo.
 * 2. Continuation prompts with punctuation and English commands are reliably flagged as echo.
 * 3. Web UI truncation markers with newlines ('Xem thêm\n', 'Show more\n') are correctly detected.
 * 4. Multi-node selector resolution finds visible nodes when index 0 is hidden.
 * 5. Standalone assistant elements (.markdown, .prose) are recognized as assistant turns.
 * 6. SelectorNotFoundError captures pageUrl when page context is a Locator.
 */

import assert from 'assert';
import {
  isUserPromptEcho,
  resolveSelector,
  isElementAssistantTurn,
  getAssistantTurns,
  SelectorNotFoundError,
  PROMPT_ECHO_MARKERS,
} from '../main/ai-studio/chatgpt/chatgptSelectors.config';

console.log('================================================================================');
console.log('  M2 REMEDIATION VERIFICATION SUITE: MASTER PROMPT & ECHO GUARD');
console.log('================================================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    return result
      .then(() => {
        passCount++;
        console.log(`  ✓ [PASS] ${name}`);
      })
      .catch((err) => {
        failCount++;
        console.error(`  ✗ [FAIL] ${name}: ${err?.message || err}`);
      });
  } else {
    passCount++;
    console.log(`  ✓ [PASS] ${name}`);
  }
}

async function main() {
  // Test 1: Full production Master Prompt containing Part B blocks
  runTest('1. Full production Master Prompt with Part B blocks is NOT flagged as echo', () => {
    const fullMasterPrompt = `
1. SYSTEM ROLE
Bạn là Giám đốc Sáng tạo và Người kể chuyện chuyên nghiệp cho kênh YouTube "Vanhsub Khám Phá".

2. INPUT
--- B1. VÙNG NHẬN NGUỒN (đặt ở mục 2 INPUT) ---
{{SOURCE_MATERIAL}}
--- B1. KẾT THÚC VÙNG NHẬN NGUỒN ---

3. PRIMARY OBJECTIVE
Viết kịch bản video tài liệu kịch tính, lôi cuốn, độ dài 8-12 phút (45-60 câu).

4. CHANNEL DNA
- Tông giọng: Trầm ấm, kịch tính, cuốn hút.
- Phong cách: Phim tài liệu điện ảnh Discovery.

4B. BRAND IDENTITY
--- B4. NHẬN DIỆN THƯƠNG HIỆU (mục 4B) ---
Kênh: Vanhsub Khám Phá | Slogan: Giải mã những bí ẩn lớn nhất hành tinh.

5. SIGNATURE BEAT
Mỗi tập phim bắt đầu bằng một câu hỏi búa bổ khiến người xem không thể rời mắt.

6. NGUỒN & SỰ THẬT
Chỉ sử dụng dữ kiện lịch sử và khoa học đã được kiểm chứng.

7. CẤU TRÚC TẬP
- Hồi 1 (0:00 - 3:00): Khởi đầu bí ẩn.
- Hồi 2 (3:00 - 8:00): Cuộc điều tra nghẹt thở.
- Hồi 3 (8:00 - 10:00): Sự thật hé lộ.

8. NARRATION & DELIVERY
--- B2. LUẬT ĐỌC THÀNH TIẾNG (đặt trong mục 8 NARRATION) ---
Viết câu ngắn từ 15-25 từ. Ngắt nhịp rõ ràng, không dùng câu phức ghép dài.

9. STRICT OUTPUT FORMAT
--- B3. HỢP ĐỒNG OUTPUT (mục 9, luôn là mục CUỐI CÙNG) ---
Mỗi câu thoại trên một dòng riêng biệt bắt đầu bằng CÂU X:
--- B3. KẾT THÚC HỢP ĐỒNG OUTPUT ---
    `.trim();

    const isEcho = isUserPromptEcho(fullMasterPrompt);
    assert.strictEqual(
      isEcho,
      false,
      'Full production master prompt containing Part B blocks must evaluate to false (NOT an echo)'
    );
  });

  // Test 2: Part B block headers are removed from PROMPT_ECHO_MARKERS catalog
  runTest('2. Part B headers are completely removed from PROMPT_ECHO_MARKERS', () => {
    const forbiddenMarkers = [
      '--- B1. VÙNG NHẬN NGUỒN',
      '--- B2. LUẬT ĐỌC THÀNH TIẾNG',
      '--- B3. HỢP ĐỒNG OUTPUT',
      '--- B4. NHẬN DIỆN THƯƠNG HIỆU',
    ];

    for (const marker of forbiddenMarkers) {
      assert(
        !PROMPT_ECHO_MARKERS.includes(marker),
        `Marker "${marker}" must NOT be present in PROMPT_ECHO_MARKERS catalog`
      );
    }
  });

  // Test 3: Continuation prompts with punctuation variations are flagged as echo
  runTest('3. Continuation prompts with punctuation variations are flagged as echo', () => {
    const variations = [
      'tiếp tục viết phần còn lại.',
      'tiếp tục viết phần còn lại...',
      'tiếp tục viết phần còn lại…',
      'tiếp tục viết tiếp kịch bản!',
      'TIẾP TỤC VIẾT TIẾP?',
      '  tiếp tục phần kịch bản còn lại.  ',
      'tiếp tục',
      'tiếp tục.',
      'continue',
      'continue.',
      'continue writing',
      'continue writing...',
      'continue generating',
      'continue generating!',
      'please continue',
      'please continue.',
    ];

    for (const v of variations) {
      assert.strictEqual(
        isUserPromptEcho(v),
        true,
        `Continuation variation "${v}" must evaluate to true (isEcho)`
      );
    }
  });

  // Test 4: Web UI truncation and state artifacts are flagged as echo
  runTest('4. Web UI truncation and reactive state artifacts are flagged as echo', () => {
    const artifacts = [
      '… Xem thêm',
      'Xem thêm\nChatGPT đang phản hồi',
      'ChatGPT đang phản hồi',
      'Xem thêm\n',
      'Show more\n',
      'Bối cảnh trước đó: Xem thêm\n và đoạn tiếp',
      'Một số dữ liệu ngẫu nhiên. Xem thêm\n',
    ];

    for (const a of artifacts) {
      assert.strictEqual(
        isUserPromptEcho(a),
        true,
        `UI artifact "${a}" must evaluate to true (isEcho)`
      );
    }
  });

  // Test 5: Multi-node visibility check when index 0 is hidden but index 1 is visible
  await runTest('5. resolveSelector finds visible node when index 0 is hidden and index 1 is visible', async () => {
    const mockElements = [
      { id: 'el-0', isVisible: false },
      { id: 'el-1', isVisible: true },
    ];

    const mockPage = {
      locator: (sel: string) => ({
        count: async () => mockElements.length,
        first: () => ({
          isVisible: async () => mockElements[0].isVisible,
          waitFor: async () => {},
        }),
        nth: (idx: number) => ({
          id: mockElements[idx].id,
          isVisible: async () => mockElements[idx].isVisible,
          waitFor: async () => {},
        }),
      }),
    };

    const group = {
      primary: 'div.multi-element',
      fallbacks: [],
      description: 'Test multi element selector',
    };

    const res = await resolveSelector(mockPage, group, 'testMulti', { waitForVisible: true });
    assert.strictEqual(res.isFallback, false);
    assert.strictEqual(res.locator.id, 'el-1', 'Should resolve the visible node at index 1');
  });

  // Test 6: Standalone markdown element recognized as assistant turn
  await runTest('6. isElementAssistantTurn recognizes standalone element with class markdown/prose', async () => {
    const standaloneNode = {
      getAttribute: async (attr: string) => (attr === 'class' ? 'markdown prose' : null),
      locator: () => ({ count: async () => 0 }),
    };

    const isAssistant = await isElementAssistantTurn(standaloneNode);
    assert.strictEqual(isAssistant, true, 'Standalone element with class "markdown prose" must be recognized as assistant turn');
  });

  // Test 7: SelectorNotFoundError captures pageUrl when page context is a Locator with .page()
  await runTest('7. SelectorNotFoundError captures pageUrl when page context is a Locator with .page()', async () => {
    const mockLocatorAsPage = {
      locator: () => ({
        count: async () => 0,
        first: () => ({ isVisible: async () => false }),
      }),
      page: () => ({
        url: () => 'https://chatgpt.com/c/test-conversation-id',
      }),
    };

    const group = {
      primary: '#non-existent-primary',
      fallbacks: ['#non-existent-fallback'],
      description: 'Failure test',
    };

    try {
      await resolveSelector(mockLocatorAsPage, group, 'testPageUrlContext');
      assert.fail('Expected resolveSelector to throw SelectorNotFoundError');
    } catch (err: any) {
      assert(err instanceof SelectorNotFoundError, 'Error must be instance of SelectorNotFoundError');
      assert.strictEqual(
        err.pageUrl,
        'https://chatgpt.com/c/test-conversation-id',
        `Expected pageUrl to be captured from page.page().url(), got ${err.pageUrl}`
      );
    }
  });

  console.log(`\n================================================================================`);
  console.log(`  SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`================================================================================`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
