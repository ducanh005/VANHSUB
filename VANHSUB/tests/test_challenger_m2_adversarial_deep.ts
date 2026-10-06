import assert from 'assert';
import {
  isUserPromptEcho,
  PROMPT_ECHO_MARKERS,
  resolveSelector,
  isElementAssistantTurn,
  isElementUserTurn,
  getAssistantTurns,
  extractCleanAssistantText,
  SelectorNotFoundError,
} from '../main/ai-studio/chatgpt/chatgptSelectors.config';

console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('  CHALLENGER DEEP ADVERSARIAL STRESS SUITE (M2 REMEDIATION AUDIT)');
console.log('════════════════════════════════════════════════════════════════════════════════\n');

let pass = 0;
let fail = 0;

async function check(desc: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ [PASS] ${desc}`);
  } catch (err: any) {
    fail++;
    console.error(`  ✗ [FAIL] ${desc}: ${err?.message || err}`);
  }
}

async function runAll() {
  // 1. CRLF Windows newline and trailing whitespace resilience for UI markers
  await check('1.1 Windows CRLF ("\\r\\n") for Xem thêm & Show more triggers echo guard', () => {
    assert.strictEqual(isUserPromptEcho('Xem thêm\r\n'), true);
    assert.strictEqual(isUserPromptEcho('Show more\r\n'), true);
    assert.strictEqual(isUserPromptEcho('Đoạn văn trước đó\r\nXem thêm\r\n'), true);
    assert.strictEqual(isUserPromptEcho('Đoạn văn trước đó\r\nShow more\r\n'), true);
  });

  await check('1.2 Standalone "Xem thêm" without newline triggers echo guard', () => {
    assert.strictEqual(isUserPromptEcho('Xem thêm'), true);
    assert.strictEqual(isUserPromptEcho('Show more'), true);
    assert.strictEqual(isUserPromptEcho('  Xem thêm  '), true);
    assert.strictEqual(isUserPromptEcho('  Show more  '), true);
  });

  await check('1.3 Zero false positive on dialogue using "tiếp tục" in real script lines', () => {
    const realScriptLines = [
      'CÂU 1: Chúng ta phải tiếp tục hành trình vượt qua cơn bão.',
      'CÂU 2: Đừng dừng lại, hãy tiếp tục tìm kiếm manh mối!',
      'CÂU 3: Hành trình tiếp tục mở ra những bí ẩn không ngờ.',
      'CÂU 4: "Tôi muốn tiếp tục," anh ấy kiên quyết trả lời.',
    ];
    for (const line of realScriptLines) {
      assert.strictEqual(isUserPromptEcho(line), false, `Script line was falsely flagged as echo: "${line}"`);
    }
  });

  await check('1.4 Punctuation edge cases on continuation commands', () => {
    const continuationPunctuation = [
      'tiếp tục viết phần còn lại?!',
      'tiếp tục viết phần còn lại...',
      'tiếp tục viết tiếp!!!',
      'TIẾP TỤC???',
      'continue writing?!?!',
      'please continue....',
      'continue generating!!!',
    ];
    for (const cmd of continuationPunctuation) {
      assert.strictEqual(isUserPromptEcho(cmd), true, `Continuation with punct was missed: "${cmd}"`);
    }
  });

  await check('1.5 Multi-node selector resolution when indices 0 and 1 are hidden, index 2 is visible', async () => {
    const mockElements = [
      { id: 'node-0', isVisible: false },
      { id: 'node-1', isVisible: false },
      { id: 'node-2', isVisible: true },
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
      primary: 'div.multi-check',
      fallbacks: [],
      description: 'deep multi-node test',
    };
    const res = await resolveSelector(mockPage, group, 'testDeepMulti', { waitForVisible: true });
    assert.strictEqual(res.isFallback, false);
    assert.strictEqual(res.locator.id, 'node-2', 'Should resolve index 2 which is the first visible node');
  });

  await check('1.6 Standalone element with realistic complex class string recognized as assistant turn', async () => {
    const complexClassNodes = [
      'font-sans text-base leading-relaxed markdown prose dark:prose-invert break-words',
      'prose max-w-none text-gray-900',
      'w-full markdown py-2',
    ];
    for (const cls of complexClassNodes) {
      const node = {
        getAttribute: async (attr: string) => (attr === 'class' ? cls : null),
        locator: () => ({ count: async () => 0 }),
      };
      assert.strictEqual(
        await isElementAssistantTurn(node),
        true,
        `Failed to recognize assistant turn with class: "${cls}"`
      );
    }
  });

  await check('1.7 Full production Master Prompt preserves 100% false echo rate with varied section styles', () => {
    const prompt1 = `
1. SYSTEM ROLE: Chuyên gia biên kịch tài liệu Vanhsub
2. INPUT:
--- B1. VÙNG NHẬN NGUỒN
Dữ liệu nguồn ở đây
3. PRIMARY OBJECTIVE: 10 phút
4. CHANNEL DNA: Kịch tính
4B. BRAND IDENTITY:
--- B4. NHẬN DIỆN THƯƠNG HIỆU
Vanhsub
5. SIGNATURE BEAT: Hook mở đầu
6. NGUỒN & SỰ THẬT: Kiểm chứng
7. CẤU TRÚC TẬP: 3 hồi
8. NARRATION & DELIVERY:
--- B2. LUẬT ĐỌC THÀNH TIẾNG
Viết cho tai
9. STRICT OUTPUT FORMAT:
--- B3. HỢP ĐỒNG OUTPUT
CÂU X: ...
    `.trim();

    assert.strictEqual(isUserPromptEcho(prompt1), false, 'Production master prompt must evaluate to false');
  });

  console.log(`\n════════════════════════════════════════════════════════════════════════════════`);
  console.log(`  CHALLENGER DEEP SUITE RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log(`════════════════════════════════════════════════════════════════════════════════\n`);

  if (fail > 0) process.exit(1);
}

runAll().catch((e) => {
  console.error(e);
  process.exit(1);
});
