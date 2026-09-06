/**
 * Test các nâng cấp pipeline từ audit (không cần server/Electron):
 * 1. mergeChunkTranscripts — gộp phụ đề chunk whisper có vùng chồng lấp
 * 2. scaleSrtLines — kéo giãn timeline cho mode video-stretch
 * 3. Checkpoint dịch thuật — round-trip ghi/đọc/tự xoá
 * Chạy: npx tsx scripts/test-pipeline-fixes.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

// translator.ts import electron-store — cần chỉ cwd settings sang thư mục tạm
process.env.VANHSUB_SETTINGS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-test-settings-'));

import { mergeChunkTranscripts, type ChunkTranscript } from '../main/asr/whisperEngine';
import { scaleSrtLines } from '../main/render/dubbingEngine';
import {
  getCheckpointPath,
  loadCheckpoint,
  saveCheckpoint,
} from '../main/translate/translator';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`✅ ${name}`);
  } else {
    failures++;
    console.error(`❌ ${name}`, detail ?? '');
  }
}

const line = (id: number, startMs: number, endMs: number, text: string) => ({
  id: `line-${id}`,
  startMs,
  endMs,
  text,
});

// ---------- 1. mergeChunkTranscripts ----------
console.log('\n== mergeChunkTranscripts ==');
const overlapMs = 2000;
// Chunk 0: [0, 602s) — dòng cuối kết thúc ở 601.5s (trong vùng chồng lấp)
// Chunk 1: offset 598s — dòng đầu nằm trong vùng chồng lấp (598-600s) → trùng, phải bỏ
const chunks: ChunkTranscript[] = [
  {
    offsetMs: 0,
    lines: [
      line(0, 1000, 3000, 'Cau mot'),
      line(1, 590000, 601500, 'Cau vung chong lap'),
    ],
  },
  {
    offsetMs: 598000,
    lines: [
      line(0, 1000, 2000, 'Cau vung chong lap (trung)'), // absolute 599s → trong vùng chồng → bỏ
      line(1, 2500, 4500, 'Cau sau'), // absolute 600.5s > 602-0.25? → 600.5 < 601.75 → cũng trong vùng!
      line(2, 5000, 7000, 'Cau ke tiep'), // absolute 603s → ngoài vùng, giữ
    ],
  },
];
const merged = mergeChunkTranscripts(chunks, overlapMs);
check('Bỏ dòng trùng trong vùng chồng lấp', merged.every((l) => l.text !== 'Cau vung chong lap (trung)'));
check('Giữ dòng bắt đầu sau vùng chồng lấp', merged.some((l) => l.text === 'Cau ke tiep'), merged);
check(
  'Timestamp tuyệt đối (offset cộng đúng)',
  merged.find((l) => l.text === 'Cau ke tiep')?.startMs === 603000
);
check('Id đánh lại tuần tự', merged.map((l) => l.id).join(',') === 'line-0,line-1,line-2', merged);

// Chunk trước KHÔNG nghe thấy gì trong vùng chồng → giữ dòng của chunk sau
const chunks2: ChunkTranscript[] = [
  { offsetMs: 0, lines: [line(0, 1000, 3000, 'Cau mot')] },
  { offsetMs: 598000, lines: [line(0, 500, 2500, 'Cau moi xuat hien')] }, // abs 598.5s
];
const merged2 = mergeChunkTranscripts(chunks2, overlapMs);
check(
  'Chunk trước im lặng → giữ dòng chunk sau trong vùng chồng',
  merged2.some((l) => l.text === 'Cau moi xuat hien'),
  merged2
);

// ---------- 2. scaleSrtLines ----------
console.log('\n== scaleSrtLines ==');
const lines = [line(0, 1000, 2000, 'A'), line(1, 5000, 6000, 'B')];
const scaled = scaleSrtLines(lines, 1.25);
check('Scale đúng hệ số', scaled[0].startMs === 1250 && scaled[1].endMs === 7500, scaled);
check('Giữ nguyên text', scaled.every((l, i) => l.text === lines[i].text));

// ---------- 3. Checkpoint dịch thuật ----------
console.log('\n== checkpoint round-trip ==');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-test-ckpt-'));
const srtPath = path.join(tmpDir, 'movie.srt');
fs.writeFileSync(srtPath, 'dummy', 'utf-8');

check('Checkpoint chưa tồn tại → map rỗng', loadCheckpoint(srtPath, 'vi').size === 0);

saveCheckpoint(srtPath, 'vi', {
  'line-0': { source: 'Hello', target: 'Xin chao' },
  'line-1': { source: 'Goodbye', target: 'Tam biet' },
});
const restored = loadCheckpoint(srtPath, 'vi');
check('Đọc lại đúng 2 dòng cache', restored.size === 2);
check(
  'Dữ liệu nguyên vẹn (source + target)',
  JSON.parse(restored.get('line-0')!)[0] === 'Hello' &&
    JSON.parse(restored.get('line-0')!)[1] === 'Xin chao'
);

// Đổi ngôn ngữ → cache phải bị bỏ qua
check('Sai ngôn ngữ → bỏ qua cache', loadCheckpoint(srtPath, 'en').size === 0);

// Checkpoint hỏng → trả map rỗng, không ném lỗi
fs.writeFileSync(getCheckpointPath(srtPath), '{hỏng cú pháp', 'utf-8');
check('Checkpoint hỏng → map rỗng (không crash)', loadCheckpoint(srtPath, 'vi').size === 0);

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(process.env.VANHSUB_SETTINGS_DIR, { recursive: true, force: true });

console.log(failures === 0 ? '\n🎉 TẤT CẢ PASS' : `\n💥 ${failures} test FAIL`);
process.exit(failures === 0 ? 0 : 1);
