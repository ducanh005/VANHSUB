import assert from 'assert';
import { consolidateSubtitleClauses, segmentSubtitlesNetflix } from '../main/lib/nlpSegmenter';
import { groupSubtitlesForTts, type SubtitleLine } from '../main/render/ttsEngine';
import type { SrtLine } from '../main/lib/srt';

console.log('=== INDEPENDENT BENCHMARK VERIFICATION ===');

const benchmarkBlocks: SrtLine[] = [
  { id: '1', startMs: 1000, endMs: 2200, text: 'chụp ảnh được, livestream được' },
  { id: '2', startMs: 2300, endMs: 4500, text: 'tái hiện lại các cảnh kinh điển cũng được' },
  { id: '3', startMs: 4600, endMs: 7800, text: 'nhưng giá cho mỗi hoạt động tính thế nào?' },
];

// Test 1: consolidateSubtitleClauses
console.log('\n--- Test 1: consolidateSubtitleClauses output details ---');
const consolidated = consolidateSubtitleClauses(benchmarkBlocks);
console.log(`Consolidated count: ${consolidated.length} blocks`);
consolidated.forEach((b, idx) => {
  console.log(`Block ${idx + 1} [${b.startMs} - ${b.endMs}]:`);
  const lines = b.text.split('\n');
  lines.forEach((l, lIdx) => {
    console.log(`  Line ${lIdx + 1} (${l.length} chars): "${l}"`);
  });
});

assert.strictEqual(consolidated.length, 2, 'Benchmark sentence must consolidate into 2 blocks');
assert.strictEqual(consolidated[0].startMs, 1000);
assert.strictEqual(consolidated[0].endMs, 4500);
assert.strictEqual(consolidated[1].startMs, 4600);
assert.strictEqual(consolidated[1].endMs, 7800);

for (const b of consolidated) {
  const lines = b.text.split('\n');
  assert.ok(lines.length <= 2, 'At most 2 lines per block');
  for (const l of lines) {
    assert.ok(l.length <= 37, `Line exceeds 37 chars: "${l}"`);
  }
}

// Test 2: groupSubtitlesForTts
console.log('\n--- Test 2: groupSubtitlesForTts output details ---');
const subs: SubtitleLine[] = benchmarkBlocks.map((b, idx) => ({
  index: idx + 1,
  startTime: '0',
  endTime: '0',
  startMs: b.startMs,
  endMs: b.endMs,
  durationMs: b.endMs - b.startMs,
  text: b.text,
}));

const groups = groupSubtitlesForTts(subs);
console.log(`SentenceGroups count: ${groups.length}`);
groups.forEach((g, idx) => {
  console.log(`Group ${idx + 1}:`);
  console.log(`  id: ${g.id}`);
  console.log(`  startIndex: ${g.startIndex}, endIndex: ${g.endIndex}`);
  console.log(`  startMs: ${g.startMs}, endMs: ${g.endMs}`);
  console.log(`  text: "${g.text}"`);
  console.log(`  subtitles count: ${g.subtitles.length}`);
});

assert.strictEqual(groups.length, 1, 'Must cluster into exactly 1 SentenceGroup');
assert.strictEqual(groups[0].startIndex, 1);
assert.strictEqual(groups[0].endIndex, 3);
assert.strictEqual(groups[0].startMs, 1000);
assert.strictEqual(groups[0].endMs, 7800);
assert.strictEqual(
  groups[0].text,
  'chụp ảnh được, livestream được tái hiện lại các cảnh kinh điển cũng được nhưng giá cho mỗi hoạt động tính thế nào?'
);

console.log('\n✅ INDEPENDENT BENCHMARK VERIFICATION PASSED PERFECTLY!');
