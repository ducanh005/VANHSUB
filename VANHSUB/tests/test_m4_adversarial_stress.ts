/**
 * tests/test_m4_adversarial_stress.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS for Milestone 4:
 * 1. Audiovisual two-column splitting & spoken text dialogue sanitization
 * 2. Google Flow Veo video duration clamping [2.0s, 8.0s]
 * 3. Malformed JSON blueprint repairs via jsonrepair & regex fallback
 * 4. Schema validation boundary checking (validateScriptBeatLines & validateIdeaBlueprint)
 *
 * Execution:
 *   npx tsx tests/test_m4_adversarial_stress.ts
 */

import assert from 'assert';
import {
  parseChatGptScriptResponse,
  parseChatGptBlueprintResponse,
  validateScriptBeatLines,
  validateIdeaBlueprint,
  calculateScriptPacingMetrics,
  sanitizePromptEchoFromOutput,
  isUserPromptEcho,
} from '../main/ai-studio/chatgpt/ChatGptWebSessionManager';
import type { ScriptBeatLine, IdeaBlueprint } from '../main/ai-studio/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails: string[] = [];

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (err: any) {
    failedTests++;
    const msg = `  ✗ [FAIL] ${name}: ${err?.message || err}`;
    console.error(msg);
    failureDetails.push(msg);
  }
}

console.log('================================================================================');
console.log('  STARTING M4 EMPIRICAL ADVERSARIAL STRESS TEST SUITE');
console.log('================================================================================\n');

// ==============================================================================
// SUITE 1: AUDIOVISUAL TWO-COLUMN SPLITTING & SPOKEN DIALOGUE SANITIZATION
// ==============================================================================
console.log('▶ [SUITE 1] AUDIOVISUAL TWO-COLUMN SPLITTING & DIALOGUE SANITIZATION');

runTest('1.1 Standard pipe format with complete attributes splits clean dialogue', () => {
  const raw = `
=== BEGIN SCRIPT ===
CÂU 1: Bí mật kinh hoàng dưới rãnh Mariana chưa từng được tiết lộ cho công chúng | VISUAL: Tàu ngầm lặn sâu vào vực tối | CAMERA: Wide shot toàn cảnh vực thẳm | MEDIA: video | VOICE: Giọng trầm ấm bí ẩn
CÂU 2: Áp suất ở đây có thể nghiền nát một chiếc xe tăng trong tích tắc | VISUAL: Thước đo áp suất tăng vọt | CAMERA: Close-up cận cảnh đồng hồ | MEDIA: video | VOICE: Kịch tính dồn dập
CÂU 3: Nhưng những sinh vật này vẫn tồn tại một cách kỳ diệu | VISUAL: Đàn sứa phát quang bơi lội | CAMERA: Medium shot trung cảnh | MEDIA: image | VOICE: Lắng đọng ngạc nhiên
CÂU 4: Hãy đăng ký kênh để khám phá thêm những bí ẩn đại dương kỳ thú | VISUAL: Logo kênh và nút đăng ký | CAMERA: Toàn cảnh | MEDIA: video | VOICE: Kêu gọi hào hứng
=== END SCRIPT ===
  `;
  const beats = parseChatGptScriptResponse(raw, 'Bí ẩn Mariana');
  assert.strictEqual(beats.length, 4, 'Should parse exactly 4 beats');

  // Verify Beat 1
  assert.strictEqual(beats[0].text, 'Bí mật kinh hoàng dưới rãnh Mariana chưa từng được tiết lộ cho công chúng');
  assert.strictEqual(beats[0].visualAction, 'Tàu ngầm lặn sâu vào vực tối');
  assert.strictEqual(beats[0].cameraAngle, 'wide_establishing');
  assert.strictEqual(beats[0].suggestedMediaType, 'video');
  assert.strictEqual(beats[0].voiceDirection, 'Giọng trầm ấm bí ẩn');
  assert.strictEqual(beats[0].beatType, 'hook');

  // Verify Beat 2
  assert.strictEqual(beats[1].text, 'Áp suất ở đây có thể nghiền nát một chiếc xe tăng trong tích tắc');
  assert.strictEqual(beats[1].cameraAngle, 'close_up');
  assert.strictEqual(beats[1].suggestedMediaType, 'video');
  assert.strictEqual(beats[1].beatType, 'intro');

  // Dialogue must have NO pipe or metadata remnants
  for (const b of beats) {
    assert(!b.text.includes('|'), `Beat ${b.index} dialogue text must not contain pipe '|'`);
    assert(!b.text.includes('VISUAL:'), `Beat ${b.index} text must not contain VISUAL:`);
    assert(!b.text.includes('CAMERA:'), `Beat ${b.index} text must not contain CAMERA:`);
    assert(!b.text.includes('MEDIA:'), `Beat ${b.index} text must not contain MEDIA:`);
    assert(!b.text.includes('VOICE:'), `Beat ${b.index} text must not contain VOICE:`);
  }
});

