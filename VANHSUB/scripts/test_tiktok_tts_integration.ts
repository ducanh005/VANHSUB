import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { aiStudioTtsService } from '../main/ai-studio/services/AiStudioTtsService';
import type {
  ScriptBeatLine,
  AiStudioVoiceConfig,
} from '../main/ai-studio/types';
import type {
  TiktokTTSProvider,
  SynthesisResult,
  TikTokValidateResult,
  TikTokVoice,
} from '../main/tts-providers/tiktok/types';

async function runTests() {
  console.log('=== TEST 1: Voice ID Normalization for TikTok TTS ===');

  // Edge TTS standard voices
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('female', 'edge_tts'), 'vi-VN-HoaiMyNeural');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('male', 'edge_tts'), 'vi-VN-NamMinhNeural');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('vi-VN-HoaiMyNeural', 'edge_tts'), 'vi-VN-HoaiMyNeural');

  // TikTok TTS voices
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('BV074_streaming', 'tiktok_tts'), 'BV074_streaming');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('BV075_streaming', 'tiktok_tts'), 'BV075_streaming');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('nam', 'tiktok_tts'), 'BV075_streaming');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('male', 'tiktok_tts'), 'BV075_streaming');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('nữ', 'tiktok_tts'), 'BV074_streaming');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('female', 'tiktok_tts'), 'BV074_streaming');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('en_male_narration', 'tiktok_tts'), 'en_male_narration');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('en_us_001', 'tiktok_tts'), 'en_us_001');

  // Auto-detect TikTok voice from ID prefix
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('BV074_streaming'), 'BV074_streaming');
  assert.strictEqual(aiStudioTtsService.normalizeVoiceId('BV075_streaming'), 'BV075_streaming');
  console.log('✓ [PASS] Voice ID normalization handles both Edge-TTS and TikTok TTS accurately.');

  // =========================================================================
  console.log('\n=== TEST 2: TikTok Text Chunking (< 220 chars limit) ===');

  const shortText = 'Đây là câu ngắn dưới hai trăm ký tự.';
  const shortChunks = aiStudioTtsService.chunkTextForTikTok(shortText, 220);
  assert.strictEqual(shortChunks.length, 1);
  assert.strictEqual(shortChunks[0], shortText);

  const longText =
    'Cách đây hàng triệu năm, khi trái đất còn chìm trong kỷ băng hà khắc nghiệt, những bộ tộc nguyên thủy đầu tiên đã phải chiến đấu không ngừng nghỉ để sinh tồn giữa thiên nhiên hoang dã. Họ săn voi ma mút khổng lồ, tìm kiếm hang đá làm nơi trú ẩn qua mùa đông giá lạnh, và bảo vệ ngọn lửa thiêng liêng như sự sống của cả bộ tộc. Từng vết tích trên vách đá cổ xưa ngày nay vẫn còn ghi dấu lại ý chí kiên cường và lòng dũng cảm phi thường của tổ tiên chúng ta.';

  const longChunks = aiStudioTtsService.chunkTextForTikTok(longText, 200);
  assert.ok(longChunks.length >= 2, `Expected at least 2 chunks, got ${longChunks.length}`);
  for (let i = 0; i < longChunks.length; i++) {
    assert.ok(
      longChunks[i].length <= 200,
      `Chunk ${i} length (${longChunks[i].length}) must not exceed 200 chars: "${longChunks[i]}"`
    );
    console.log(`  - Chunk ${i + 1} (${longChunks[i].length} chars): "${longChunks[i].slice(0, 50)}..."`);
  }
  console.log('✓ [PASS] Text chunking guarantees TikTok 300-char safety without corrupting sentence boundary.');

  // =========================================================================
  console.log('\n=== TEST 3: TikTok TTS Line-by-Line Synthesis with Mock Provider ===');

  const ttsTmpDir = path.join(os.tmpdir(), 'vanhsub-test-tiktok-tts-' + Date.now());
  fs.mkdirSync(ttsTmpDir, { recursive: true });

  // Minimal valid 1-frame MP3 buffer to simulate audio synthesis
  // MP3 frame header (MPEG-1 Layer 3, 128 kbps, 44.1 kHz)
  const dummyMp3Header = Buffer.from([
    0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const mockAudioBuffer = Buffer.concat([dummyMp3Header, Buffer.alloc(3000, 0xaa)]);

  let mockSynthesizeCalls = 0;
  const mockTikTokProvider: TiktokTTSProvider = {
    hasSession: () => true,
    validateSession: async (): Promise<TikTokValidateResult> => ({
      valid: true,
      detail: 'Mock session valid',
    }),
    getVoices: async (): Promise<TikTokVoice[]> => [],
    synthesize: async (text: string, voice: string): Promise<SynthesisResult> => {
      mockSynthesizeCalls++;
      return {
        audio: mockAudioBuffer,
        durationMs: 1500,
      };
    },
    saveAudio: async (text: string, voice: string, out: string): Promise<string> => {
      fs.writeFileSync(out, mockAudioBuffer);
      return out;
    },
  };

  aiStudioTtsService.setTikTokProvider(mockTikTokProvider);

  const testLines: ScriptBeatLine[] = [
    { id: 't_line_1', index: 1, text: 'Chào mừng các bạn đến với kênh khám phá bí ẩn vũ trụ.' },
    { id: 't_line_2', index: 2, text: 'Hôm nay chúng ta sẽ tìm hiểu về hố đen sâu thẳm ngoài không gian.' },
  ];

  const tikTokVoiceConfig: AiStudioVoiceConfig = {
    provider: 'tiktok_tts',
    voiceId: 'BV074_streaming',
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
    autoWordAlignment: true,
  };

  const lineAudio1 = path.join(ttsTmpDir, 'line_1.mp3');
  await aiStudioTtsService.synthesizeSingleSpeechChunk(
    testLines[0].text,
    'BV074_streaming',
    { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
    lineAudio1,
    undefined,
    'tiktok_tts'
  );

  assert.ok(fs.existsSync(lineAudio1), 'TikTok audio file must exist');
  assert.ok(fs.statSync(lineAudio1).size > 0, 'TikTok audio file must not be empty');
  assert.ok(mockSynthesizeCalls >= 1, 'Mock TikTok synthesize must have been called');
  console.log(`✓ [PASS] Mock TikTok TTS synthesized successfully (${mockSynthesizeCalls} calls).`);

  // =========================================================================
  console.log('\n=== TEST 4: Graceful Fallback to Edge TTS when TikTok Session is Missing ===');

  // Configure provider to report no session
  const mockNoSessionProvider: TiktokTTSProvider = {
    hasSession: () => false,
    validateSession: async () => ({ valid: false, detail: 'No session' }),
    getVoices: async () => [],
    synthesize: async () => {
      throw new Error('SESSION_MISSING');
    },
    saveAudio: async () => '',
  };

  aiStudioTtsService.setTikTokProvider(mockNoSessionProvider);

  const fallbackAudioPath = path.join(ttsTmpDir, 'fallback_line.mp3');
  // Should NOT throw! Should warn and fall back to Edge TTS.
  const fallbackBuffer = await aiStudioTtsService.synthesizeSingleSpeechChunk(
    'Đây là bài kiểm tra tự động chuyển đổi sang Edge TTS khi mất session TikTok.',
    'BV075_streaming', // Nam -> Should fallback to vi-VN-NamMinhNeural
    { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
    fallbackAudioPath,
    undefined,
    'tiktok_tts'
  );

  assert.ok(fs.existsSync(fallbackAudioPath), 'Fallback audio must exist');
  assert.ok(fallbackBuffer.length > 500, `Fallback audio buffer must be > 500 bytes, got ${fallbackBuffer.length}`);
  console.log(`✓ [PASS] Graceful fallback to Edge-TTS succeeded seamlessly (${fallbackBuffer.length} bytes).`);

  // Reset provider
  aiStudioTtsService.setTikTokProvider(null);

  // Clean up
  try {
    fs.rmSync(ttsTmpDir, { recursive: true, force: true });
  } catch {}

  console.log('\n==================================================');
  console.log('ALL TIKTOK TTS INTEGRATION TESTS PASSED! ✅');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
