// scripts/test-translate.ts
//
// Script test translator.ts (translateSrtFile) qua terminal, KHÔNG cần mở app Electron.
// Đọc API key từ settingsStore (electron-store) như khi chạy trong app.
// Cách chạy: npx tsx scripts/test-translate.ts [đường-dẫn-file-srt]

import fs from 'fs';
import path from 'path';
import { translateSrtFile } from '../main/translate/translator';

// Dùng lại đúng store settings của app khi chạy ngoài Electron (ưu tiên bản development)
const appDataDir = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
const devDir = path.join(appDataDir, 'vanhsub (development)');
process.env.VANHSUB_SETTINGS_DIR = fs.existsSync(devDir)
  ? devDir
  : path.join(appDataDir, 'vanhsub');

async function main() {
  const srtArg = process.argv[2] || path.resolve(__dirname, '../samples/test.wav.srt');
  const srtPath = path.resolve(srtArg);

  console.log('Dịch file:', srtPath);
  try {
    const { translatedSrtPath } = await translateSrtFile(srtPath, 'en', (p) =>
      process.stdout.write(`  tiến trình ${p}%\r`)
    );
    console.log('\n✅ Xong! File bản dịch tại:', translatedSrtPath);
  } catch (err: any) {
    console.error('\n❌ Lỗi khi dịch:', err?.message || err);
    process.exit(1);
  }
}

main();