runTest('1.2 Bracketed tags inline within sentence stripped completely from dialogue', () => {
  const raw = `
=== BEGIN SCRIPT ===
CÂU 1: [Hook] Bạn có bao giờ tự hỏi điều gì ẩn sâu dưới lòng đất [Hình ảnh: Hang động kỳ vĩ] [Camera: Cận cảnh nhũ đá] [Media: Video] [Voice: Thì thầm bí hiểm]
CÂU 2: Nơi những dòng sông ngầm chảy róc rách hàng triệu năm qua [Cảnh: Dòng nước xanh ngọc] [Chuyển động: Toàn cảnh flycam] [Loại: Video]
CÂU 3: Hãy bấm like và theo dõi hành trình thám hiểm hang Sơn Đoòng [Visual: Đoàn thám hiểm bước ra ánh sáng] [Loại: Image]
=== END SCRIPT ===
  `;
  const beats = parseChatGptScriptResponse(raw, 'Thám hiểm hang động');
  assert.strictEqual(beats.length, 3, 'Should parse 3 beats');

  // Beat 1: dialogue must be clean from [Hook] and all bracket tags
  assert.strictEqual(beats[0].text, 'Bạn có bao giờ tự hỏi điều gì ẩn sâu dưới lòng đất');
  assert.strictEqual(beats[0].visualAction, 'Hang động kỳ vĩ');
  // Note: camTag sets cameraMovement; cameraAngle is optional
  assert.strictEqual(beats[0].cameraMovement, 'Cận cảnh nhũ đá');
  assert.strictEqual(beats[0].suggestedMediaType, 'video');
  assert.strictEqual(beats[0].voiceDirection, 'Thì thầm bí hiểm');

  // Beat 2:
  assert.strictEqual(beats[1].text, 'Nơi những dòng sông ngầm chảy róc rách hàng triệu năm qua');
  assert.strictEqual(beats[1].visualAction, 'Dòng nước xanh ngọc');
  assert.strictEqual(beats[1].cameraMovement, 'Toàn cảnh flycam');
  assert.strictEqual(beats[1].suggestedMediaType, 'video');

  for (const b of beats) {
    assert(!b.text.includes('['), `Beat ${b.index} text must not contain '['`);
    assert(!b.text.includes(']'), `Beat ${b.index} text must not contain ']'`);
  }
});

runTest('1.3 Chaotic mixed delimiters: bolding, quotes, messy spacing and casing', () => {
  const raw = `
=== BEGIN SCRIPT ===
**CÂU 1:** "***Không thể tin được đây là sự thật đang xảy ra!***"  |   HÌNH ẢNH :   Ngọn núi lửa phun trào   |   GÓC MÁY :   Toàn cảnh bão tro   |   LOẠI :   Video   |   GIỌNG ĐỌC :   Kinh hãi
**2.** [Bối cảnh] Hàng ngàn người dân đã phải sơ tán khẩn cấp ngay trong đêm tối | CẢNH: Dòng người hối hả di tản | CHUYỂN ĐỘNG: Cận cảnh gương mặt lo âu | MEDIA: VIDEO
3) Đừng quên chia sẻ video này để cảnh báo cho người thân của bạn! | VISUAL: Bản đồ cảnh báo nguy hiểm | CAMERA: Trung cảnh | MEDIA: image
=== END SCRIPT ===
  `;
  const beats = parseChatGptScriptResponse(raw, 'Núi lửa');
  assert.strictEqual(beats.length, 3, 'Should parse 3 beats with varied line prefixes');

  // Beat 1: stripped quotes, bolding, extra spaces
  assert.strictEqual(beats[0].text, 'Không thể tin được đây là sự thật đang xảy ra!');
  assert.strictEqual(beats[0].visualAction, 'Ngọn núi lửa phun trào');
  assert.strictEqual(beats[0].cameraAngle, 'wide_establishing');
  assert.strictEqual(beats[0].suggestedMediaType, 'video');
  assert.strictEqual(beats[0].voiceDirection, 'Kinh hãi');

  // Beat 2:
  assert.strictEqual(beats[1].text, 'Hàng ngàn người dân đã phải sơ tán khẩn cấp ngay trong đêm tối');
  assert.strictEqual(beats[1].visualAction, 'Dòng người hối hả di tản');
  assert.strictEqual(beats[1].cameraAngle, 'close_up');
  assert.strictEqual(beats[1].suggestedMediaType, 'video');

  // Beat 3:
  assert.strictEqual(beats[2].text, 'Đừng quên chia sẻ video này để cảnh báo cho người thân của bạn!');
  assert.strictEqual(beats[2].suggestedMediaType, 'image');
});

