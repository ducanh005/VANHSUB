import fs from 'fs';
import path from 'path';
import { parseSrt, serializeSrt, type SrtLine } from '../main/lib/srt';
import { resolvePythonExecutable, probePythonEnv, checkFasterWhisperAvailable } from '../main/lib/pythonEnv';
import { transcribeUnified } from '../main/asr/asrRouter';

/**
 * Tạo file WAV 16kHz mono 16-bit PCM nhân tạo để kiểm thử ASR
 */
function createSyntheticWav(filePath: string, durationSec = 1.5): string {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF Chunk
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt Subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20);  // PCM format
  buffer.writeUInt16LE(1, 22);  // Mono (1 channel)
  buffer.writeUInt32LE(sampleRate, 24); // 16000 Hz
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32);  // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data Subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Tạo âm thanh sóng sin 440Hz
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * t) * 8000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
}

async function runTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ MILESTONE 1: FASTER-WHISPER & DIARIZATION FALLBACK ===\n');

  // =========================================================================
  // TEST SUITE 1: SRT PARSER & SERIALIZER VỚI SPEAKER VÀ WORD TIMESTAMPS
  // =========================================================================
  console.log('[TEST 1] Kiểm tra phân tích cú pháp và tuần tự hoá nhãn người nói SRT...');

  const sampleSrt = `1
00:00:01,000 --> 00:00:03,500
[SPEAKER_00]: Xin chào tất cả các bạn đã quay trở lại.

2
00:00:04,000 --> 00:00:07,200
[SPEAKER_01]: Hôm nay chúng ta sẽ kiểm tra tính năng Diarization.

3
00:00:07,500 --> 00:00:10,000
Dòng này không có nhãn người nói.
`;

  const parsedLines = parseSrt(sampleSrt);
  assert(parsedLines.length === 3, `Phải phân tích được 3 dòng, thực tế: ${parsedLines.length}`);

  // Dòng 1: SPEAKER_00
  assert(parsedLines[0].speaker === 'SPEAKER_00', `Speaker dòng 1 phải là SPEAKER_00, thực tế: ${parsedLines[0].speaker}`);
  assert(
    parsedLines[0].text === 'Xin chào tất cả các bạn đã quay trở lại.',
    `Nội dung text dòng 1 phải loại bỏ prefix [SPEAKER_00]:, thực tế: "${parsedLines[0].text}"`
  );
  assert(parsedLines[0].startMs === 1000, `startMs dòng 1 phải là 1000, thực tế: ${parsedLines[0].startMs}`);
  assert(parsedLines[0].endMs === 3500, `endMs dòng 1 phải là 3500, thực tế: ${parsedLines[0].endMs}`);

  // Dòng 2: SPEAKER_01
  assert(parsedLines[1].speaker === 'SPEAKER_01', `Speaker dòng 2 phải là SPEAKER_01, thực tế: ${parsedLines[1].speaker}`);
  assert(
    parsedLines[1].text === 'Hôm nay chúng ta sẽ kiểm tra tính năng Diarization.',
    `Nội dung text dòng 2 thực tế: "${parsedLines[1].text}"`
  );

  // Dòng 3: Không có speaker
  assert(parsedLines[2].speaker === undefined, `Speaker dòng 3 phải là undefined, thực tế: ${parsedLines[2].speaker}`);
  assert(
    parsedLines[2].text === 'Dòng này không có nhãn người nói.',
    `Nội dung text dòng 3 thực tế: "${parsedLines[2].text}"`
  );

  // Tuần tự hoá lại (Serialization roundtrip)
  const serialized = serializeSrt(parsedLines);
  assert(
    serialized.includes('[SPEAKER_00]: Xin chào tất cả các bạn đã quay trở lại.'),
    'SRT tuần tự hoá phải chứa lại [SPEAKER_00]:'
  );
  assert(
    serialized.includes('[SPEAKER_01]: Hôm nay chúng ta sẽ kiểm tra tính năng Diarization.'),
    'SRT tuần tự hoá phải chứa lại [SPEAKER_01]:'
  );
  assert(
    serialized.includes('Dòng này không có nhãn người nói.') && !serialized.includes('[: Dòng này'),
    'SRT tuần tự hoá dòng 3 không được có nhãn speaker rỗng'
  );

  // Roundtrip parse lại một lần nữa
  const roundtripLines = parseSrt(serialized);
  assert(roundtripLines[0].speaker === 'SPEAKER_00', 'Roundtrip speaker 0 trùng khớp');
  assert(roundtripLines[1].speaker === 'SPEAKER_01', 'Roundtrip speaker 1 trùng khớp');
  assert(roundtripLines[2].speaker === undefined, 'Roundtrip speaker 2 undefined trùng khớp');

  // Kiểm tra hỗ trợ word timestamps
  const lineWithWords: SrtLine = {
    id: 'line-words',
    startMs: 1000,
    endMs: 3000,
    text: 'Xin chào',
    speaker: 'SPEAKER_00',
    words: [
      { word: 'Xin', startMs: 1000, endMs: 1500, speaker: 'SPEAKER_00' },
      { word: 'chào', startMs: 1600, endMs: 2500, speaker: 'SPEAKER_00' },
    ],
  };
  assert(lineWithWords.words?.length === 2, 'Cấu trúc SrtLine hỗ trợ trường words[]');
  assert(lineWithWords.words?.[0].word === 'Xin', 'SrtWord[0] lưu đúng từ');
  console.log('=> [TEST 1 PASS] Phân tích cú pháp & tuần tự hoá Speaker SRT thành công 100%.\n');

  // =========================================================================
  // TEST SUITE 2: THĂM DÒ MÔI TRƯỜNG PYTHON (pythonEnv.ts)
  // =========================================================================
  console.log('[TEST 2] Kiểm tra thăm dò môi trường Python và ML modules...');

  const pythonExec = resolvePythonExecutable();
  console.log(`[PythonEnv] Executable phát hiện được: ${pythonExec}`);
  assert(typeof pythonExec === 'string' && pythonExec.length > 0, 'Phải giải quyết được đường dẫn Python');

  const envInfo = await probePythonEnv();
  console.log('[PythonEnv] Thông tin môi trường probe được:', JSON.stringify(envInfo, null, 2));
  assert(typeof envInfo.hasTorch === 'boolean', 'hasTorch phải là boolean');
  assert(typeof envInfo.hasCuda === 'boolean', 'hasCuda phải là boolean');
  assert(typeof envInfo.hasFasterWhisper === 'boolean', 'hasFasterWhisper phải là boolean');
  assert(typeof envInfo.hasCtranslate2 === 'boolean', 'hasCtranslate2 phải là boolean');

  const fwAvailability = await checkFasterWhisperAvailable();
  console.log('[PythonEnv] Kết quả checkFasterWhisperAvailable():', fwAvailability);
  assert(typeof fwAvailability.available === 'boolean', 'fwAvailability.available phải là boolean');
  assert(typeof fwAvailability.useCuda === 'boolean', 'fwAvailability.useCuda phải là boolean');
  console.log('=> [TEST 2 PASS] Thăm dò môi trường Python hoạt động chính xác.\n');

  // =========================================================================
  // TEST SUITE 3: ĐIỀU PHỐI VÀ CƠ CHẾ DỰ PHÒNG TỰ ĐỘNG (asrRouter.ts Fallback)
  // =========================================================================
  console.log('[TEST 3] Kiểm tra điều phối ASR Router và cơ chế Graceful Fallback...');

  const testDir = path.join(process.cwd(), 'temp', 'test_asr_m1');
  const testWav = path.join(testDir, 'synthetic_test_16k.wav');
  createSyntheticWav(testWav, 2.0);
  assert(fs.existsSync(testWav), 'File WAV mẫu thử nghiệm phải được tạo thành công');

  // Trường hợp 3A: Gọi trực tiếp Whisper.cpp
  console.log('--- 3A: Yêu cầu trực tiếp engine whisper-cpp ---');
  const resultCpp = await transcribeUnified(testWav, {
    asrEngine: 'whisper-cpp',
    model: 'tiny',
  });
  console.log('[ASR Router] Kết quả 3A:', resultCpp);
  assert(resultCpp.engineUsed === 'whisper-cpp', 'Phải sử dụng whisper-cpp');
  assert(resultCpp.fallbackTriggered === false, 'Không kích hoạt fallback khi người dùng chọn thẳng whisper-cpp');
  assert(fs.existsSync(resultCpp.srtPath), `File SRT phải tồn tại tại: ${resultCpp.srtPath}`);

  // Trường hợp 3B: Yêu cầu faster-whisper trên môi trường chưa cài module -> Fallback tự động
  console.log('--- 3B: Yêu cầu faster-whisper với tự động Fallback về whisper.cpp ---');
  let progressUpdates = 0;
  let fallbackMessageReceived = false;

  const resultFwFallback = await transcribeUnified(testWav, {
    asrEngine: 'faster-whisper',
    model: 'tiny',
    onProgress: (percent, stage) => {
      progressUpdates++;
      if (stage && stage.includes('fallback')) {
        fallbackMessageReceived = true;
      }
    },
  });

  console.log('[ASR Router] Kết quả 3B:', resultFwFallback);
  if (!envInfo.hasFasterWhisper) {
    // Trên máy này chưa có faster-whisper -> bắt buộc phải fallback về whisper.cpp
    assert(
      resultFwFallback.engineUsed === 'whisper-cpp',
      `Phải tự động fallback về whisper-cpp khi thiếu module, thực tế: ${resultFwFallback.engineUsed}`
    );
    assert(
      resultFwFallback.fallbackTriggered === true,
      `Cờ fallbackTriggered phải là true, thực tế: ${resultFwFallback.fallbackTriggered}`
    );
    assert(
      fallbackMessageReceived === true,
      'Callback onProgress phải thông báo cho người dùng về tiến trình fallback'
    );
  } else {
    // Nếu có faster-whisper thì chạy bình thường
    assert(resultFwFallback.engineUsed === 'faster-whisper', 'Phải sử dụng faster-whisper khi có module');
  }
  assert(fs.existsSync(resultFwFallback.srtPath), `File SRT kết quả phải được tạo ra tại: ${resultFwFallback.srtPath}`);

  console.log('=> [TEST 3 PASS] Cơ chế 2-Tier Fallback hoạt động trơn tru không lỗi.\n');

  // Trường hợp 3C: Giả lập Tier 2 Runtime Error (ví dụ CUDA OOM giữa chừng) -> Fallback về whisper.cpp
  console.log('--- 3C: Giả lập Tier 2 Runtime Error -> Fallback tự động về whisper.cpp ---');
  let tier2FallbackLogged = false;
  const resultTier2 = await transcribeUnified(testWav, {
    asrEngine: 'faster-whisper',
    model: 'tiny',
    customFwChecker: async () => ({ available: true, useCuda: true }),
    customFwRunner: async () => {
      throw new Error('Simulated CUDA Out-of-Memory (OOM) during CTranslate2 execution');
    },
    onProgress: (_p, stage) => {
      if (stage && stage.includes('runtime')) {
        tier2FallbackLogged = true;
      }
    },
  });

  console.log('[ASR Router] Kết quả 3C:', resultTier2);
  assert(resultTier2.engineUsed === 'whisper-cpp', 'Tier 2 phải fallback về whisper-cpp khi runtime lỗi');
  assert(resultTier2.fallbackTriggered === true, 'fallbackTriggered phải là true');
  assert(tier2FallbackLogged === true, 'Callback onProgress phải thông báo runtime fallback');
  assert(fs.existsSync(resultTier2.srtPath), 'File SRT phải được tạo bởi whisper-cpp');
  console.log('=> [TEST 3C PASS] Phục hồi lỗi runtime Tier 2 thành công.\n');

  // Dọn dẹp file tạm
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('================================================================');
  console.log('TẤT CẢ CÁC BÀI KIỂM THỬ MILESTONE 1 ĐÃ VƯỢT QUA XUẤT SẮC (100% PASS)');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('[TEST SUITE ERROR]', err);
  process.exit(1);
});
