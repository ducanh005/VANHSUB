// scripts/test-tiktok-tts.ts
//
// Script test TikTok TTS provider qua terminal — KHÔNG cần mở app Electron.
// Dùng sessionid của CHÍNH BẠN, truyền qua biến môi trường (không qua argv
// để tránh lưu vào shell history). Session chỉ nằm trong bộ nhớ tiến trình,
// KHÔNG được ghi xuống đĩa bất kỳ đâu.
//
// Cách chạy:
//   TIKTOK_SESSIONID=<session_của_bạn> npx tsx scripts/test-tiktok-tts.ts ["text cần đọc"] [voiceId]
//
// Ví dụ (giọng Việt nữ):
//   TIKTOK_SESSIONID=abc123... npx tsx scripts/test-tiktok-tts.ts "Xin chào Việt Nam" BV074_streaming
//
// Script sẽ: (1) kiểm tra format session, (2) xác thực session với TikTok,
// (3) tổng hợp audio, (4) ghi file samples/tiktok-tts-test.mp3.
// Sessionid không bao giờ được in ra màn hình.

import path from 'path';
import { TikTokSessionManager } from '../main/tts-providers/tiktok/TikTokSessionManager';
import { TikTokTTSClient } from '../main/tts-providers/tiktok/TikTokTTSClient';
import { TikTokTTSProvider } from '../main/tts-providers/tiktok/TikTokTTSProvider';
import { TikTokVoiceService } from '../main/tts-providers/tiktok/TikTokVoiceService';
import type { TikTokSessionStore } from '../main/tts-providers/tiktok/types';

/** Store chỉ đọc từ env — save/clear bị cấm để test không ghi credential xuống đĩa */
class EnvOnlySessionStore implements TikTokSessionStore {
  load(): string {
    return (process.env.TIKTOK_SESSIONID || '').trim();
  }
  save(): void {
    throw new Error('Test script không lưu session — hãy truyền TIKTOK_SESSIONID qua biến môi trường.');
  }
  clear(): void {
    // không làm gì — env là nguồn duy nhất
  }
}

async function main() {
  const text = process.argv[2] || 'Xin chào! Đây là bài test TikTok TTS trong VANHSUB.';
  const voice = process.argv[3] || TikTokVoiceService.defaultVoice;

  const store = new EnvOnlySessionStore();
  if (!store.load()) {
    console.error('❌ Chưa có TIKTOK_SESSIONID trong biến môi trường.');
    console.error('   Cách lấy: đăng nhập tiktok.com trên trình duyệt → tiện ích Cookie-Editor → copy giá trị cookie "sessionid".');
    console.error('   Chạy lại: TIKTOK_SESSIONID=<giá_trị> npx tsx scripts/test-tiktok-tts.ts "text" [voiceId]');
    process.exit(1);
  }

  const session = new TikTokSessionManager(store);
  const provider = new TikTokTTSProvider(session, new TikTokTTSClient());

  // 1. Kiểm tra format session (không in giá trị, không lưu xuống đĩa)
  const rawSession = store.load();
  if (!TikTokSessionManager.isValidFormat(rawSession)) {
    console.error('❌ sessionid không đúng định dạng (chuỗi alphanumeric ~32 ký tự). Copy lại nguyên vẹn cookie "sessionid".');
    process.exit(1);
  }
  console.log(`[1/3] ✓ Format session hợp lệ (độ dài ${rawSession.length} ký tự — giá trị không được hiển thị)`);

  // 2. Xác thực session với TikTok (probe request nhỏ)
  console.log('[2/3] Đang xác thực session với TikTok...');
  const validation = await provider.validateSession();
  if (!validation.valid) {
    console.error(`❌ Session không hợp lệ: ${validation.detail}`);
    process.exit(2);
  }
  console.log(`[2/3] ✓ ${validation.detail}`);

  // 3. Danh sách voice + tổng hợp
  const voices = await provider.getVoices();
  const viVoices = voices.filter((v) => v.language === 'vi').map((v) => v.id).join(', ');
  console.log(`[3/3] Catalog: ${voices.length} voice — giọng Việt: ${viVoices}`);
  console.log(`[3/3] Đang tổng hợp bằng "${voice}": "${text}"`);

  const outPath = path.resolve('samples', 'tiktok-tts-test.mp3');
  try {
    await provider.saveAudio(text, voice, outPath);
  } catch (err: any) {
    console.error(`❌ Tổng hợp thất bại: ${err?.message}`);
    if (err?.code) console.error(`   Mã lỗi: ${err.code}`);
    process.exit(3);
  }
  console.log(`✅ Xong! Audio tại: ${outPath}`);
}

main().catch((err) => {
  console.error('❌ Lỗi không mong muốn:', err instanceof Error ? err.message : err);
  process.exit(1);
});