runTest('1.4 Outer quotes stripping on full dialogue line', () => {
  const raw = `
=== BEGIN SCRIPT ===
CÂU 1: "Vị giáo sư thốt lên kinh ngạc trước phát minh thay đổi nhân loại!" | VISUAL: Phòng thí nghiệm | CAMERA: Cận cảnh | MEDIA: video
CÂU 2: "Các cộng sự của ông cảnh báo rằng mối nguy hiểm đang quá lớn." | VISUAL: Tài liệu mật bị lộ | CAMERA: Toàn cảnh | MEDIA: video
CÂU 3: "Liệu nhân loại đã sẵn sàng cho bước nhảy vọt công nghệ này chưa?" | VISUAL: Thành phố tương lai | CAMERA: Toàn cảnh | MEDIA: video
=== END SCRIPT ===
  `;
  const beats = parseChatGptScriptResponse(raw, 'Phát minh');
  assert.strictEqual(beats.length, 3);
  // Full line quotes stripped cleanly
  assert.strictEqual(beats[0].text, 'Vị giáo sư thốt lên kinh ngạc trước phát minh thay đổi nhân loại!');
  assert.strictEqual(beats[1].text, 'Các cộng sự của ông cảnh báo rằng mối nguy hiểm đang quá lớn.');
  assert.strictEqual(beats[2].text, 'Liệu nhân loại đã sẵn sàng cho bước nhảy vọt công nghệ này chưa?');
});

runTest('1.5 Natural paragraph fallback excludes conversational framing phrases', () => {
  const raw = `
Dưới đây là kịch bản tôi viết cho bạn:
Trái Đất của chúng ta đang đối mặt với những biến đổi khí hậu chưa từng có trong lịch sử nhân loại.
Các tảng băng tại Nam Cực đang tan chảy với tốc độ nhanh gấp ba lần so với thập kỷ trước.
Nếu không hành động ngay hôm nay, thế hệ tương lai sẽ phải gánh chịu hậu quả vô cùng nặng nề.
Hãy chung tay bảo vệ hành tinh xanh của chúng ta trước khi mọi thứ trở nên quá muộn.
Hy vọng kịch bản này hữu ích cho bạn!
  `;
  const beats = parseChatGptScriptResponse(raw, 'Khí hậu');
  assert(beats.length >= 3, `Expected at least 3 beats from fallback splitting, got ${beats.length}`);
  assert.strictEqual(beats[0].beatType, 'hook');
  assert.strictEqual(beats[beats.length - 1].beatType, 'outro');
  // Check that conversational intro and outro were filtered out
  for (const b of beats) {
    assert(!b.text.toLowerCase().includes('dưới đây là'), 'Intro greeting must be excluded');
    assert(!b.text.toLowerCase().includes('hy vọng kịch bản'), 'Outro conversational signoff must be excluded');
  }
});

// ==============================================================================
// SUITE 2: GOOGLE FLOW VEO VIDEO DURATION CLAMPING [2.0s, 8.0s]
// ==============================================================================
console.log('\n▶ [SUITE 2] GOOGLE FLOW VEO VIDEO DURATION CLAMPING [2.0s, 8.0s]');

runTest('2.1 JSON script parser clamps short video duration (<2s) to exactly 2.0s', () => {
  const raw = JSON.stringify([
    { text: 'Hook ngắn câu 1 rất cuốn hút', suggestedMediaType: 'video', estimatedDurationSec: 0.5 },
    { text: 'Câu 2 giới thiệu bối cảnh thực tế', suggestedMediaType: 'video', estimatedDurationSec: 1.2 },
    { text: 'Câu 3 diễn biến tiếp theo kịch tính', suggestedMediaType: 'video', estimatedDurationSec: 1.9 },
    { text: 'Câu 4 kết luận video đầy ấn tượng', suggestedMediaType: 'video', estimatedDurationSec: 2.0 },
  ]);
  const beats = parseChatGptScriptResponse(raw, 'Test Clamping Short');
  assert.strictEqual(beats.length, 4);
  assert.strictEqual(beats[0].estimatedDurationSec, 2.0, '0.5s must be clamped to 2.0s');
  assert.strictEqual(beats[1].estimatedDurationSec, 2.0, '1.2s must be clamped to 2.0s');
  assert.strictEqual(beats[2].estimatedDurationSec, 2.0, '1.9s must be clamped to 2.0s');
  assert.strictEqual(beats[3].estimatedDurationSec, 2.0, '2.0s remains exactly 2.0s');
});

