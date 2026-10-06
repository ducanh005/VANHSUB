/**
 * Comprehensive Test Suite for Milestone 5: CapCut Desktop Draft Export Service
 *
 * Verifies:
 * 1. Windows path detection logic with LOCALAPPDATA and fallback.
 * 2. Microsecond calculation exactness (1 second = 1,000,000 μs).
 * 3. Synchronized 4-track timeline structure, segment alignment, material mapping.
 * 4. File generation and valid JSON parse for draft_content.json and draft_meta_info.json.
 * 5. Edge cases: empty subtitles, missing BGM/voiceover, non-ASCII Unicode draft titles (Vietnamese diacritics).
 * 6. Pipeline session state resolution.
 * 7. Both static and instance method calling conventions.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  CapCutDraftExporter,
  capCutDraftExporter,
  sanitizeDraftFolderName,
  type CapCutDraftExportOptions,
  type CapCutDraftProjectData,
} from '../main/ai-studio/services/CapCutDraftExporter';
import type { PipelineSessionState } from '../main/ai-studio/types';
import { aiStudioPipelineEngine } from '../main/ai-studio/AiStudioPipelineEngine';

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   TEST SUITE: CAPCUT DESKTOP DRAFT EXPORTER (MILESTONE 5)               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tmpTestDir = path.join(os.tmpdir(), `test_capcut_exporter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  fs.mkdirSync(tmpTestDir, { recursive: true });

  let passedCount = 0;
  let testIndex = 1;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ [Test ${testIndex++}] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ [Test ${testIndex++}] ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err.stack) {
        console.error(`     ${err.stack.split('\n').slice(1, 4).join('\n     ')}`);
      }
      throw err;
    }
  }

  try {
    // --------------------------------------------------------------------------
    // Test 1: Windows Path Detection Logic
    // --------------------------------------------------------------------------
    await test('Windows Path Detection: %LOCALAPPDATA% and Fallback Resolution', () => {
      const detectedDefault = CapCutDraftExporter.detectCapCutDraftDirectory();
      assert.strictEqual(typeof detectedDefault, 'string');
      assert(
        detectedDefault.includes('CapCut') && detectedDefault.includes('com.lveditor.draft'),
        `Path must contain CapCut and com.lveditor.draft: ${detectedDefault}`
      );

      // Verify instance method behaves identically
      const instanceExporter = new CapCutDraftExporter();
      const detectedInstance = instanceExporter.detectCapCutDraftDirectory();
      assert.strictEqual(detectedInstance, detectedDefault);

      // Verify exported singleton behaves identically
      assert.strictEqual(capCutDraftExporter.detectCapCutDraftDirectory(), detectedDefault);

      // Verify fallback when LOCALAPPDATA is temporarily cleared
      const originalLocalAppData = process.env.LOCALAPPDATA;
      try {
        delete process.env.LOCALAPPDATA;
        const fallbackPath = CapCutDraftExporter.detectCapCutDraftDirectory();
        const expectedFallback = path.join(
          os.homedir(),
          'AppData',
          'Local',
          'CapCut',
          'User Data',
          'Projects',
          'com.lveditor.draft'
        );
        assert.strictEqual(fallbackPath, expectedFallback);
      } finally {
        process.env.LOCALAPPDATA = originalLocalAppData;
      }
    });

    // --------------------------------------------------------------------------
    // Test 2: Microsecond Calculation Exactness (1s = 1,000,000 μs)
    // --------------------------------------------------------------------------
    await test('Microsecond Exactness: Integer conversion and precise timebase math', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_microsecond_exact');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-us-test',
          title: 'Microsecond Math Test',
          durationSec: 10.0,
          scenes: [
            { id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: 3.5, type: 'video' },
            { id: 'sc-2', path: 'C:/assets/2.mp4', durationSec: 6.5, type: 'video' },
          ],
          subtitles: [
            { text: 'Hello', startSec: 1.25, endSec: 4.75 },
          ],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));

      // Total duration exactness: 10.0s = 10,000,000 μs
      assert.strictEqual(content.duration, 10_000_000);
      assert.strictEqual(meta.tm_duration, 10_000_000);
      assert.strictEqual(Number.isInteger(content.duration), true);

      // Segment 1: 3.5s = 3,500,000 μs
      const seg1 = content.tracks[0].segments[0];
      assert.strictEqual(seg1.target_timerange.start, 0);
      assert.strictEqual(seg1.target_timerange.duration, 3_500_000);
      assert.strictEqual(Number.isInteger(seg1.target_timerange.duration), true);

      // Segment 2: 6.5s = 6,500,000 μs, starts at 3,500,000 μs
      const seg2 = content.tracks[0].segments[1];
      assert.strictEqual(seg2.target_timerange.start, 3_500_000);
      assert.strictEqual(seg2.target_timerange.duration, 6_500_000);
      assert.strictEqual(Number.isInteger(seg2.target_timerange.duration), true);

      // Subtitle segment: 1.25s = 1,250,000 μs, duration = (4.75 - 1.25) = 3.5s = 3,500,000 μs
      const textTrack = content.tracks.find((t: any) => t.type === 'text');
      assert(textTrack);
      assert.strictEqual(textTrack.segments[0].target_timerange.start, 1_250_000);
      assert.strictEqual(textTrack.segments[0].target_timerange.duration, 3_500_000);
      assert.strictEqual(Number.isInteger(textTrack.segments[0].target_timerange.start), true);
      assert.strictEqual(Number.isInteger(textTrack.segments[0].target_timerange.duration), true);
    });

    // --------------------------------------------------------------------------
    // Test 3: 4-Track Timeline Structure and Segment Alignment
    // --------------------------------------------------------------------------
    await test('Multi-Track Timeline: 4 synchronized tracks (Video, Voice, BGM, Text)', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_4_tracks_sync');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-4-tracks',
          title: 'Full 4-Track Sync Project',
          durationSec: 12.0,
          scenes: [
            { id: 'sc-1', path: 'C:/assets/clip1.mp4', durationSec: 4.0, type: 'video' },
            { id: 'sc-2', path: 'C:/assets/clip2.png', durationSec: 4.0, type: 'image' },
            { id: 'sc-3', path: 'C:/assets/clip3.mp4', durationSec: 4.0, type: 'video' },
          ],
          voiceoverPath: 'C:/assets/voiceover_full.mp3',
          bgmPath: 'C:/assets/bgm_soundtrack.mp3',
          subtitles: [
            { text: 'Câu số 1', startSec: 0.0, endSec: 3.5 },
            { text: 'Câu số 2', startSec: 4.0, endSec: 7.5 },
            { text: 'Câu số 3', startSec: 8.0, endSec: 11.5 },
          ],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.tracks.length, 4, 'Must contain exactly 4 tracks');

      // Track 1: Video track
      const videoTrack = content.tracks.find((t: any) => t.id === 'track-video-main');
      assert(videoTrack);
      assert.strictEqual(videoTrack.type, 'video');
      assert.strictEqual(videoTrack.segments.length, 3);
      assert.strictEqual(videoTrack.segments[0].target_timerange.start, 0);
      assert.strictEqual(videoTrack.segments[0].target_timerange.duration, 4_000_000);
      assert.strictEqual(videoTrack.segments[1].target_timerange.start, 4_000_000);
      assert.strictEqual(videoTrack.segments[1].target_timerange.duration, 4_000_000);
      assert.strictEqual(videoTrack.segments[2].target_timerange.start, 8_000_000);
      assert.strictEqual(videoTrack.segments[2].target_timerange.duration, 4_000_000);

      // Track 2: Voiceover track
      const voiceTrack = content.tracks.find((t: any) => t.id === 'track-audio-voice');
      assert(voiceTrack);
      assert.strictEqual(voiceTrack.type, 'audio');
      assert.strictEqual(voiceTrack.segments.length, 1);
      assert.strictEqual(voiceTrack.segments[0].target_timerange.start, 0);
      assert.strictEqual(voiceTrack.segments[0].target_timerange.duration, 12_000_000);

      // Track 3: BGM track
      const bgmTrack = content.tracks.find((t: any) => t.id === 'track-audio-bgm');
      assert(bgmTrack);
      assert.strictEqual(bgmTrack.type, 'audio');
      assert.strictEqual(bgmTrack.segments.length, 1);
      assert.strictEqual(bgmTrack.segments[0].target_timerange.start, 0);
      assert.strictEqual(bgmTrack.segments[0].target_timerange.duration, 12_000_000);

      // Track 4: Text Subtitles track
      const textTrack = content.tracks.find((t: any) => t.id === 'track-text-subtitle');
      assert(textTrack);
      assert.strictEqual(textTrack.type, 'text');
      assert.strictEqual(textTrack.segments.length, 3);
      assert.strictEqual(textTrack.segments[0].text, 'Câu số 1');
      assert.strictEqual(textTrack.segments[0].target_timerange.start, 0);
      assert.strictEqual(textTrack.segments[0].target_timerange.duration, 3_500_000);
      assert.strictEqual(textTrack.segments[1].text, 'Câu số 2');
      assert.strictEqual(textTrack.segments[1].target_timerange.start, 4_000_000);
      assert.strictEqual(textTrack.segments[1].target_timerange.duration, 3_500_000);
    });

    // --------------------------------------------------------------------------
    // Test 4: Complete Materials Dictionary & ID Mapping
    // --------------------------------------------------------------------------
    await test('Materials Dictionary: Complete mapping of videos, audios, and texts', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_materials_dict');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-mat-dict',
          title: 'Materials Dictionary Test',
          durationSec: 8.0,
          scenes: [
            { id: 'sc-1', path: 'D:/media/shot1.mp4', durationSec: 5.0, type: 'video' },
            { id: 'sc-2', path: 'D:/media/shot2.png', durationSec: 3.0, type: 'image' },
          ],
          voiceoverPath: 'D:/media/voice.mp3',
          bgmPath: 'D:/media/bgm.mp3',
          subtitles: [{ text: 'Sub 1', startSec: 0, endSec: 4.0 }],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const mats = content.materials;
      assert(mats);
      assert(Array.isArray(mats.videos) && mats.videos.length === 2);
      assert.strictEqual(mats.videos[0].id, 'mat-vid-0');
      assert.strictEqual(mats.videos[0].path, 'D:/media/shot1.mp4');
      assert.strictEqual(mats.videos[0].type, 'video');
      assert.strictEqual(mats.videos[0].duration, 5_000_000);

      assert.strictEqual(mats.videos[1].id, 'mat-vid-1');
      assert.strictEqual(mats.videos[1].path, 'D:/media/shot2.png');
      assert.strictEqual(mats.videos[1].type, 'image');
      assert.strictEqual(mats.videos[1].duration, 3_000_000);

      assert(Array.isArray(mats.audios) && mats.audios.length === 2);
      assert.strictEqual(mats.audios[0].id, 'mat-audio-voice-0');
      assert.strictEqual(mats.audios[0].path, 'D:/media/voice.mp3');
      assert.strictEqual(mats.audios[0].duration, 8_000_000);

      assert.strictEqual(mats.audios[1].id, 'mat-audio-bgm-0');
      assert.strictEqual(mats.audios[1].path, 'D:/media/bgm.mp3');
      assert.strictEqual(mats.audios[1].duration, 8_000_000);

      assert(Array.isArray(mats.texts) && mats.texts.length === 1);
      assert.strictEqual(mats.texts[0].id, 'mat-text-0');
      assert.strictEqual(mats.texts[0].content, 'Sub 1');

      // Verify Track segment material_ids match materials dictionary IDs
      assert.strictEqual(content.tracks[0].segments[0].material_id, 'mat-vid-0');
      assert.strictEqual(content.tracks[0].segments[1].material_id, 'mat-vid-1');
      assert.strictEqual(content.tracks[1].segments[0].material_id, 'mat-audio-voice-0');
      assert.strictEqual(content.tracks[2].segments[0].material_id, 'mat-audio-bgm-0');
      assert.strictEqual(content.tracks[3].segments[0].material_id, 'mat-text-0');
    });

    // --------------------------------------------------------------------------
    // Test 5: File Generation & Valid JSON Parsing
    // --------------------------------------------------------------------------
    await test('File Generation: draft_content.json and draft_meta_info.json on disk', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_file_generation');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-file-test',
          title: 'Disk File Integrity Test',
          durationSec: 5.0,
          scenes: [{ id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: 5.0, type: 'video' }],
        },
      });

      assert(fs.existsSync(result.contentJsonPath), 'draft_content.json must exist on disk');
      assert(fs.existsSync(result.metaInfoJsonPath), 'draft_meta_info.json must exist on disk');

      // Must parse without JSON errors
      const contentRaw = fs.readFileSync(result.contentJsonPath, 'utf8');
      const metaRaw = fs.readFileSync(result.metaInfoJsonPath, 'utf8');

      const content = JSON.parse(contentRaw);
      const meta = JSON.parse(metaRaw);

      assert.strictEqual(content.version, 2);
      assert.strictEqual(meta.draft_id, 'draft-file-test');
      assert.strictEqual(meta.draft_name, 'Disk File Integrity Test');
      assert.strictEqual(meta.draft_fold_path, draftDir);
      assert(typeof meta.tm_draft_create === 'number' && meta.tm_draft_create > 0);
      assert.strictEqual(meta.tm_duration, 5_000_000);

      // Verify return result summaries
      assert.strictEqual(result.tracksSummary.videoClipsCount, 1);
      assert.strictEqual(result.tracksSummary.voiceoverTracksCount, 0);
      assert.strictEqual(result.tracksSummary.bgmTracksCount, 0);
      assert.strictEqual(result.tracksSummary.subtitlesCount, 0);
      assert.strictEqual(result.tracksSummary.totalDurationUs, 5_000_000);
      // Dual contract compliance: both trackSummary and tracksSummary exist
      assert.deepStrictEqual(result.trackSummary, result.tracksSummary);
    });

    // --------------------------------------------------------------------------
    // Test 6: Edge Case - Empty Subtitles
    // --------------------------------------------------------------------------
    await test('Edge Case: Empty Subtitles array does not generate text track or crash', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_empty_subtitles');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-empty-subs',
          title: 'Empty Subs Draft',
          durationSec: 4.0,
          scenes: [{ id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: 4.0, type: 'video' }],
          subtitles: [],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      const textTrack = content.tracks.find((t: any) => t.type === 'text');
      assert.strictEqual(textTrack, undefined, 'No text track should be present when subtitles are empty');
      assert.strictEqual(result.tracksSummary.subtitlesCount, 0);
      assert.strictEqual(content.materials.texts.length, 0);
    });

    // --------------------------------------------------------------------------
    // Test 7: Edge Case - Missing BGM and Voiceover Audio Tracks
    // --------------------------------------------------------------------------
    await test('Edge Case: Missing BGM & Voiceover generates video-only draft cleanly', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_no_audio');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-no-audio',
          title: 'Video Only Draft',
          durationSec: 6.0,
          scenes: [{ id: 'sc-1', path: 'C:/assets/video.mp4', durationSec: 6.0, type: 'video' }],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.tracks.length, 1, 'Only video track should exist');
      assert.strictEqual(content.tracks[0].type, 'video');
      assert.strictEqual(content.materials.audios.length, 0);
      assert.strictEqual(result.tracksSummary.voiceoverTracksCount, 0);
      assert.strictEqual(result.tracksSummary.bgmTracksCount, 0);
    });

    // --------------------------------------------------------------------------
    // Test 8: Edge Case - Non-ASCII Unicode Draft Titles (Vietnamese Diacritics)
    // --------------------------------------------------------------------------
    await test('Edge Case: Unicode Vietnamese Diacritics preservation in title & subtitles', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_vietnamese_unicode');
      const unicodeTitle = 'Kỳ Tích Khoa Học: Hành Trình Chinh Phục Không Gian Vũ Trụ 2026 🚀';
      const viSub1 = 'Chào mừng bạn đến với VANHSUB AI Studio!';
      const viSub2 = 'Tự động biên kịch, đồng bộ âm thanh và xuất CapCut Desktop.';

      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-vietnamese-01',
          title: unicodeTitle,
          durationSec: 6.0,
          scenes: [{ id: 'sc-1', path: 'C:/assets/vid.mp4', durationSec: 6.0, type: 'video' }],
          subtitles: [
            { text: viSub1, startSec: 0, endSec: 3.0 },
            { text: viSub2, startSec: 3.0, endSec: 6.0 },
          ],
        },
      });

      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));
      assert.strictEqual(meta.draft_name, unicodeTitle, 'Unicode title must be preserved verbatim in draft_meta_info.json');

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.materials.texts[0].content, viSub1);
      assert.strictEqual(content.materials.texts[1].content, viSub2);

      // Verify sanitizeDraftFolderName preserves Vietnamese characters
      const sanitizedName = sanitizeDraftFolderName('Dự Án: Siêu Phim AI? *2026*');
      assert(!sanitizedName.includes(':'));
      assert(!sanitizedName.includes('?'));
      assert(!sanitizedName.includes('*'));
      assert(sanitizedName.includes('Dự Án'));
      assert(sanitizedName.includes('Siêu Phim AI'));
    });

    // --------------------------------------------------------------------------
    // Test 9: PipelineSessionState Resolution
    // --------------------------------------------------------------------------
    await test('Session State Resolution: Automatically derives project data from PipelineSessionState', async () => {
      const mockSession: PipelineSessionState = {
        sessionId: 'session-demo-777',
        topic: 'Khoa Học Vũ Trụ Tương Lai',
        currentStage: 7,
        stageName: 'render',
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: {},
        artifacts: {
          blueprint: {
            topic: 'Khoa Học Vũ Trụ',
            title: 'Hành Trình Xuyên Thiên Hà',
            narrativeAngle: 'Khám phá',
            hookConcept: 'Mặt trời thứ hai',
            estimatedDurationSec: 8.0,
          },
          audioPath: 'C:/workspace/sessions/session-demo-777/assets/voiceover.mp3',
          scenes: [
            {
              id: 'shot_1',
              shotId: 'shot_1',
              lineIndex: 0,
              startMs: 0,
              endMs: 4000,
              durationMs: 4000,
              lineText: 'Hành tinh xanh',
              visualPrompt: 'Futuristic galaxy',
              motionType: 'video',
              videoPath: 'C:/workspace/sessions/session-demo-777/media/shot1.mp4',
              status: 'ready',
            },
            {
              id: 'shot_2',
              shotId: 'shot_2',
              lineIndex: 1,
              startMs: 4000,
              endMs: 8000,
              durationMs: 4000,
              lineText: 'Vũ trụ vô tận',
              visualPrompt: 'Nebula explosion',
              motionType: 'ken_burns',
              imagePath: 'C:/workspace/sessions/session-demo-777/media/shot2.png',
              status: 'ready',
            },
          ],
          scriptLines: [
            { id: 'line-0', index: 0, text: 'Hành tinh xanh thẳm', startMs: 0, endMs: 4000 },
            { id: 'line-1', index: 1, text: 'Vũ trụ bao la rộng lớn', startMs: 4000, endMs: 8000 },
          ],
        },
      };

      const draftDir = path.join(tmpTestDir, 'capcut_session_state_resolution');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        sessionState: mockSession,
      });

      assert(fs.existsSync(result.contentJsonPath));
      assert(fs.existsSync(result.metaInfoJsonPath));

      const meta = JSON.parse(fs.readFileSync(result.metaInfoJsonPath, 'utf8'));
      assert.strictEqual(meta.draft_name, 'Hành Trình Xuyên Thiên Hà');
      assert.strictEqual(meta.draft_id, 'session-demo-777');

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert.strictEqual(content.tracks.length, 3, 'Should have video, voiceover, and text tracks');
      assert.strictEqual(content.duration, 8_000_000);
      assert.strictEqual(content.tracks[0].segments.length, 2);
      assert.strictEqual(content.tracks[0].segments[0].material_id, 'mat-vid-0');
      assert.strictEqual(content.tracks[0].segments[1].material_id, 'mat-vid-1');
    });

    // --------------------------------------------------------------------------
    // Test 10: Calling Conventions & Synchronous / Asynchronous Flexibility
    // --------------------------------------------------------------------------
    await test('Calling Conventions: Static, Instance, Synchronous, and Positional Arguments', async () => {
      const projectData: CapCutDraftProjectData = {
        id: 'draft-conventions',
        title: 'Calling Conventions Test',
        durationSec: 5.0,
        scenes: [{ id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: 5.0, type: 'video' }],
      };

      // 1. Static async with options object
      const dir1 = path.join(tmpTestDir, 'conv_1');
      const res1 = await CapCutDraftExporter.exportToCapCutDraft({ targetDir: dir1, projectData });
      assert(fs.existsSync(res1.contentJsonPath));

      // 2. Static async with (targetDir, projectData)
      const dir2 = path.join(tmpTestDir, 'conv_2');
      const res2 = await CapCutDraftExporter.exportToCapCutDraft(dir2, projectData);
      assert(fs.existsSync(res2.contentJsonPath));

      // 3. Static async with (projectData, targetDir)
      const dir3 = path.join(tmpTestDir, 'conv_3');
      const res3 = await CapCutDraftExporter.exportToCapCutDraft(projectData, dir3);
      assert(fs.existsSync(res3.contentJsonPath));

      // 4. Instance async
      const dir4 = path.join(tmpTestDir, 'conv_4');
      const res4 = await capCutDraftExporter.exportToCapCutDraft(dir4, projectData);
      assert(fs.existsSync(res4.contentJsonPath));

      // 5. Synchronous export
      const dir5 = path.join(tmpTestDir, 'conv_5');
      const res5 = CapCutDraftExporter.exportToCapCutDraftSync(dir5, projectData);
      assert(fs.existsSync(res5.contentJsonPath));
      assert.strictEqual(res5.tracksSummary.totalDurationUs, 5_000_000);
    });

    // --------------------------------------------------------------------------
    // Test 11: Non-Integer Floating Precision Rounding Boundary
    // --------------------------------------------------------------------------
    await test('Boundary: Floating point durations properly rounded without NaN or float leak', async () => {
      const draftDir = path.join(tmpTestDir, 'capcut_rounding_stress');
      const result = await CapCutDraftExporter.exportToCapCutDraft({
        targetDir: draftDir,
        projectData: {
          id: 'draft-float-stress',
          title: 'Float Precision',
          durationSec: 7.7777777777,
          scenes: [
            { id: 'sc-1', path: 'C:/assets/1.mp4', durationSec: 3.3333333333, type: 'video' },
            { id: 'sc-2', path: 'C:/assets/2.mp4', durationSec: 4.4444444444, type: 'video' },
          ],
          subtitles: [
            { text: 'Sub float', startSec: 0.1111111, endSec: 2.2222222 },
          ],
        },
      });

      const content = JSON.parse(fs.readFileSync(result.contentJsonPath, 'utf8'));
      assert(Number.isInteger(content.duration), 'Total duration must be integer');
      assert.strictEqual(content.duration, 7_777_778);

      for (const track of content.tracks) {
        for (const seg of track.segments) {
          assert(Number.isInteger(seg.target_timerange.start), 'Segment start must be integer');
          assert(Number.isInteger(seg.target_timerange.duration), 'Segment duration must be integer');
        }
      }
    });

    // --------------------------------------------------------------------------
    // Test 12: Raw String SessionId Resolution
    // --------------------------------------------------------------------------
    await test('Raw String SessionId: Correctly queries engine and exports via raw string sessionId in multiple calling conventions', async () => {
      const mockSessionId = `raw-sess-${Date.now()}`;
      const mockSession: PipelineSessionState = {
        sessionId: mockSessionId,
        topic: 'Raw Session Test',
        currentStage: 6,
        stageName: 'visuals',
        status: 'in_progress',
        progress: 80,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: {},
        artifacts: {
          blueprint: {
            topic: 'Raw Session',
            title: 'Raw Session Project',
            narrativeAngle: 'Angle',
            hookConcept: 'Hook',
            estimatedDurationSec: 5.0,
          },
          scenes: [
            {
              id: 'sc-1',
              shotId: 'shot-1',
              lineIndex: 0,
              startMs: 0,
              endMs: 3500,
              durationMs: 3500,
              lineText: 'Shot 1',
              visualPrompt: 'Prompt 1',
              motionType: 'video',
              videoPath: 'C:/assets/shot1.mp4',
              status: 'ready',
            },
          ],
        },
      };

      (aiStudioPipelineEngine as any).activeSessions.set(mockSessionId, mockSession);

      // Convention A: exportToCapCutDraft(sessionId: string)
      const resA = await CapCutDraftExporter.exportToCapCutDraft(mockSessionId);
      assert(fs.existsSync(resA.contentJsonPath), 'Content JSON must exist for raw sessionId');
      assert.strictEqual(resA.tracksSummary.videoClipsCount, 1);
      assert.strictEqual(resA.tracksSummary.totalDurationUs, 3_500_000);

      // Clean up generated draft dir
      try { fs.rmSync(resA.draftPath, { recursive: true, force: true }); } catch {}

      // Convention B: exportToCapCutDraft(sessionId: string, targetDir: string)
      const customDirB = path.join(tmpTestDir, 'raw_session_dir_b');
      const resB = await CapCutDraftExporter.exportToCapCutDraft(mockSessionId, customDirB);
      assert.strictEqual(path.resolve(resB.draftPath), path.resolve(customDirB));
      assert.strictEqual(resB.tracksSummary.totalDurationUs, 3_500_000);

      // Convention C: exportToCapCutDraft(targetDir: string, sessionId: string) (IPC reverse order)
      const customDirC = path.join(tmpTestDir, 'raw_session_dir_c');
      const resC = await CapCutDraftExporter.exportToCapCutDraft(customDirC, mockSessionId);
      assert.strictEqual(path.resolve(resC.draftPath), path.resolve(customDirC));
      assert.strictEqual(resC.tracksSummary.totalDurationUs, 3_500_000);

      (aiStudioPipelineEngine as any).activeSessions.delete(mockSessionId);
    });

  } finally {
    // Clean up temporary workspace directory
    try {
      if (fs.existsSync(tmpTestDir)) {
        fs.rmSync(tmpTestDir, { recursive: true, force: true });
      }
    } catch {}
  }

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${passedCount} CAPCUT DRAFT EXPORTER TESTS PASSED (100% PASS RATE)!`);
  console.log('================================================================================');
}

runTests().catch((err) => {
  console.error('Fatal error executing CapCut Draft Exporter test suite:', err);
  process.exit(1);
});
