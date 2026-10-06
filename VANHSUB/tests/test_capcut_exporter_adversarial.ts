/**
 * Challenger M5-1: Adversarial Verification Test Suite
 * Target: main/ai-studio/services/CapCutDraftExporter.ts
 *
 * Exhaustively stress-tests:
 * 1. Microsecond Precision & Floating Point Drift (repeating decimals, float accumulation, integer invariants)
 * 2. Strictly Valid JSON Generation & UTF-8 Round-Trip (special characters, unicode, quotes, escape sequences)
 * 3. Windows Folder Name Sanitization (path traversal, reserved device names, illegal chars, trailing dots/spaces)
 * 4. Referential Integrity Oracle (Segment material_id <-> Materials dictionary 1-to-1 mapping)
 * 5. High-Volume Scalability Stress Harness (200 scenes, 500 subtitles)
 * 6. PipelineSessionState Derivation Stress Harness
 * 7. Calling Conventions & Synchronous vs Asynchronous Equivalence
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  CapCutDraftExporter,
  capCutDraftExporter,
  sanitizeDraftFolderName,
  type CapCutDraftProjectData,
  type CapCutDraftExportOptions,
} from '../main/ai-studio/services/CapCutDraftExporter';
import type { PipelineSessionState } from '../main/ai-studio/types';

async function runAdversarialTests() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ADVERSARIAL STRESS TEST SUITE: CAPCUT DRAFT EXPORTER (CHALLENGER M5-1)           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════╝\n');

  const tmpTestDir = path.join(
    os.tmpdir(),
    `adv_capcut_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  );
  fs.mkdirSync(tmpTestDir, { recursive: true });

  let passedCount = 0;
  let testIndex = 1;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ [ADV-${String(testIndex++).padStart(2, '0')}] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ [ADV-${String(testIndex++).padStart(2, '0')}] ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err.stack) {
        console.error(`     ${err.stack.split('\n').slice(1, 4).join('\n     ')}`);
      }
      throw err;
    }
  }

  try {
    // ==========================================================================
    // Category 1: Folder Name Sanitization & Windows Filesystem Security
    // ==========================================================================
    console.log('--- 🛡️  CATEGORY 1: Windows Folder Name Sanitization & Path Traversal Security ---');

    await test('Folder Sanitization: Path traversal sequences (../, ..\\, etc.) neutralized', () => {
      const traversalInputs = [
        '../../../../etc/passwd',
        '..\\..\\..\\Windows\\System32',
        '..',
        '.',
        '...',
        '....',
        '../',
        '..\\',
        'normal/../../traversal',
        'foo/bar/baz',
        'C:\\Users\\Admin\\Desktop',
      ];

      for (const input of traversalInputs) {
        const sanitized = sanitizeDraftFolderName(input);
        assert(
          !sanitized.includes('/') && !sanitized.includes('\\'),
          `Sanitized name must not contain slashes: "${input}" -> "${sanitized}"`
        );
        assert(
          !sanitized.endsWith('.'),
          `Sanitized name must not end with a dot: "${input}" -> "${sanitized}"`
        );
        assert(
          sanitized.length > 0,
          `Sanitized name must not be empty for input: "${input}"`
        );

        // Verify folder can be safely created on Windows
        const targetPath = path.join(tmpTestDir, `${sanitized}_${Date.now()}`);
        fs.mkdirSync(targetPath, { recursive: true });
        assert(fs.existsSync(targetPath), `Folder must exist on disk: ${targetPath}`);
      }
    });

    await test('Folder Sanitization: Windows reserved device names (CON, PRN, AUX, NUL, COM1, LPT1)', () => {
      const reservedNames = [
        'CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
        'con', 'prn', 'aux', 'nul', 'com1', 'lpt1',
      ];

      for (const name of reservedNames) {
        const sanitized = sanitizeDraftFolderName(name);
        assert(sanitized.length > 0);
        // Exporter appends _<timestamp> when creating the draft folder
        const draftFolderName = `${sanitized}_${Date.now()}`;
        const draftPath = path.join(tmpTestDir, draftFolderName);
        fs.mkdirSync(draftPath, { recursive: true });
        assert(fs.existsSync(draftPath), `Reserved name with timestamp must create valid dir: ${draftPath}`);
      }
    });

    await test('Folder Sanitization: Illegal Windows characters (< > : " / \\ | ? *) and control chars', () => {
      const illegalCharsInput = 'Dự Án: <Super> *Video* ? "Special" / Test \\ 2026 | Pipe \x00\x08\x1F';
      const sanitized = sanitizeDraftFolderName(illegalCharsInput);

      assert(!/[<>:"/\\|?*\x00-\x1F]/.test(sanitized), `Must not contain any illegal chars: "${sanitized}"`);
      assert(sanitized.includes('Dự Án'), 'Must preserve Vietnamese Unicode diacritics');
      assert(sanitized.includes('Super'), 'Must preserve clean alphanumeric segments');

      const diskPath = path.join(tmpTestDir, `${sanitized}_${Date.now()}`);
      fs.mkdirSync(diskPath, { recursive: true });
      assert(fs.existsSync(diskPath));
    });

    await test('Folder Sanitization: Trailing dots and spaces stripped', () => {
      const trailingInputs = [
        'My Draft Project...',
        'My Draft Project   ',
        'My Draft Project. . . . ',
        'SingleDot.',
        'ManyDots..........',
      ];

      for (const input of trailingInputs) {
        const sanitized = sanitizeDraftFolderName(input);
        assert(!/[. ]+$/.test(sanitized), `Must have no trailing dot or space: "${sanitized}"`);
        assert(sanitized.length > 0);
      }
    });

    await test('Folder Sanitization: Empty, whitespace-only, and nullish inputs', () => {
      const emptyInputs = ['', '   ', '\t\n\r', undefined as any, null as any];
      for (const input of emptyInputs) {
        const sanitized = sanitizeDraftFolderName(input);
        assert(
          sanitized.startsWith('draft_'),
          `Empty input must fallback to draft_<timestamp>: "${sanitized}"`
        );
      }
    });

    await test('Folder Sanitization: Multilingual Unicode & Emoji preservation', () => {
      const multilingual = 'Phim Khoa Học 2026 🚀 剪映草稿 ドラフト مشروع كاب كات';
      const sanitized = sanitizeDraftFolderName(multilingual);

      assert(sanitized.includes('Khoa Học'));
      assert(sanitized.includes('剪映草稿'));
      assert(sanitized.includes('ドラフト'));
      assert(sanitized.includes('مشروع'));

      const testDir = path.join(tmpTestDir, `${sanitized}_${Date.now()}`);
      fs.mkdirSync(testDir, { recursive: true });
      assert(fs.existsSync(testDir));
    });

    // ==========================================================================
    // Category 2: Microsecond Precision Arithmetic & Float Rounding
    // ==========================================================================
    console.log('\n--- ⏱️  CATEGORY 2: Microsecond Precision & Floating Point Drift ---');

    await test('Microsecond Precision: Repeating decimal fractions (1/3s, 1/7s, 0.1s + 0.2s)', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_repeating_decimals');
      const repeatingDur1 = 1 / 3; // 0.3333333333333333
      const repeatingDur2 = 2 / 3; // 0.6666666666666666
      const repeatingDur3 = 1 / 7; // 0.14285714285714285

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-repeating-float',
          title: 'Repeating Decimal Test',
          durationSec: 10.0,
          scenes: [
            { id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: repeatingDur1, type: 'video' },
            { id: 'sc-2', path: 'C:/assets/2.mp4', durationSec: repeatingDur2, type: 'video' },
            { id: 'sc-3', path: 'C:/assets/3.mp4', durationSec: repeatingDur3, type: 'video' },
          ],
          subtitles: [
            { text: 'Sub 1', startSec: 0.1 + 0.2, endSec: 1.1 + 0.2 },
          ],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));

      // Total duration exact integer
      assert.strictEqual(Number.isInteger(content.duration), true);
      assert.strictEqual(Number.isInteger(meta.tm_duration), true);
      assert.strictEqual(content.duration, 10_000_000);

      // Verify each clip timerange is an exact integer
      for (const seg of content.tracks[0].segments) {
        assert.strictEqual(Number.isInteger(seg.target_timerange.start), true);
        assert.strictEqual(Number.isInteger(seg.target_timerange.duration), true);
        assert(seg.target_timerange.start >= 0);
        assert(seg.target_timerange.duration > 0);
      }

      // Clip 1: round(1/3 * 1,000,000) = 333333
      assert.strictEqual(content.tracks[0].segments[0].target_timerange.duration, 333_333);
      // Clip 2: round(2/3 * 1,000,000) = 666667
      assert.strictEqual(content.tracks[0].segments[1].target_timerange.duration, 666_667);
      // Clip 3: round(1/7 * 1,000,000) = 142857
      assert.strictEqual(content.tracks[0].segments[2].target_timerange.duration, 142_857);

      // Subtitle: round((0.1+0.2)*1M) = 300000
      const subSeg = content.tracks.find((t: any) => t.type === 'text').segments[0];
      assert.strictEqual(Number.isInteger(subSeg.target_timerange.start), true);
      assert.strictEqual(Number.isInteger(subSeg.target_timerange.duration), true);
      assert.strictEqual(subSeg.target_timerange.start, 300_000);
      assert.strictEqual(subSeg.target_timerange.duration, 1_000_000);
    });

    await test('Timeline Monotonicity: Zero gap and zero overlap across 100 consecutive clips', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_100_scenes_monotonic');
      const sceneCount = 100;
      const scenes = Array.from({ length: sceneCount }, (_, i) => ({
        id: `shot-${i}`,
        path: `C:/assets/clip_${i}.mp4`,
        durationSec: 0.125 + (i % 5) * 0.05, // Varied fractional durations
        type: (i % 2 === 0 ? 'video' : 'image') as 'video' | 'image',
      }));

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-100-scenes',
          title: 'Monotonic Timeline Verification',
          scenes,
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const videoTrack = content.tracks.find((t: any) => t.type === 'video');
      assert.strictEqual(videoTrack.segments.length, 100);

      let accumulatedUs = 0;
      for (let i = 0; i < videoTrack.segments.length; i++) {
        const seg = videoTrack.segments[i];
        assert.strictEqual(
          seg.target_timerange.start,
          accumulatedUs,
          `Segment ${i} start must exactly equal preceding accumulated time`
        );
        assert(Number.isInteger(seg.target_timerange.duration));
        accumulatedUs += seg.target_timerange.duration;
      }

      assert.strictEqual(accumulatedUs, content.duration);
    });

    await test('Sub-Microsecond & Extreme Durations (0.000001s to 36,000s / 10 hours)', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_extreme_duration');
      const tenHoursSec = 36000.0;
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-10hr-extreme',
          title: '10 Hours Film Project',
          durationSec: tenHoursSec,
          scenes: [
            { id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: tenHoursSec, type: 'video' },
          ],
          voiceoverPath: 'C:/assets/10hr_voice.mp3',
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      // 36,000s * 1,000,000 = 36,000,000,000 μs (fits safely in safe integer)
      assert.strictEqual(content.duration, 36_000_000_000);
      assert.strictEqual(Number.isSafeInteger(content.duration), true);
      assert.strictEqual(content.tracks[0].segments[0].target_timerange.duration, 36_000_000_000);
      assert.strictEqual(content.tracks[1].segments[0].target_timerange.duration, 36_000_000_000);
    });

    // ==========================================================================
    // Category 3: JSON Integrity & Character Escaping
    // ==========================================================================
    console.log('\n--- 📄  CATEGORY 3: JSON Integrity, Escapes & UTF-8 Round-Trip ---');

    await test('JSON Parsing: Special characters, quotes, newlines, HTML tags, backslashes', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_json_escaping');
      const adversarialTitle = 'Project "Quotes" & <Tags> \\ Slashes / Newline \n Tab \t Unicode \u2028 \u2029';
      const adversarialSubText = 'Line 1: "Hello"\nLine 2: <script>alert("XSS")</script>\nLine 3: C:\\Users\\Name\\Path';

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-json-stress',
          title: adversarialTitle,
          durationSec: 5.0,
          scenes: [{ id: 'sc-1', path: 'C:\\assets\\path\\with\\slashes.mp4', durationSec: 5.0, type: 'video' }],
          subtitles: [{ text: adversarialSubText, startSec: 0, endSec: 5.0 }],
        },
      });

      // Must parse without error
      const rawContent = fs.readFileSync(result.contentJsonPath, 'utf8');
      const rawMeta = fs.readFileSync(result.metaInfoJsonPath, 'utf8');

      const parsedContent = JSON.parse(rawContent);
      const parsedMeta = JSON.parse(rawMeta);

      assert.strictEqual(parsedMeta.draft_name, adversarialTitle);
      assert.strictEqual(parsedContent.materials.texts[0].content, adversarialSubText);
      assert.strictEqual(parsedContent.tracks[1].segments[0].text, adversarialSubText);

      // UTF-8 binary integrity check
      const bufContent = Buffer.from(rawContent, 'utf8');
      assert.strictEqual(bufContent.toString('utf8'), rawContent);
    });

    // ==========================================================================
    // Category 4: Referential Integrity Oracle
    // ==========================================================================
    console.log('\n--- 🔍  CATEGORY 4: Referential Integrity Oracle (Tracks vs Materials) ---');

    await test('Referential Integrity Oracle: Every segment material_id exists in materials dictionary', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_referential_integrity');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-ref-integrity',
          title: 'Referential Integrity Check',
          durationSec: 15.0,
          scenes: [
            { id: 'sc-1', path: 'C:/assets/clip1.mp4', durationSec: 5.0, type: 'video' },
            { id: 'sc-2', path: 'C:/assets/clip2.png', durationSec: 5.0, type: 'image' },
            { id: 'sc-3', path: 'C:/assets/clip3.mp4', durationSec: 5.0, type: 'video' },
          ],
          voiceoverPath: 'C:/assets/voice.mp3',
          bgmPath: 'C:/assets/bgm.mp3',
          subtitles: [
            { text: 'Phụ đề 1', startSec: 0, endSec: 4.5 },
            { text: 'Phụ đề 2', startSec: 5.0, endSec: 9.5 },
            { text: 'Phụ đề 3', startSec: 10.0, endSec: 14.5 },
          ],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const videoMatIds = new Set(content.materials.videos.map((m: any) => m.id));
      const audioMatIds = new Set(content.materials.audios.map((m: any) => m.id));
      const textMatIds = new Set(content.materials.texts.map((m: any) => m.id));

      for (const track of content.tracks) {
        for (const seg of track.segments) {
          if (track.type === 'video') {
            assert(
              videoMatIds.has(seg.material_id),
              `Video segment ${seg.id} references missing material: ${seg.material_id}`
            );
          } else if (track.type === 'audio') {
            assert(
              audioMatIds.has(seg.material_id),
              `Audio segment ${seg.id} references missing material: ${seg.material_id}`
            );
          } else if (track.type === 'text') {
            assert(
              textMatIds.has(seg.material_id),
              `Text segment ${seg.id} references missing material: ${seg.material_id}`
            );
          }
        }
      }
    });

    // ==========================================================================
    // Category 5: High-Volume Scalability Stress Harness
    // ==========================================================================
    console.log('\n--- ⚡  CATEGORY 5: High-Volume Scalability Stress Harness ---');

    await test('Scalability: 200 scenes and 500 subtitles processed smoothly', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_high_volume_stress');
      const startTime = Date.now();

      const numScenes = 200;
      const numSubs = 500;

      const scenes = Array.from({ length: numScenes }, (_, i) => ({
        id: `shot-${i}`,
        path: `D:/renders/scene_${i}.mp4`,
        durationSec: 2.5,
        type: 'video' as const,
      }));

      const subtitles = Array.from({ length: numSubs }, (_, i) => ({
        text: `Dòng phụ đề thứ ${i + 1} của video dài`,
        startSec: i * 1.0,
        endSec: i * 1.0 + 0.9,
      }));

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-scalability-200-500',
          title: 'High-Volume Production Project',
          scenes,
          subtitles,
          voiceoverPath: 'D:/audio/voiceover_master.wav',
          bgmPath: 'D:/audio/bgm_soundtrack.wav',
        },
      });

      const elapsedMs = Date.now() - startTime;
      console.log(`     High-volume export finished in ${elapsedMs}ms`);

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.tracks.length, 4);
      assert.strictEqual(result.tracksSummary.videoClipsCount, 200);
      assert.strictEqual(result.tracksSummary.subtitlesCount, 500);
      assert.strictEqual(result.tracksSummary.voiceoverTracksCount, 1);
      assert.strictEqual(result.tracksSummary.bgmTracksCount, 1);
      assert(elapsedMs < 3000, `Export must complete under 3 seconds (actual: ${elapsedMs}ms)`);
    });

    // ==========================================================================
    // Category 6: Edge Cases, Defaults & Boundary Conditions
    // ==========================================================================
    console.log('\n--- 🔬  CATEGORY 6: Edge Cases & Boundary Conditions ---');

    await test('Edge Case: Zero scenes and zero subtitles fallback', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_zero_scenes');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-zero',
          title: 'Empty Project',
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.duration, 0);
      assert.strictEqual(content.tracks[0].segments.length, 0);
      assert.strictEqual(result.tracksSummary.videoClipsCount, 0);
      assert.strictEqual(result.tracksSummary.subtitlesCount, 0);
    });

    await test('Edge Case: SessionState resolution with scriptLines when scenes missing', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_session_scriptlines');
      const sessionWithoutScenes: PipelineSessionState = {
        sessionId: 'session-only-scriptlines',
        topic: 'Chỉ có kịch bản',
        currentStage: 3,
        stageName: 'storyboard',
        status: 'running',
        progress: 40,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: {},
        artifacts: {
          blueprint: {
            topic: 'Chỉ có kịch bản',
            title: 'Kịch Bản Phim Ngắn',
            narrativeAngle: 'Hài hước',
            hookConcept: 'Bất ngờ',
            estimatedDurationSec: 12.0,
          },
          scriptLines: [
            { id: 'line-0', index: 0, text: 'Câu mở đầu', startMs: 0, endMs: 3000, assetPath: 'C:/assets/0.mp4', assetType: 'video' },
            { id: 'line-1', index: 1, text: 'Câu thân bài', startMs: 3000, endMs: 7000, assetPath: 'C:/assets/1.png', assetType: 'image' },
            { id: 'line-2', index: 2, text: 'Câu kết luận', startMs: 7000, endMs: 12000, assetPath: 'C:/assets/2.mp4', assetType: 'video' },
          ],
        },
      };

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        sessionState: sessionWithoutScenes,
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));

      assert.strictEqual(meta.draft_name, 'Kịch Bản Phim Ngắn');
      assert.strictEqual(content.tracks.length, 2, 'Must have Video track and Subtitle track');
      assert.strictEqual(content.tracks[0].segments.length, 3);
      assert.strictEqual(content.tracks[1].segments.length, 3);
    });

    await test('Contract Invariance: Dual summary keys (trackSummary and tracksSummary) are identical', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_dual_summary');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-dual-contract',
          durationSec: 4.0,
          scenes: [{ id: 'sc-1', path: 'C:/1.mp4', durationSec: 4.0, type: 'video' }],
        },
      });

      assert.deepStrictEqual(result.tracksSummary, result.trackSummary);
      assert.strictEqual(result.tracksSummary.videoClipsCount, 1);
      assert.strictEqual(result.tracksSummary.totalDurationUs, 4_000_000);
    });

    await test('Execution Parity: Synchronous exportToCapCutDraftSync matches async exportToCapCutDraft', async () => {
      const asyncDir = path.join(tmpTestDir, 'adv_parity_async');
      const syncDir = path.join(tmpTestDir, 'adv_parity_sync');

      const projectData: CapCutDraftProjectData = {
        id: 'draft-parity-test',
        title: 'Async vs Sync Parity',
        durationSec: 6.0,
        scenes: [
          { id: 's1', path: 'C:/a.mp4', durationSec: 3.0, type: 'video' },
          { id: 's2', path: 'C:/b.mp4', durationSec: 3.0, type: 'video' },
        ],
        subtitles: [{ text: 'Hello', startSec: 0, endSec: 2.0 }],
        voiceoverPath: 'C:/voice.mp3',
      };

      const asyncRes = await CapCutDraftExporter.exportToCapCutDraft({ targetDir: asyncDir, projectData });
      const syncRes = CapCutDraftExporter.exportToCapCutDraftSync(syncDir, projectData);

      const asyncContent = JSON.parse(fs.readFileSync(asyncRes.contentJsonPath, 'utf8'));
      const syncContent = JSON.parse(fs.readFileSync(syncRes.contentJsonPath, 'utf8'));

      assert.deepStrictEqual(asyncContent, syncContent);
      assert.deepStrictEqual(asyncRes.tracksSummary, syncRes.tracksSummary);
    });

  } finally {
    // Cleanup temporary workspace directory
    try {
      if (fs.existsSync(tmpTestDir)) {
        fs.rmSync(tmpTestDir, { recursive: true, force: true });
      }
    } catch {}
  }

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${passedCount} ADVERSARIAL STRESS TESTS PASSED (100% PASS RATE)!`);
  console.log('================================================================================');
}

runAdversarialTests().catch((err) => {
  console.error('Fatal error executing Adversarial Stress Test Suite:', err);
  process.exit(1);
});