runTest('2.2 JSON script parser clamps long video duration (>8s) to exactly 8.0s', () => {
  const raw = JSON.stringify([
    { text: 'Hook dài câu 1 rất chi tiết và sống động', suggestedMediaType: 'video', estimatedDurationSec: 8.1 },
    { text: 'Câu 2 phân tích sâu sắc các khía cạnh lịch sử', suggestedMediaType: 'video', estimatedDurationSec: 12.5 },
    { text: 'Câu 3 cao trào căng thẳng với nhiều diễn biến', suggestedMediaType: 'video', estimatedDurationSec: 30.0 },
    { text: 'Câu 4 lời kết kêu gọi chia sẻ và thảo luận', suggestedMediaType: 'video', estimatedDurationSec: 8.0 },
  ]);
  const beats = parseChatGptScriptResponse(raw, 'Test Clamping Long');
  assert.strictEqual(beats.length, 4);
  assert.strictEqual(beats[0].estimatedDurationSec, 8.0, '8.1s must be clamped to 8.0s');
  assert.strictEqual(beats[1].estimatedDurationSec, 8.0, '12.5s must be clamped to 8.0s');
  assert.strictEqual(beats[2].estimatedDurationSec, 8.0, '30.0s must be clamped to 8.0s');
  assert.strictEqual(beats[3].estimatedDurationSec, 8.0, '8.0s remains exactly 8.0s');
});

runTest('2.3 Image media type is NOT clamped to 8.0s max (Ken Burns allows longer)', () => {
  const raw = JSON.stringify([
    { text: 'Ảnh tĩnh 1 hiển thị tài liệu lịch sử quý giá', suggestedMediaType: 'image', estimatedDurationSec: 15.0 },
    { text: 'Ảnh tĩnh 2 hiển thị chân dung nhân vật chính', suggestedMediaType: 'image', estimatedDurationSec: 10.0 },
    { text: 'Ảnh tĩnh 3 hiển thị bản đồ địa lý chi tiết', suggestedMediaType: 'image', estimatedDurationSec: 1.0 },
    { text: 'Video phân cảnh hành động kịch tính', suggestedMediaType: 'video', estimatedDurationSec: 15.0 },
  ]);
  const beats = parseChatGptScriptResponse(raw, 'Test Image vs Video Duration');
  assert.strictEqual(beats.length, 4);
  assert.strictEqual(beats[0].estimatedDurationSec, 15.0, 'Image can exceed 8s (e.g. 15.0s for Ken Burns)');
  assert.strictEqual(beats[1].estimatedDurationSec, 10.0, 'Image can exceed 8s (e.g. 10.0s for Ken Burns)');
  assert.strictEqual(beats[2].estimatedDurationSec, 2.0, 'Image below 2s is clamped to min 2.0s');
  assert.strictEqual(beats[3].estimatedDurationSec, 8.0, 'Video must be clamped to max 8.0s');
});

runTest('2.4 Invalid / NaN / negative / zero duration fallbacks gracefully', () => {
  const raw = JSON.stringify([
    { text: 'Câu thoại có thời lượng âm bị lỗi từ API', suggestedMediaType: 'video', estimatedDurationSec: -5.0 },
    { text: 'Câu thoại có thời lượng bằng 0', suggestedMediaType: 'video', estimatedDurationSec: 0 },
    { text: 'Câu thoại có thời lượng null hoặc undefined', suggestedMediaType: 'video', estimatedDurationSec: null },
    { text: 'Câu thoại có thời lượng string chữ không hợp lệ', suggestedMediaType: 'video', estimatedDurationSec: 'invalid_num' },
  ]);
  const beats = parseChatGptScriptResponse(raw, 'Test Invalid Durations');
  assert.strictEqual(beats.length, 4);
  for (const b of beats) {
    assert(!isNaN(b.estimatedDurationSec), `Beat ${b.index} estimatedDurationSec must not be NaN`);
    assert(b.estimatedDurationSec >= 2.0, `Beat ${b.index} estimatedDurationSec (${b.estimatedDurationSec}) must be >= 2.0s`);
    assert(b.estimatedDurationSec <= 8.0, `Beat ${b.index} estimatedDurationSec (${b.estimatedDurationSec}) must be <= 8.0s`);
  }
});

