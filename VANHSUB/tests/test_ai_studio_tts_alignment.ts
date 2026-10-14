import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiStudioTtsService } from '../main/ai-studio/services/AiStudioTtsService';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-alignment-'));
  try {
    const service = new AiStudioTtsService();
    const boundary = (word: string, start: number, duration: number) => ({ Type: 'WordBoundary', Data: { Offset: start * 10000, Duration: duration * 10000, text: { Text: word } } });
    const words = [boundary('Xin', 50, 120), boundary('chào', 300, 150)];
    assert.deepEqual(service.extractWordTimestamps(words, 'Xin chào', 600), [{ word: 'Xin', startMs: 50, endMs: 170 }, { word: 'chào', startMs: 300, endMs: 450 }]);
    const partial = service.extractWordTimestamps([words[0]], 'Xin chào', 600);
    assert.equal(partial.length, 2, 'Incomplete metadata falls back instead of dropping spoken words');
    assert.equal(partial[1].endMs, 600);
    assert.equal(service.calculateSyllabicAlignment('Xin chào', 400)[1].endMs, 400);
    assert.deepEqual(service.calculateSyllabicAlignment('Text', 0), []);
    assert.deepEqual(service.calculateSyllabicAlignment('Text', NaN), []);
    const lines: any[] = [{ id: 'a', index: 1, text: 'Xin chào ⭐', durationMs: 600 }, { id: 'b', index: 2, text: 'Đoạn dài', durationMs: 5400 }];
    const estimated = service.extractAlignment([], lines.map(line => line.text).join(' '), lines, 6000);
    assert.equal(estimated.wordsAlignment[1].endMs, 600);
    assert.equal(estimated.wordsAlignment[2].startMs, 600);
    assert.equal(estimated.wordsAlignment.at(-1)!.endMs, 6000);
    assert.ok(!estimated.wordsAlignment.some(word => word.word.includes('⭐')));
    assert.equal(estimated.alignedLines[0].durationMs, 600);
    const preserved = service.extractAlignment([], 'Xin chào Đoạn dài', lines, 6000, [
      { word: 'Xin', startMs: 50, endMs: 170 }, { word: 'chào', startMs: 300, endMs: 450 },
      { word: 'Đoạn', startMs: 1500, endMs: 3500 }, { word: 'dài', startMs: 4500, endMs: 5700 },
    ]);
    assert.equal(preserved.wordsAlignment[1].startMs, 300, 'Stage 4 must preserve synthesis boundaries after restart');
    assert.equal(preserved.wordsAlignment[2].startMs, 1500);
    const withoutTiming = service.extractAlignment([], 'a b', [{ id: 'a', index: 1, text: 'a' }, { id: 'b', index: 2, text: 'b' }], 400);
    assert.equal(withoutTiming.alignedLines.at(-1)!.endMs, 400, 'No minimum duration may extend lines past audio');
    let spoken: string[] = [];
    (service as any).synthesizeSingleSpeechChunk = async (text: string, _voice: string, _prosody: any, file: string, _signal: any, _provider: any, onMetadata: (items: any[]) => void) => {
      spoken.push(text); fs.writeFileSync(file, 'fake audio');
      if (spoken.length === 1) onMetadata(words);
      return Buffer.from('fake audio');
    };
    service.probeMediaDuration = async file => file.includes('line_1') ? 0.6 : file.includes('line_2') ? 5.4 : 6;
    service.concatAudioFiles = async (_files, output) => { fs.writeFileSync(output, 'joined'); };
    const synthesis = await service.synthesizeVoiceover(lines, { provider: 'edge_tts', voiceId: 'vi-VN-HoaiMyNeural' } as any, path.join(root, 'voice.mp3'));
    assert.deepEqual(spoken, ['Xin chào', 'Đoạn dài']);
    assert.equal(synthesis.alignmentSource, 'mixed');
    assert.equal(synthesis.wordTimestamps[1].startMs, 300);
    assert.equal(synthesis.wordTimestamps[2].startMs, 600);
    const stage4 = service.extractAlignment(synthesis.rawMetadata, 'Xin chào Đoạn dài', lines, 6000, synthesis.wordTimestamps);
    assert.deepEqual(stage4.wordsAlignment, synthesis.wordTimestamps);
    await assert.rejects(() => service.synthesizeVoiceover('⭐', { provider: 'edge_tts' } as any, path.join(root, 'empty.mp3')), /đọc được/);
    console.log('PASS: real-boundary parsing, partial fallback, short audio, per-line timing, sanitized speech, mixed metadata and preserved stage-4 alignment');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
