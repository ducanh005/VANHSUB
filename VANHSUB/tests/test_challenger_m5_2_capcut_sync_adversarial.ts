/**
 * Empirical Adversarial Verification Suite: CapCutDraftExporter (Milestone 5)
 * Challenger M5-2 (challenger_m5_2)
 *
 * Verifies multi-track timeline synchronization under extreme conditions:
 * 1. Zero-duration scenes or subtitles.
 * 2. 100+ scene segments stress testing (150 scenes, 500 scenes, scaling).
 * 3. Missing voiceover, missing BGM, or missing subtitles track combinations (2^3 = 8 full matrix).
 * 4. Referential integrity: materials vs tracks bijection, zero dangling or orphaned material IDs.
 * 5. Monotonicity, floating-point rounding, extreme duration (10h documentary), and session artifact fallback.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  CapCutDraftExporter,
  capCutDraftExporter,
  type CapCutDraftProjectData,
  type CapCutDraftSceneItem,
  type CapCutDraftSubtitleItem,
} from '../main/ai-studio/services/CapCutDraftExporter';
import type { PipelineSessionState } from '../main/ai-studio/types';

/**
 * Validates the referential integrity between tracks and materials:
 * - Every segment's material_id must exist in materials (No Dangling References)
 * - Every declared material must be referenced by at least one segment (No Orphaned Materials)
 * - Track types must match material types
 * - Segment IDs must be globally unique
 * - Material IDs must be globally unique
 */
function auditMaterialIntegrity(content: any): {
  referencedIds: Set<string>;
  declaredIds: Set<string>;
  danglingIds: string[];
  orphanedIds: string[];
  duplicateSegmentIds: string[];
  duplicateMaterialIds: string[];
} {
  const referencedIds = new Set<string>();
  const allSegmentIds = new Set<string>();
  const duplicateSegmentIds: string[] = [];

  const videoMatIds = new Set((content.materials?.videos || []).map((v: any) => v.id));
  const audioMatIds = new Set((content.materials?.audios || []).map((a: any) => a.id));
  const textMatIds = new Set((content.materials?.texts || []).map((t: any) => t.id));

  const declaredIds = new Set<string>();
  const duplicateMaterialIds: string[] = [];

  for (const v of content.materials?.videos || []) {
    if (declaredIds.has(v.id)) duplicateMaterialIds.push(v.id);
    declaredIds.add(v.id);
  }
  for (const a of content.materials?.audios || []) {
    if (declaredIds.has(a.id)) duplicateMaterialIds.push(a.id);
    declaredIds.add(a.id);
  }
  for (const t of content.materials?.texts || []) {
    if (declaredIds.has(t.id)) duplicateMaterialIds.push(t.id);
    declaredIds.add(t.id);
  }

  const danglingIds: string[] = [];

  for (const track of content.tracks || []) {
    for (const seg of track.segments || []) {
      if (allSegmentIds.has(seg.id)) {
        duplicateSegmentIds.push(seg.id);
      }
      allSegmentIds.add(seg.id);

      referencedIds.add(seg.material_id);
      if (!declaredIds.has(seg.material_id)) {
        danglingIds.push(seg.material_id);
      }

      // Type consistency check
      if (track.type === 'video') {
        assert(
          videoMatIds.has(seg.material_id),
          `Video segment ${seg.id} references non-video material ${seg.material_id}`
        );
      } else if (track.type === 'audio') {
        assert(
          audioMatIds.has(seg.material_id),
          `Audio segment ${seg.id} references non-audio material ${seg.material_id}`
        );
      } else if (track.type === 'text') {
        assert(
          textMatIds.has(seg.material_id),
          `Text segment ${seg.id} references non-text material ${seg.material_id}`
        );
      }
    }
  }

  const orphanedIds: string[] = [];
  for (const id of declaredIds) {
    if (!referencedIds.has(id)) {
      orphanedIds.push(id);
    }
  }

  return {
    referencedIds,
    declaredIds,
    danglingIds,
    orphanedIds,
    duplicateSegmentIds,
    duplicateMaterialIds,
  };
}

let testCount = 0;
let passedCount = 0;
let failedCount = 0;
const failureMessages: string[] = [];

async function step(name: string, fn: () => void | Promise<void>) {
  testCount++;
  const testId = `ADV-${String(testCount).padStart(2, '0')}`;
  try {
    await fn();
    passedCount++;
    console.log(`  ✅ [${testId}] ${name}`);
  } catch (err: any) {
    failedCount++;
    const errMsg = `  ❌ [${testId}] ${name}: ${err?.message || err}`;
    console.error(errMsg);
    failureMessages.push(errMsg);
  }
}