runTest('2.5 Line-by-line script parser clamps video durations properly', () => {
  // Line with very long dialogue that would naturally be > 8s
  const longText = 'Đây là một câu thoại cực kỳ dài dằng dặc với hơn bốn mươi lăm từ được viết liên tục không ngừng nghỉ nhằm mục đích kiểm tra xem thuật toán tính toán thời lượng dựa trên số lượng từ vựng có bị vượt ngưỡng tối đa tám giây của Google Flow Veo hay không';
  const raw = `
=== BEGIN SCRIPT ===
CÂU 1: Câu ngắn hai từ | MEDIA: video
CÂU 2: ${longText} | MEDIA: video
CÂU 3: Câu kết thúc video vừa phải | MEDIA: video
=== END SCRIPT ===
  `;
  const beats = parseChatGptScriptResponse(raw, 'Line-by-line Veo Clamping');
  assert.strictEqual(beats.length, 3);
  assert(beats[0].estimatedDurationSec >= 2.0 && beats[0].estimatedDurationSec <= 8.0, `Short sentence duration ${beats[0].estimatedDurationSec}s clamped to [2, 8]`);
  assert.strictEqual(beats[1].estimatedDurationSec, 8.0, `Long sentence duration must be clamped to 8.0s max`);
  assert(beats[2].estimatedDurationSec >= 2.0 && beats[2].estimatedDurationSec <= 8.0);
});

// ==============================================================================
// SUITE 3: MALFORMED JSON BLUEPRINT REPAIRS VIA JSONREPAIR & REGEX RECOVERY
// ==============================================================================
console.log('\n▶ [SUITE 3] MALFORMED JSON BLUEPRINT REPAIRS');

runTest('3.1 Truncated JSON missing closing brackets/braces repaired via jsonrepair', () => {
  const truncatedJson = `
=== BEGIN JSON ===
{
  "title": "Bí Ẩn Tam Giác Bermuda",
  "hookConcept": "Tại sao hàng trăm máy bay và tàu thuyền mất tích bí ẩn không dấu vết?",
  "narrativeAngle": "Giải mã khoa học và tài liệu giải mật của hải quân",
  "aspectRatio": "16:9",
  "estimatedDurationSec": 390,
  "outline": [
    "1. Những vụ mất tích chấn động nhất",
    "2. Giả thuyết về khí metan và từ trường",
    "3. Sự thật được sáng tỏ
  `; // truncated: missing quote, closing bracket ], and closing brace }

  const blueprint = parseChatGptBlueprintResponse(truncatedJson, 'Tam Giác Bermuda', '16:9');
  assert(blueprint, 'Blueprint must be returned');
  assert.strictEqual(blueprint.title, 'Bí Ẩn Tam Giác Bermuda');
  assert.strictEqual(blueprint.aspectRatio, '16:9');
  assert(blueprint.hookConcept.includes('máy bay và tàu thuyền'));
  assert(Array.isArray(blueprint.outline) && blueprint.outline.length >= 3, 'Outline must be repaired into valid array');
  const val = validateIdeaBlueprint(blueprint);
  assert(val.isValid, `Repaired blueprint should pass validation: ${val.reason}`);
});

runTest('3.2 Trailing commas, single quotes, and unquoted keys repaired cleanly', () => {
  const dirtyJson = `
\`\`\`json
{
  title: 'Hành Trình Khám Phá Sao Hỏa',
  'hookConcept': 'Con người có thực sự đặt chân lên Hành Tinh Đỏ vào năm 2030?',
  narrativeAngle: 'Góc nhìn công nghệ vũ trụ và sinh tồn ngoài không gian',
  estimatedDurationSec: 420,
  outline: [
    '1. Thách thức bức xạ vũ trụ',
    '2. Công nghệ tên lửa Starship',
    '3. Xây dựng thuộc địa đầu tiên',
  ],
}
\`\`\`
  `;
  const blueprint = parseChatGptBlueprintResponse(dirtyJson, 'Sao Hỏa', '16:9');
  assert.strictEqual(blueprint.title, 'Hành Trình Khám Phá Sao Hỏa');
  assert.strictEqual(blueprint.estimatedDurationSec, 420);
  assert.strictEqual(blueprint.outline.length, 3);
  const val = validateIdeaBlueprint(blueprint);
  assert(val.isValid, `Dirty JSON repaired must pass validation: ${val.reason}`);
});

runTest('3.3 Schema rejection of repaired blueprint with insufficient outline items', () => {
  const partialMess = `
=== BEGIN JSON ===
{
  "title": "Bí Mật Kim Tự Tháp Ai Cập",
  "hookConcept": "Các khối đá nặng hàng tấn được nâng lên bằng cách nào?",
  "narrativeAngle": "Khảo cổ học hiện đại kết hợp quét sóng âm",
  "outline": [ Corrupted single line without enough beats ]
}
=== END JSON ===
  `;
  const blueprint = parseChatGptBlueprintResponse(partialMess, 'Kim Tự Tháp', '16:9');
  assert(blueprint, 'Blueprint returned via jsonrepair');
  assert.strictEqual(blueprint.title, 'Bí Mật Kim Tự Tháp Ai Cập');
  // jsonrepair recovers the line into a 1-item array
  assert(Array.isArray(blueprint.outline) && blueprint.outline.length < 3, 'Outline has < 3 items');
  const val = validateIdeaBlueprint(blueprint);
  assert.strictEqual(val.isValid, false, 'Schema validation correctly rejects blueprint with < 3 outline items');
  assert(val.missingFields.some((f) => f.includes('outline')), 'Flags missing outline');
});

