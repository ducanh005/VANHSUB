// scripts/test-asr.ts
//
// Script test whisperEngine.ts qua terminal, KHÔNG cần mở app Electron.
// Cách chạy: npx tsx scripts/test-asr.ts <đường-dẫn-file-audio>

import path from 'path';
import { transcribe } from '../main/asr/whisperEngine';

async function main() {
  const audioPathArg = process.argv[2];

  if (!audioPathArg) {
    console.error('Thiếu đường dẫn file audio.');
    console.error('Dùng: npx tsx scripts/test-asr.ts <đường-dẫn-file-audio>');
    console.error('Ví dụ: npx tsx scripts/test-asr.ts ./samples/test.wav');
    process.exit(1);
  }

  const audioPath = path.resolve(audioPathArg);
  console.log('Đang transcribe:', audioPath);
  console.log('(Lần đầu chạy sẽ tự tải model, có thể mất vài phút...)');

  try {
    const result = await transcribe(audioPath, { modelName: 'base' });
    console.log('✅ Xong! File srt tại:', result.srtPath);
  } catch (err) {
    console.error('❌ Lỗi khi transcribe:', err);
    process.exit(1);
  }
}

main();