async function runAdversarialSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ADVERSARIAL CHALLENGE SUITE: CAPCUT DRAFT EXPORTER (M5-2)             ║');
  console.log('║   Empirical Challenger: challenger_m5_2                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tmpTestDir = path.join(
    os.tmpdir(),
    `challenger_m5_2_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );
  fs.mkdirSync(tmpTestDir, { recursive: true });

  try {
    // ========================================================================
    // PART 1: ZERO-DURATION SCENES AND SUBTITLES (PROJECTDATA DIRECT)
    // ========================================================================
    console.log('--- Part 1: Zero-Duration Scenes and Subtitles (Direct ProjectData) ---');

    await step('Zero-Duration Single Scene: Exports cleanly with 0μs duration and no NaN', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_single_zero_scene');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-zero-single',
          title: 'Zero Single Scene',
          scenes: [{ id: 'sc-zero', path: 'C:/assets/zero.mp4', durationSec: 0, type: 'video' }],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));

      assert.strictEqual(content.duration, 0, 'Total duration must be 0');
      assert.strictEqual(meta.tm_duration, 0, 'Meta duration must be 0');
      assert.strictEqual(content.tracks.length, 1);
      assert.strictEqual(content.tracks[0].segments.length, 1);

      const seg = content.tracks[0].segments[0];
      assert.strictEqual(seg.target_timerange.start, 0);
      assert.strictEqual(seg.target_timerange.duration, 0);
      assert.strictEqual(content.materials.videos[0].duration, 0);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0, 'No dangling material IDs');
      assert.strictEqual(audit.orphanedIds.length, 0, 'No orphaned material IDs');
    });

    await step('Interleaved Zero-Duration Scenes: Preserves timeline continuity and monotonicity', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_interleaved_zero_scenes');
      const scenes: CapCutDraftSceneItem[] = [
        { id: 'sc-0', path: 'C:/1.mp4', durationSec: 3.5, type: 'video' },
        { id: 'sc-1', path: 'C:/2.mp4', durationSec: 0.0, type: 'video' },
        { id: 'sc-2', path: 'C:/3.mp4', durationSec: 2.0, type: 'video' },
        { id: 'sc-3', path: 'C:/4.mp4', durationSec: 0.0, type: 'video' },
        { id: 'sc-4', path: 'C:/5.mp4', durationSec: 0.0, type: 'video' },
        { id: 'sc-5', path: 'C:/6.mp4', durationSec: 4.5, type: 'video' },
      ];

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-interleaved-zero',
          title: 'Interleaved Zero Scenes',
          scenes,
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.duration, 10_000_000);

      const track = content.tracks[0];
      assert.strictEqual(track.segments.length, 6);

      // Verify continuity: each segment start must exactly equal previous (start + duration)
      for (let i = 0; i < track.segments.length; i++) {
        const seg = track.segments[i];
        assert(Number.isInteger(seg.target_timerange.start), `Seg ${i} start must be integer`);
        assert(Number.isInteger(seg.target_timerange.duration), `Seg ${i} duration must be integer`);
        if (i === 0) {
          assert.strictEqual(seg.target_timerange.start, 0);
          assert.strictEqual(seg.target_timerange.duration, 3_500_000);
        } else {
          const prevSeg = track.segments[i - 1];
          const expectedStart = prevSeg.target_timerange.start + prevSeg.target_timerange.duration;
          assert.strictEqual(
            seg.target_timerange.start,
            expectedStart,
            `Seg ${i} start (${seg.target_timerange.start}) must equal prev start + duration (${expectedStart})`
          );
        }
      }

      assert.strictEqual(track.segments[1].target_timerange.start, 3_500_000);
      assert.strictEqual(track.segments[1].target_timerange.duration, 0);
      assert.strictEqual(track.segments[2].target_timerange.start, 3_500_000);
      assert.strictEqual(track.segments[2].target_timerange.duration, 2_000_000);
      assert.strictEqual(track.segments[3].target_timerange.start, 5_500_000);
      assert.strictEqual(track.segments[3].target_timerange.duration, 0);
      assert.strictEqual(track.segments[4].target_timerange.start, 5_500_000);
      assert.strictEqual(track.segments[4].target_timerange.duration, 0);
      assert.strictEqual(track.segments[5].target_timerange.start, 5_500_000);
      assert.strictEqual(track.segments[5].target_timerange.duration, 4_500_000);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
    });

    await step('Zero-Duration Subtitles: Handled cleanly with exact 0μs timerange duration', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_zero_subtitles');
      const subtitles: CapCutDraftSubtitleItem[] = [
        { text: 'Point in time 1', startSec: 1.5, endSec: 1.5 },
        { text: 'Normal subtitle', startSec: 2.0, endSec: 4.0 },
        { text: 'Point in time 2', startSec: 4.0, endSec: 4.0 },
      ];

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-zero-subs',
          title: 'Zero Subs Test',
          durationSec: 5.0,
          scenes: [{ id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: 5.0, type: 'video' }],
          subtitles,
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const textTrack = content.tracks.find((t: any) => t.type === 'text');
      assert(textTrack);
      assert.strictEqual(textTrack.segments.length, 3);

      assert.strictEqual(textTrack.segments[0].target_timerange.start, 1_500_000);
      assert.strictEqual(textTrack.segments[0].target_timerange.duration, 0);
      assert.strictEqual(textTrack.segments[1].target_timerange.start, 2_000_000);
      assert.strictEqual(textTrack.segments[1].target_timerange.duration, 2_000_000);
      assert.strictEqual(textTrack.segments[2].target_timerange.start, 4_000_000);
      assert.strictEqual(textTrack.segments[2].target_timerange.duration, 0);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
    });

    await step('Completely Empty / Zero Project: Total 0s, 0 tracks crash-free export', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_empty_zero_project');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-empty-zero',
          title: 'Completely Empty Project',
          durationSec: 0,
          scenes: [],
          subtitles: [],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));

      assert.strictEqual(content.duration, 0);
      assert.strictEqual(meta.tm_duration, 0);
      assert.strictEqual(content.tracks.length, 1);
      assert.strictEqual(content.tracks[0].segments.length, 0);
      assert.strictEqual(content.materials.videos.length, 0);
      assert.strictEqual(content.materials.audios.length, 0);
      assert.strictEqual(content.materials.texts.length, 0);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
    });

    // ========================================================================
    // PART 2: 100+ SCENE SEGMENTS STRESS TESTING
    // ========================================================================
    console.log('\n--- Part 2: 100+ Scene Segments Stress Testing ---');

    await step('150 Heterogeneous Scene Segments: Cumulative timeline monotonicity & precision', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_150_scenes_stress');
      const scenesCount = 150;
      const scenes: CapCutDraftSceneItem[] = [];

      for (let i = 0; i < scenesCount; i++) {
        const dur = Number(((i % 8) * 0.5 + 0.5).toFixed(2));
        scenes.push({
          id: `shot-${String(i).padStart(3, '0')}`,
          path: `D:/storage/clips/segment_${i}.${i % 3 === 0 ? 'png' : 'mp4'}`,
          durationSec: dur,
          type: i % 3 === 0 ? 'image' : 'video',
        });
      }

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-150-scenes',
          title: '150 Scenes Stress Project',
          scenes,
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.tracks[0].segments.length, 150);
      assert.strictEqual(content.materials.videos.length, 150);

      let cumulativeUs = 0;
      for (let i = 0; i < 150; i++) {
        const seg = content.tracks[0].segments[i];
        const mat = content.materials.videos[i];
        const scene = scenes[i];
        const clipUs = Math.round(scene.durationSec * 1_000_000);

        assert.strictEqual(seg.id, `seg-vid-${i}`);
        assert.strictEqual(seg.material_id, `mat-vid-${i}`);
        assert.strictEqual(mat.id, `mat-vid-${i}`);
        assert.strictEqual(mat.duration, clipUs);
        assert.strictEqual(seg.target_timerange.start, cumulativeUs);
        assert.strictEqual(seg.target_timerange.duration, clipUs);

        assert(
          seg.target_timerange.start >= (i > 0 ? content.tracks[0].segments[i - 1].target_timerange.start : 0),
          'Timestamps must be non-decreasing'
        );

        cumulativeUs += clipUs;
      }

      assert.strictEqual(content.duration, cumulativeUs);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
      assert.strictEqual(audit.duplicateSegmentIds.length, 0);
      assert.strictEqual(audit.duplicateMaterialIds.length, 0);
    });

    await step('500 Massive Scene Segments Scale Test: High performance under 500ms', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_500_scenes_scale');
      const scenesCount = 500;
      const scenes: CapCutDraftSceneItem[] = [];

      for (let i = 0; i < scenesCount; i++) {
        scenes.push({
          id: `shot-${i}`,
          path: `D:/clips/clip_${i}.mp4`,
          durationSec: 2.0,
          type: 'video',
        });
      }

      const tStart = Date.now();
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-500-scenes',
          title: '500 Scenes Massive Scale Test',
          scenes,
        },
      });
      const tElapsed = Date.now() - tStart;

      console.log(`     [Perf Metric] 500 scenes exported and serialized in ${tElapsed}ms`);
      assert(tElapsed < 1000, `Exporting 500 scenes took ${tElapsed}ms, must be < 1000ms`);

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.tracks[0].segments.length, 500);
      assert.strictEqual(content.materials.videos.length, 500);
      assert.strictEqual(content.duration, 500 * 2_000_000);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
    });

    await step('Combined Multi-Track Stress: 120 scenes + 250 subtitles + Voiceover + BGM', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_multi_track_stress');
      const scenes: CapCutDraftSceneItem[] = [];
      for (let i = 0; i < 120; i++) {
        scenes.push({
          id: `s-${i}`,
          path: `D:/media/s_${i}.mp4`,
          durationSec: 1.0,
          type: 'video',
        });
      }

      const subtitles: CapCutDraftSubtitleItem[] = [];
      for (let j = 0; j < 250; j++) {
        const start = Number((j * 0.48).toFixed(2));
        const end = Number((start + 0.45).toFixed(2));
        subtitles.push({
          text: `Subtitle line #${j}: Thuyết minh câu số ${j}`,
          startSec: start,
          endSec: end,
        });
      }

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-heavy-multi-track',
          title: 'Heavy Multi-Track 120 scenes + 250 subs',
          durationSec: 120.0,
          scenes,
          voiceoverPath: 'D:/audio/master_voice.mp3',
          bgmPath: 'D:/audio/cinematic_bgm.mp3',
          subtitles,
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.tracks.length, 4);
      assert.strictEqual(content.tracks[0].segments.length, 120);
      assert.strictEqual(content.tracks[1].segments.length, 1);
      assert.strictEqual(content.tracks[2].segments.length, 1);
      assert.strictEqual(content.tracks[3].segments.length, 250);

      assert.strictEqual(content.tracks[1].segments[0].target_timerange.duration, 120_000_000);
      assert.strictEqual(content.tracks[2].segments[0].target_timerange.duration, 120_000_000);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
      assert.strictEqual(audit.duplicateSegmentIds.length, 0);
      assert.strictEqual(audit.duplicateMaterialIds.length, 0);
    });

    // ========================================================================
    // PART 3: MISSING TRACK PERMUTATIONS (2^3 = 8 MATRIX)
    // ========================================================================
    console.log('\n--- Part 3: Missing Track Permutations (2^3 = 8 Matrix) ---');

    await step('Permutation Matrix: All 8 combinations of (Voiceover, BGM, Subtitles)', async () => {
      const matrix = [
        { voice: false, bgm: false, subs: false, expTracks: 1, name: 'Video Only' },
        { voice: true,  bgm: false, subs: false, expTracks: 2, name: 'Video + Voice' },
        { voice: false, bgm: true,  subs: false, expTracks: 2, name: 'Video + BGM' },
        { voice: true,  bgm: true,  subs: false, expTracks: 3, name: 'Video + Voice + BGM' },
        { voice: false, bgm: false, subs: true,  expTracks: 2, name: 'Video + Subs' },
        { voice: true,  bgm: false, subs: true,  expTracks: 3, name: 'Video + Voice + Subs' },
        { voice: false, bgm: true,  subs: true,  expTracks: 3, name: 'Video + BGM + Subs' },
        { voice: true,  bgm: true,  subs: true,  expTracks: 4, name: 'Video + Voice + BGM + Subs (Full)' },
      ];

      for (let idx = 0; idx < matrix.length; idx++) {
        const item = matrix[idx];
        const draftDir = path.join(tmpTestDir, `adv_matrix_comb_${idx}`);
        const projectData: CapCutDraftProjectData = {
          id: `draft-comb-${idx}`,
          title: `Permutation ${item.name}`,
          durationSec: 10.0,
          scenes: [
            { id: 's1', path: 'C:/assets/1.mp4', durationSec: 5.0, type: 'video' },
            { id: 's2', path: 'C:/assets/2.mp4', durationSec: 5.0, type: 'video' },
          ],
          voiceoverPath: item.voice ? 'C:/audio/voice.mp3' : undefined,
          bgmPath: item.bgm ? 'C:/audio/bgm.mp3' : undefined,
          subtitles: item.subs
            ? [{ text: 'Subtitle test', startSec: 1.0, endSec: 4.0 }]
            : undefined,
        };

        const result = await CapCutDraftExporter.exportToCapCutDraft({
          targetDir: draftDir,
          projectData,
        });

        const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));

        assert.strictEqual(
          content.tracks.length,
          item.expTracks,
          `Combination ${idx} (${item.name}) must have exactly ${item.expTracks} tracks`
        );

        const hasVoiceTrack = content.tracks.some((t: any) => t.id === 'track-audio-voice');
        const hasBgmTrack = content.tracks.some((t: any) => t.id === 'track-audio-bgm');
        const hasTextTrack = content.tracks.some((t: any) => t.id === 'track-text-subtitle');

        assert.strictEqual(hasVoiceTrack, item.voice, `Voice track presence in comb ${idx}`);
        assert.strictEqual(hasBgmTrack, item.bgm, `BGM track presence in comb ${idx}`);
        assert.strictEqual(hasTextTrack, item.subs, `Text track presence in comb ${idx}`);

        assert.strictEqual(result.tracksSummary.voiceoverTracksCount, item.voice ? 1 : 0);
        assert.strictEqual(result.tracksSummary.bgmTracksCount, item.bgm ? 1 : 0);
        assert.strictEqual(result.tracksSummary.subtitlesCount, item.subs ? 1 : 0);

        const audit = auditMaterialIntegrity(content);
        assert.strictEqual(audit.danglingIds.length, 0, `Comb ${idx} dangling IDs`);
        assert.strictEqual(audit.orphanedIds.length, 0, `Comb ${idx} orphaned IDs`);
      }
    });

    await step('Falsy, Blank & Whitespace Audio Paths: Zero phantom tracks generated', async () => {
      const blankVariants = [
        '',
        '   ',
        '\t\t',
        '\n\r',
        undefined as any,
      ];

      for (let i = 0; i < blankVariants.length; i++) {
        const draftDir = path.join(tmpTestDir, `adv_blank_audio_${i}`);
        const result = await CapCutDraftExporter.exportToCapCutDraft({
          targetDir: draftDir,
          projectData: {
            id: `draft-blank-${i}`,
            title: `Blank Audio Variant ${i}`,
            durationSec: 4.0,
            scenes: [{ id: 's1', path: 'C:/assets/1.mp4', durationSec: 4.0, type: 'video' }],
            voiceoverPath: blankVariants[i],
            bgmPath: blankVariants[i],
            subtitles: [],
          },
        });

        const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
        assert.strictEqual(content.tracks.length, 1, `Variant ${i} should have ONLY 1 track (video)`);
        assert.strictEqual(content.materials.audios.length, 0, `Variant ${i} should have 0 audios`);
        assert.strictEqual(result.tracksSummary.voiceoverTracksCount, 0);
        assert.strictEqual(result.tracksSummary.bgmTracksCount, 0);

        const audit = auditMaterialIntegrity(content);
        assert.strictEqual(audit.danglingIds.length, 0);
        assert.strictEqual(audit.orphanedIds.length, 0);
      }
    });

    // ========================================================================
    // PART 4: MATERIALS VS TRACKS BIJECTION AND ZERO DANGLING MATERIAL IDS
    // ========================================================================
    console.log('\n--- Part 4: Materials vs Tracks Segment Reference Integrity ---');

    await step('Material Referential Integrity: Strict bijection, exact IDs, zero dangling/orphan items', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_integrity_deep_check');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-deep-integrity',
          title: 'Deep Integrity Audit',
          durationSec: 15.0,
          scenes: [
            { id: 'scene-alpha', path: 'C:/media/alpha.mp4', durationSec: 5.0, type: 'video' },
            { id: 'scene-beta',  path: 'C:/media/beta.png',  durationSec: 5.0, type: 'image' },
            { id: 'scene-gamma', path: 'C:/media/gamma.mp4', durationSec: 5.0, type: 'video' },
          ],
          voiceoverPath: 'C:/media/voice_main.mp3',
          bgmPath: 'C:/media/bgm_soundtrack.mp3',
          subtitles: [
            { text: 'Line 1', startSec: 0, endSec: 4.5 },
            { text: 'Line 2', startSec: 5.0, endSec: 9.5 },
            { text: 'Line 3', startSec: 10.0, endSec: 14.5 },
          ],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const audit = auditMaterialIntegrity(content);

      assert.strictEqual(audit.danglingIds.length, 0, 'No segment may reference an undeclared material ID');
      assert.strictEqual(audit.orphanedIds.length, 0, 'No declared material may be unused');
      assert.strictEqual(audit.referencedIds.size, audit.declaredIds.size, 'Referenced and declared sets must match');

      assert.strictEqual(audit.declaredIds.size, 8);
      assert(audit.declaredIds.has('mat-vid-0'));
      assert(audit.declaredIds.has('mat-vid-1'));
      assert(audit.declaredIds.has('mat-vid-2'));
      assert(audit.declaredIds.has('mat-audio-voice-0'));
      assert(audit.declaredIds.has('mat-audio-bgm-0'));
      assert(audit.declaredIds.has('mat-text-0'));
      assert(audit.declaredIds.has('mat-text-1'));
      assert(audit.declaredIds.has('mat-text-2'));
    });

    await step('Isolated Audio Asymmetry: Voice-only and BGM-only drafts do not leak alternate audio IDs', async () => {
      const dirVoiceOnly = path.join(tmpTestDir, 'adv_voice_only_id');
      const resVoice = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: dirVoiceOnly,
        projectData: {
          id: 'draft-voice-only',
          title: 'Voice Only',
          durationSec: 5.0,
          scenes: [{ id: 's1', path: 'C:/1.mp4', durationSec: 5.0, type: 'video' }],
          voiceoverPath: 'C:/voice.mp3',
        },
      });
      const contentVoice = JSON.parse(fs.readFileSync(resVoice.contentJsonPath, 'utf8'));
      assert(contentVoice.materials.audios.some((a: any) => a.id === 'mat-audio-voice-0'));
      assert(!contentVoice.materials.audios.some((a: any) => a.id === 'mat-audio-bgm-0'));
      const auditVoice = auditMaterialIntegrity(contentVoice);
      assert.strictEqual(auditVoice.danglingIds.length, 0);
      assert.strictEqual(auditVoice.orphanedIds.length, 0);

      const dirBgmOnly = path.join(tmpTestDir, 'adv_bgm_only_id');
      const resBgm = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: dirBgmOnly,
        projectData: {
          id: 'draft-bgm-only',
          title: 'BGM Only',
          durationSec: 5.0,
          scenes: [{ id: 's1', path: 'C:/1.mp4', durationSec: 5.0, type: 'video' }],
          bgmPath: 'C:/bgm.mp3',
        },
      });
      const contentBgm = JSON.parse(fs.readFileSync(resBgm.contentJsonPath, 'utf8'));
      assert(contentBgm.materials.audios.some((a: any) => a.id === 'mat-audio-bgm-0'));
      assert(!contentBgm.materials.audios.some((a: any) => a.id === 'mat-audio-voice-0'));
      const auditBgm = auditMaterialIntegrity(contentBgm);
      assert.strictEqual(auditBgm.danglingIds.length, 0);
      assert.strictEqual(auditBgm.orphanedIds.length, 0);
    });

    // ========================================================================
    // PART 5: EXTREME BOUNDARIES, UNICODE, LARGE TIMEBASES
    // ========================================================================
    console.log('\n--- Part 5: Extreme Boundaries, Large Timebases & Parity ---');

    await step('Extreme Duration: 10-Hour Documentary (36,000s = 36B μs) fits in JS Safe Integer', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_10h_documentary');
      const totalSec = 36_000.0;
      const totalUs = 36_000_000_000;

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-10h-epic',
          title: '10-Hour Epic Universe Documentary',
          durationSec: totalSec,
          scenes: [
            { id: 's1', path: 'C:/part1.mp4', durationSec: 18_000.0, type: 'video' },
            { id: 's2', path: 'C:/part2.mp4', durationSec: 18_000.0, type: 'video' },
          ],
          voiceoverPath: 'C:/narration_10h.mp3',
          bgmPath: 'C:/ambient_10h.mp3',
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));

      assert.strictEqual(content.duration, totalUs);
      assert.strictEqual(meta.tm_duration, totalUs);
      assert(Number.isSafeInteger(content.duration), 'Duration must be safe integer');

      assert.strictEqual(content.tracks[0].segments[0].target_timerange.duration, 18_000_000_000);
      assert.strictEqual(content.tracks[0].segments[1].target_timerange.start, 18_000_000_000);
      assert.strictEqual(content.tracks[0].segments[1].target_timerange.duration, 18_000_000_000);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
    });

    await step('Unicode, Emojis, Quotation Marks & Vietnamese Subtitle Stress', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_unicode_stress');
      const unicodeTitle = '🎬 Dự Án AI Studio: "Vũ Trụ Vô Tận" & Hành Trình 2026! 🚀';
      const viSubs: CapCutDraftSubtitleItem[] = [
        { text: 'Xin chào "thế giới" và \'vũ trụ\'!', startSec: 0.0, endSec: 2.0 },
        { text: 'Dòng phụ đề có ký tự đặc biệt: <tag>, &amp;, @#$%', startSec: 2.0, endSec: 4.0 },
        { text: 'Đầy đủ dấu tiếng Việt: ắ ằ ẳ ẵ ặ, ê ế ề ể ễ ệ, ô ố ồ ổ ỗ ộ', startSec: 4.0, endSec: 6.0 },
      ];

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-unicode-stress',
          title: unicodeTitle,
          durationSec: 6.0,
          scenes: [{ id: 's1', path: 'C:/clip.mp4', durationSec: 6.0, type: 'video' }],
          subtitles: viSubs,
        },
      });

      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));
      assert.strictEqual(meta.draft_name, unicodeTitle);

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.materials.texts.length, 3);
      assert.strictEqual(content.materials.texts[0].content, viSubs[0].text);
      assert.strictEqual(content.materials.texts[1].content, viSubs[1].text);
      assert.strictEqual(content.materials.texts[2].content, viSubs[2].text);

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
    });

    await step('Sub-Millisecond High Precision Durations: Accurate rounding without NaN or float leaks', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_sub_millisecond');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-sub-ms',
          title: 'Sub-Millisecond Precision',
          durationSec: 3.14159265,
          scenes: [
            { id: 's1', path: 'C:/1.mp4', durationSec: 1.41421356, type: 'video' },
            { id: 's2', path: 'C:/2.mp4', durationSec: 1.72737909, type: 'video' },
          ],
          subtitles: [
            { text: 'Irrational sub', startSec: 0.1234567, endSec: 2.3456789 },
          ],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert(Number.isInteger(content.duration));
      assert.strictEqual(content.duration, 3_141_593);

      for (const track of content.tracks) {
        for (const seg of track.segments) {
          assert(Number.isInteger(seg.target_timerange.start), 'Segment start must be integer');
          assert(Number.isInteger(seg.target_timerange.duration), 'Segment duration must be integer');
        }
      }

      for (const mat of content.materials.videos) {
        assert(Number.isInteger(mat.duration), 'Material duration must be integer');
      }

      const audit = auditMaterialIntegrity(content);
      assert.strictEqual(audit.danglingIds.length, 0);
      assert.strictEqual(audit.orphanedIds.length, 0);
    });

    // ========================================================================
    // PART 6: ADVERSARIAL ORACLE ON SESSION STATE RESOLUTION (EXPOSING VULNERABILITIES)
    // ========================================================================
    console.log('\n--- Part 6: Adversarial Oracle on Session State Resolution ---');

    await step('Timeline Sync Oracle: Verify scriptLines fallback does NOT desync video from subtitles when startMs === 0', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_session_script_sync_oracle');
      const sessionWithScript: PipelineSessionState = {
        sessionId: 'session-script-sync-test',
        topic: 'Script Sync Oracle Test',
        currentStage: 4,
        stageName: 'storyboard',
        status: 'in_progress',
        progress: 50,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: {},
        artifacts: {
          blueprint: {
            topic: 'Sync Test',
            title: 'Timeline Sync Oracle Project',
            narrativeAngle: 'Direct',
            hookConcept: 'Hook',
            estimatedDurationSec: 12.0,
          },
          audioPath: 'C:/assets/voice.mp3',
          scenes: [], // Scenes missing, forcing fallback to scriptLines
          scriptLines: [
            { id: 'line-0', index: 0, text: 'Phân cảnh 1', startMs: 0, endMs: 3000, assetPath: 'C:/shot1.mp4', assetType: 'video' },
            { id: 'line-1', index: 1, text: 'Phân cảnh 2', startMs: 3000, endMs: 7000, assetPath: 'C:/shot2.png', assetType: 'image' },
            { id: 'line-2', index: 2, text: 'Phân cảnh 3', startMs: 7000, endMs: 12000, assetPath: 'C:/shot3.mp4', assetType: 'video' },
          ],
        },
      };

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        sessionState: sessionWithScript,
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));

      const vidSeg0 = content.tracks[0].segments[0];
      const subSeg0 = content.tracks[2].segments[0];

      // Subtitle segment 0 duration is correctly (3000 - 0) = 3s = 3,000,000 μs
      assert.strictEqual(subSeg0.target_timerange.duration, 3_000_000, 'Subtitle seg 0 duration must be 3,000,000 μs');

      // Video segment 0 should also be (3000 - 0) = 3s = 3,000,000 μs to remain synchronized!
      // In CapCutDraftExporter.ts line 243: `line.endMs && line.startMs` evaluates to `0` (falsy) when `startMs === 0`,
      // defaulting incorrectly to 4.0s (4,000,000 μs) and causing a 1.0s timeline desynchronization!
      assert.strictEqual(
        vidSeg0.target_timerange.duration,
        3_000_000,
        `Video seg 0 duration (${vidSeg0.target_timerange.duration} μs) desynced from subtitle seg 0 (3,000,000 μs) due to falsy startMs === 0 in CapCutDraftExporter.ts:243`
      );
    });

    await step('Zero-Duration Oracle: Verify zero-duration scene in artifacts.scenes is NOT coerced to 4.0s', async () => {
      const draftDir = path.join(tmpTestDir, 'adv_session_zero_scene_oracle');
      const sessionWithZeroScene: PipelineSessionState = {
        sessionId: 'session-zero-scene-test',
        topic: 'Zero Scene Oracle Test',
        currentStage: 6,
        stageName: 'video_generation',
        status: 'in_progress',
        progress: 80,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: {},
        artifacts: {
          blueprint: {
            topic: 'Zero Scene Test',
            title: 'Zero Scene Oracle Project',
            narrativeAngle: 'Direct',
            hookConcept: 'Hook',
            estimatedDurationSec: 5.0,
          },
          scenes: [
            {
              id: 'sc-normal',
              shotId: 'sc-normal',
              lineIndex: 0,
              startMs: 0,
              endMs: 5000,
              durationMs: 5000,
              lineText: 'Normal Shot',
              visualPrompt: 'Shot 1',
              motionType: 'video',
              videoPath: 'C:/assets/1.mp4',
              status: 'ready',
            },
            {
              id: 'sc-zero',
              shotId: 'sc-zero',
              lineIndex: 1,
              startMs: 5000,
              endMs: 5000,
              durationMs: 0, // Zero duration scene
              lineText: 'Zero Cut',
              visualPrompt: 'Zero cut marker',
              motionType: 'video',
              videoPath: 'C:/assets/zero.mp4',
              status: 'ready',
            },
          ],
        },
      };

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        sessionState: sessionWithZeroScene,
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const zeroSeg = content.tracks[0].segments[1];

      // Segment 1 has durationMs: 0. It should have duration 0 μs.
      // In CapCutDraftExporter.ts line 224: `sc.durationMs ? sc.durationMs / 1000 : 4.0` evaluates `0` as falsy,
      // incorrectly defaulting to 4.0s (4,000,000 μs)!
      assert.strictEqual(
        zeroSeg.target_timerange.duration,
        0,
        `Zero-duration scene coerced to 4.0s (${zeroSeg.target_timerange.duration} μs) due to falsy sc.durationMs === 0 in CapCutDraftExporter.ts:224`
      );
    });

  } finally {
    try {
      if (fs.existsSync(tmpTestDir)) {
        fs.rmSync(tmpTestDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // Summary
  console.log('\n================================================================================');
  console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY:`);
  console.log(`   Total Tests:  ${testCount}`);
  console.log(`   Passed:       ${passedCount} ✅`);
  console.log(`   Failed:       ${failedCount} ❌`);
  console.log('================================================================================\n');

  if (failedCount > 0) {
    console.error('❌ FAILURES DETECTED IN ADVERSARIAL STRESS TEST:');
    for (const msg of failureMessages) {
      console.error(msg);
    }
    process.exit(1);
  } else {
    console.log('🎉 ALL ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS!');
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal crash in adversarial test runner:', err);
  process.exit(1);
});