runTest('3.4 Regex fallback triggers when jsonrepair throws on unrecoverable syntax', () => {
  // Invalid unicode escape or broken characters that jsonrepair cannot resolve
  const unrepairable = `
=== BEGIN JSON ===
{
  "title": "Kỳ Quan Bí Ẩn",
  "hookConcept": "Câu hỏi lớn chưa lời đáp",
  "narrativeAngle": "Góc nhìn lịch sử",
  "outline": ["1", "2", "3"],
  "corrupted": \\uZZZZ invalid token
}
=== END JSON ===
  `;
  const blueprint = parseChatGptBlueprintResponse(unrepairable, 'Kỳ Quan Bí Ẩn', '16:9');
  assert(blueprint, 'Blueprint returned via fallback');
  assert.strictEqual(blueprint.title, 'Kỳ Quan Bí Ẩn');
  assert(blueprint.outline.length >= 3, 'Fallback outlines provided');
  const val = validateIdeaBlueprint(blueprint);
  assert.strictEqual(val.isValid, true, 'Blueprint passes validation with fallback defaults');
});

runTest('3.4 Empty or non-string input throws explicit Vietnamese error', () => {
  assert.throws(
    () => parseChatGptBlueprintResponse('', 'Test'),
    /dữ liệu ý tưởng trống/i,
    'Empty rawText must throw explicit error'
  );
  assert.throws(
    () => parseChatGptBlueprintResponse(null as any, 'Test'),
    /dữ liệu ý tưởng trống/i,
    'Null rawText must throw explicit error'
  );
});

// ==============================================================================
// SUITE 4: SCHEMA VALIDATION (validateScriptBeatLines & validateIdeaBlueprint)
// ==============================================================================
console.log('\n▶ [SUITE 4] SCHEMA VALIDATION BOUNDARY CONDITIONS');

runTest('4.1 validateScriptBeatLines rejects empty or insufficient beat count', () => {
  const emptyRes = validateScriptBeatLines([]);
  assert.strictEqual(emptyRes.isValid, false);
  assert.strictEqual(emptyRes.beatCount, 0);
  assert.strictEqual(emptyRes.reason, 'Danh sách phân cảnh rỗng');

  const twoBeats: ScriptBeatLine[] = [
    { id: '1', index: 1, text: 'Câu số 1 nội dung hợp lệ', beatType: 'hook', estimatedDurationSec: 3 },
    { id: '2', index: 2, text: 'Câu số 2 nội dung hợp lệ', beatType: 'outro', estimatedDurationSec: 3 },
  ];
  const shortRes = validateScriptBeatLines(twoBeats, 3);
  assert.strictEqual(shortRes.isValid, false);
  assert.strictEqual(shortRes.beatCount, 2);
  assert(shortRes.reason?.includes('ít hơn mục tiêu tối thiểu'), 'Should flag insufficient count');
});

runTest('4.2 validateScriptBeatLines rejects beats with too short text or empty content', () => {
  const beatsWithShort: ScriptBeatLine[] = [
    { id: '1', index: 1, text: 'Hook hợp lệ độ dài đầy đủ', beatType: 'hook', estimatedDurationSec: 3 },
    { id: '2', index: 2, text: 'Quá ngắn', beatType: 'body', estimatedDurationSec: 3 }, // < 6 chars? "Quá ngắn" is 8 chars, let's use "Alo"
    { id: '3', index: 3, text: 'Outro kết luận đầy đủ chi tiết', beatType: 'outro', estimatedDurationSec: 3 },
  ];
  beatsWithShort[1].text = 'Alo'; // 3 chars (< 6 chars)

  const res = validateScriptBeatLines(beatsWithShort, 3);
  assert.strictEqual(res.isValid, false);
  assert(res.reason?.includes('quá ngắn hoặc rỗng'), 'Should reject beat < 6 chars');
});

runTest('4.3 validateScriptBeatLines rejects beats tainted with user prompt echo', () => {
  const taintedBeats: ScriptBeatLine[] = [
    { id: '1', index: 1, text: 'Hook mở đầu hợp lệ', beatType: 'hook', estimatedDurationSec: 3 },
    { id: '2', index: 2, text: 'NHIỆM VỤ CỐT TỬ VỀ ĐỘ DÀI VÀ NỘI DUNG:', beatType: 'body', estimatedDurationSec: 3 },
    { id: '3', index: 3, text: 'Outro kết luận đầy đủ chi tiết', beatType: 'outro', estimatedDurationSec: 3 },
  ];
  const res = validateScriptBeatLines(taintedBeats, 3);
  assert.strictEqual(res.isValid, false);
  assert(res.reason?.includes('bị lẫn prompt của người dùng'), 'Should reject user prompt echo in beat text');
});

runTest('4.4 validateScriptBeatLines accepts valid beats and calculates total duration', () => {
  const validBeats: ScriptBeatLine[] = [
    { id: '1', index: 1, text: 'Hook mở đầu hấp dẫn người xem', beatType: 'hook', estimatedDurationSec: 3.5 },
    { id: '2', index: 2, text: 'Bối cảnh phát triển câu chuyện', beatType: 'intro', estimatedDurationSec: 4.0 },
    { id: '3', index: 3, text: 'Cao trào căng thẳng nghẹt thở', beatType: 'climax', estimatedDurationSec: 5.0 },
    { id: '4', index: 4, text: 'Lời kết đúc kết sâu sắc và kêu gọi like', beatType: 'outro', estimatedDurationSec: 3.5 },
  ];
  const res = validateScriptBeatLines(validBeats, 3);
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.beatCount, 4);
  assert.strictEqual(res.hasHook, true);
  assert.strictEqual(res.hasOutro, true);
  assert.strictEqual(res.totalDurationSec, 16.0);
});

runTest('4.5 validateIdeaBlueprint rejects missing or invalid fields', () => {
  // Missing hookConcept
  const badBp1: any = {
    title: 'Tiêu đề',
    narrativeAngle: 'Góc nhìn',
    outline: ['1', '2', '3'],
    estimatedDurationSec: 60,
  };
  const res1 = validateIdeaBlueprint(badBp1);
  assert.strictEqual(res1.isValid, false);
  assert(res1.missingFields.includes('hookConcept'));

  // Outline with only 2 items (< 3 items)
  const badBp2: any = {
    title: 'Tiêu đề',
    hookConcept: 'Hook concept hợp lệ dài',
    narrativeAngle: 'Góc nhìn hợp lệ dài',
    outline: ['1', '2'],
    estimatedDurationSec: 60,
  };
  const res2 = validateIdeaBlueprint(badBp2);
  assert.strictEqual(res2.isValid, false);
  assert(res2.missingFields.some((f) => f.includes('outline')));

  // Non-positive duration
  const badBp3: any = {
    title: 'Tiêu đề',
    hookConcept: 'Hook concept hợp lệ dài',
    narrativeAngle: 'Góc nhìn hợp lệ dài',
    outline: ['1', '2', '3'],
    estimatedDurationSec: 0,
  };
  const res3 = validateIdeaBlueprint(badBp3);
  assert.strictEqual(res3.isValid, false);
  assert(res3.missingFields.includes('estimatedDurationSec'));
});

runTest('4.6 validateIdeaBlueprint accepts fully compliant IdeaBlueprint', () => {
  const goodBp: IdeaBlueprint = {
    topic: 'Vũ Trụ',
    title: 'Vũ Trụ Vô Tận',
    aspectRatio: '16:9',
    targetAudience: 'Mọi lứa tuổi',
    narrativeAngle: 'Góc nhìn thiên văn học đại cương',
    hookConcept: 'Bên ngoài vũ trụ quan sát được là điều gì?',
    pacing: 'moderate',
    estimatedDurationSec: 390,
    outline: ['1. Mở đầu', '2. Bức xạ nền vũ trụ', '3. Thuyết đa vũ trụ'],
    thumbnailConcept: 'Hình ảnh hố đen hút ánh sáng',
    thumbnailPrompt: 'Cinematic black hole event horizon 8k',
  };
  const res = validateIdeaBlueprint(goodBp);
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.missingFields.length, 0);
  assert.strictEqual(res.reason, undefined);
});

// ==============================================================================
// SUITE 5: ADVERSARIAL EDGE CASES & PROMPT ECHO STRIPPING
// ==============================================================================
console.log('\n▶ [SUITE 5] ADVERSARIAL EDGE CASES & PROMPT ECHO STRIPPING');

runTest('5.1 Master Prompt format with SCRIPT block and trailing NARRATION DIRECTION', () => {
  const masterRaw = `
Dưới đây là kịch bản hoàn chỉnh:
SCRIPT:
CÂU 1: Bí ẩn vùng tam giác rồng tại vùng biển Nhật Bản | VISUAL: Bản đồ đại dương | MEDIA: video
CÂU 2: Hàng loạt tàu thuyền đã mất tích không một vết tích | VISUAL: Sóng biển cuộn trào | MEDIA: video
CÂU 3: Hãy cùng chúng tôi tìm kiếm sự thật đằng sau hiện tượng này | VISUAL: Tàu cứu hộ | MEDIA: video
--- END OF SCRIPT ---
NARRATION DIRECTION:
Giọng đọc trầm ấm, kịch tính, nhịp điệu nhanh vừa phải.
  `;
  const beats = parseChatGptScriptResponse(masterRaw, 'Tam Giác Rồng');
  assert.strictEqual(beats.length, 3, 'Should parse 3 beats from SCRIPT block');
  for (const b of beats) {
    assert(!b.text.includes('NARRATION DIRECTION'), 'Narration direction must not leak into beats');
    assert(!b.text.includes('Giọng đọc trầm ấm'), 'Narration text must not leak into beats');
  }
});

runTest('5.2 Marker with only === BEGIN SCRIPT === and unclosed stream', () => {
  const streamRaw = `
Lời mở đầu của AI...
=== BEGIN SCRIPT ===
CÂU 1: Đây là câu thoại đầu tiên đang streaming dở dang | VISUAL: Cảnh 1 | MEDIA: video
CÂU 2: Đây là câu thoại thứ hai đang truyền dữ liệu | VISUAL: Cảnh 2 | MEDIA: video
CÂU 3: Đây là câu thoại thứ ba kết thúc stream trước khi có end marker | VISUAL: Cảnh 3 | MEDIA: video
  `;
  const beats = parseChatGptScriptResponse(streamRaw, 'Streaming');
  assert.strictEqual(beats.length, 3);
  assert(!beats[0].text.includes('Lời mở đầu'), 'Preamble before BEGIN marker must be stripped');
});

runTest('5.3 Marker with only === END SCRIPT === strips trailing conversation', () => {
  const endOnlyRaw = `
CÂU 1: Đây là phân cảnh đầu tiên của video | MEDIA: video
CÂU 2: Đây là phân cảnh thứ hai của video | MEDIA: video
CÂU 3: Đây là phân cảnh thứ ba của video | MEDIA: video
=== END SCRIPT ===
Chúc bạn có một video thật tuyệt vời và nhiều người xem nhé!
  `;
  const beats = parseChatGptScriptResponse(endOnlyRaw, 'End only');
  assert.strictEqual(beats.length, 3);
  for (const b of beats) {
    assert(!b.text.includes('Chúc bạn'), 'Postscript after END marker must be stripped');
  }
});

runTest('5.4 Empty or non-string inputs return empty array safely without crash', () => {
  assert.deepStrictEqual(parseChatGptScriptResponse('', 'Test'), []);
  assert.deepStrictEqual(parseChatGptScriptResponse('   ', 'Test'), []);
  assert.deepStrictEqual(parseChatGptScriptResponse(null as any, 'Test'), []);
  assert.deepStrictEqual(parseChatGptScriptResponse(undefined as any, 'Test'), []);
});

runTest('5.5 Prompt echo sanitizer purges prompt boilerplate from generated text', () => {
  const prompt = `NHIỆM VỤ:\nViết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho video ngắn.\nQUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:\nBẮT BUỘC bọc toàn bộ các câu trong marker:\n=== BEGIN SCRIPT ===\nCÂU 1: ...\n=== END SCRIPT ===`;
  const outputWithEcho = `
NHIỆM VỤ:
Viết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho video ngắn.
=== BEGIN SCRIPT ===
CÂU 1: Hook mở đầu kịch tính và thu hút người xem
CÂU 2: Bối cảnh diễn biến hấp dẫn
CÂU 3: Lời kết kêu gọi like và subscribe
=== END SCRIPT ===
  `;
  const sanitized = sanitizePromptEchoFromOutput(outputWithEcho, prompt);
  assert(!sanitized.includes('NHIỆM VỤ:'), 'Boilerplate "NHIỆM VỤ:" must be purged');
  assert(sanitized.includes('=== BEGIN SCRIPT ==='), 'Script marker preserved');
  assert(sanitized.includes('CÂU 1: Hook mở đầu'), 'Script content preserved');
});

// ==============================================================================
// SUMMARY & EXIT
// ==============================================================================
console.log('\n================================================================================');
console.log(`  M4 EMPIRICAL ADVERSARIAL STRESS TEST RESULTS`);
console.log(`  Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests} | Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);
console.log('================================================================================\n');

if (failedTests > 0) {
  console.error('FAILURES DETECTED:');
  for (const f of failureDetails) {
    console.error(f);
  }
  process.exit(1);
} else {
  console.log('🎉 ALL EMPIRICAL ADVERSARIAL STRESS TESTS PASSED (100%)!');
  process.exit(0);
}
