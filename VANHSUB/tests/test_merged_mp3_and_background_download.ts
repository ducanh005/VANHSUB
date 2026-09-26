import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getProjectArtifactPaths, sanitizeFolderName } from '../main/utils/projectFolder';
import { mergeAudioFiles } from '../main/render/dubbingEngine';
import { TTSRunner } from '../main/render/ttsRunner';
import { TaskStore, type Task } from '../main/store/taskStore';
import { backgroundDownloadManager } from '../renderer/lib/downloadManager';
import { runFfmpeg } from '../main/render/dubbingEngine';
import { getMediaDurationSec } from '../main/asr/audioExtractor';

async function runTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ: XUẤT FILE MP3 TỔNG HỢP DỰ ÁN & BACKGROUND DOWNLOAD ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_test_merged_'));

  try {
    // -------------------------------------------------------------
    // Test 1: ProjectArtifactPaths bao gồm ttsMergedAudioPath
    // -------------------------------------------------------------
    console.log('--- Test 1: getProjectArtifactPaths định nghĩa đúng ttsMergedAudioPath ---');
    const dummyTask: Task = {
      id: 'task_test_artifact',
      fileName: 'video_demo_1080p.mp4',
      filePath: path.join(tempDir, 'video_demo_1080p.mp4'),
      workflow: 'full-dubbing',
      status: 'done',
      progress: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const artifacts = getProjectArtifactPaths(dummyTask);
    assert.ok(artifacts.ttsMergedAudioPath, 'ttsMergedAudioPath phải tồn tại');
    assert.ok(
      artifacts.ttsMergedAudioPath.endsWith('_voice.mp3'),
      `ttsMergedAudioPath phải kết thúc bằng _voice.mp3 (nhận: ${artifacts.ttsMergedAudioPath})`
    );
    assert.strictEqual(
      path.dirname(artifacts.ttsMergedAudioPath),
      artifacts.projectDir,
      'ttsMergedAudioPath phải nằm ngay trong projectDir'
    );
    console.log(`✅ Test 1 PASS: ttsMergedAudioPath = ${artifacts.ttsMergedAudioPath}`);

    // -------------------------------------------------------------
    // Test 2: Ghép audio thành file .mp3 bằng mergeAudioFiles (libmp3lame)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: mergeAudioFiles xuất file .mp3 chuẩn xác theo timeline ---');
    const srtContent = `1
00:00:01,000 --> 00:00:02,000
Xin chào các bạn đã đến với kênh.

2
00:00:02,500 --> 00:00:03,500
Hôm nay chúng ta sẽ cùng tìm hiểu.
`;
    const srtFile = path.join(tempDir, 'subtitles.srt');
    fs.writeFileSync(srtFile, srtContent, 'utf-8');

    const ttsAudioDir = path.join(tempDir, 'tts_audio');
    fs.mkdirSync(ttsAudioDir, { recursive: true });

    // Tạo 2 file audio câu thoại mẫu (0.8s mỗi câu) bằng ffmpeg
    const seg1 = path.join(ttsAudioDir, 'subtitle_0001.mp3');
    const seg2 = path.join(ttsAudioDir, 'subtitle_0002.mp3');
    await runFfmpeg([
      '-f', 'lavfi',
      '-i', 'sine=frequency=800:duration=0.8',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y', seg1,
    ]);
    await runFfmpeg([
      '-f', 'lavfi',
      '-i', 'sine=frequency=1000:duration=0.8',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y', seg2,
    ]);

    assert.ok(fs.existsSync(seg1), 'Segment 1 phải tồn tại');
    assert.ok(fs.existsSync(seg2), 'Segment 2 phải tồn tại');

    const mergedMp3Output = path.join(tempDir, 'consolidated_voice.mp3');
    let reportedProgress = 0;
    const { audioPath, overruns } = await mergeAudioFiles(
      srtFile,
      ttsAudioDir,
      mergedMp3Output,
      (p) => {
        reportedProgress = p;
      },
      { mode: 'flexible' }
    );

    assert.strictEqual(audioPath, mergedMp3Output, 'Đường dẫn trả về phải trùng outputPath');
    assert.ok(fs.existsSync(mergedMp3Output), 'File MP3 tổng hợp phải được tạo thành công');
    assert.strictEqual(reportedProgress, 100, 'Tiến trình ghép phải đạt 100%');

    const stat = fs.statSync(mergedMp3Output);
    assert.ok(stat.size > 1000, `File MP3 tổng hợp phải có kích thước hợp lệ (>1KB, thực tế: ${stat.size} bytes)`);

    const dur = await getMediaDurationSec(mergedMp3Output);
    console.log(`Thời lượng audio MP3 tổng hợp: ${dur.toFixed(2)}s`);
    // Câu 1 bắt đầu ở 1s, kéo dài 0.8s + khoảng lặng câu 2 ở 2.5s kéo dài 0.8s -> tổng thời lượng >= 3.3s
    assert.ok(dur >= 3.0 && dur <= 4.5, `Thời lượng MP3 tổng hợp phải khớp timeline phụ đề (~3.3s - 4.0s, thực tế: ${dur}s)`);
    console.log('✅ Test 2 PASS: mergeAudioFiles đã tạo thành công file .mp3 mã hoá libmp3lame khớp timeline.');

    // -------------------------------------------------------------
    // Test 3: TTSRunner.exportMergedAudio xử lý lỗi & xuất file thành công
    // -------------------------------------------------------------
    console.log('\n--- Test 3: TTSRunner.exportMergedAudio xử lý tác vụ & cập nhật TaskStore ---');
    // Task không tồn tại
    const badRes = await TTSRunner.exportMergedAudio('non_existent_id');
    assert.strictEqual(badRes.ok, false, 'Phải báo lỗi khi task không tồn tại');
    assert.ok(badRes.error?.includes('Không tìm thấy tác vụ'));

    // Tạo task hợp lệ trong TaskStore
    const testTask = TaskStore.create({
      fileName: 'my_video_sample.mp4',
      filePath: path.join(tempDir, 'my_video_sample.mp4'),
      workflow: 'full-dubbing',
      status: 'done',
      progress: 100,
      srtPath: srtFile,
      ttsAudioDir,
      projectDir: tempDir,
    });

    const exportRes = await TTSRunner.exportMergedAudio(testTask.id);
    assert.strictEqual(exportRes.ok, true, `exportMergedAudio phải thành công: ${exportRes.error}`);
    assert.ok(exportRes.audioPath, 'Phải trả về audioPath');
    assert.ok(fs.existsSync(exportRes.audioPath!), 'File audio xuất ra phải tồn tại trên ổ đĩa');

    // Kiểm tra TaskStore đã được cập nhật ttsMergedAudioPath
    const updatedTask = TaskStore.getById(testTask.id);
    assert.ok(updatedTask?.ttsMergedAudioPath, 'TaskStore phải lưu ttsMergedAudioPath');
    assert.strictEqual(updatedTask?.ttsMergedAudioPath, exportRes.audioPath);
    console.log(`✅ Test 3 PASS: TTSRunner.exportMergedAudio thành công, task.ttsMergedAudioPath = ${updatedTask.ttsMergedAudioPath}`);

    // Dọn dẹp task test
    TaskStore.delete(testTask.id);

    // -------------------------------------------------------------
    // Test 4: backgroundDownloadManager Singleton & Subscription
    // -------------------------------------------------------------
    console.log('\n--- Test 4: backgroundDownloadManager quản lý tải ngầm xuyên suốt các tab ---');
    let stateUpdates = 0;
    const unsub = backgroundDownloadManager.subscribe(() => {
      stateUpdates++;
    });

    assert.strictEqual(backgroundDownloadManager.getState().active, null, 'Ban đầu active download phải là null');

    // Giả lập mock downloader IPC trên global window
    (global as any).window = {
      vanhsub: {
        downloader: {
          download: async (opts: any) => {
            return {
              task: { id: 'downloaded_task_1', fileName: opts.customFileName || 'test_video.mp4' },
              result: { success: true },
            };
          },
          onProgress: (_cb: any) => () => {},
        },
      },
    };

    // Bắt đầu tải
    const downloadPromise = backgroundDownloadManager.startDownload({
      url: 'https://www.tiktok.com/@user/video/1234567890',
      cleanUrl: 'https://www.tiktok.com/@user/video/1234567890',
      platform: 'tiktok',
      title: 'Video TikTok Quốc Tế Demo',
      quality: '1080p',
    });

    // Khi đang tải, kiểm tra trạng thái
    const stateWhileDownloading = backgroundDownloadManager.getState();
    assert.ok(stateWhileDownloading.active, 'active download phải tồn tại');
    assert.strictEqual(stateWhileDownloading.active?.isDownloading, true, 'isDownloading phải là true');
    assert.strictEqual(stateWhileDownloading.active?.platform, 'tiktok');
    assert.strictEqual(stateWhileDownloading.active?.title, 'Video TikTok Quốc Tế Demo');

    // Chờ hoàn tất
    const downloadResult = await downloadPromise;
    assert.ok(downloadResult.task, 'Phải trả về task hoàn tất');

    const stateAfterDone = backgroundDownloadManager.getState();
    assert.strictEqual(stateAfterDone.active?.isDownloading, false, 'isDownloading phải là false sau khi tải xong');
    assert.strictEqual(stateAfterDone.active?.progress.percent, 100, 'Progress phải đạt 100%');
    assert.ok(stateAfterDone.active?.completedTask, 'completedTask phải được lưu');

    // Dismiss thông báo
    backgroundDownloadManager.dismiss();
    assert.strictEqual(backgroundDownloadManager.getState().active, null, 'active phải là null sau khi dismiss');
    assert.ok(stateUpdates >= 3, `Phải có ít nhất 3 lần cập nhật trạng thái listener (thực tế: ${stateUpdates})`);

    unsub();
    console.log('✅ Test 4 PASS: backgroundDownloadManager hoạt động chuẩn xác (start, progress, completion, dismiss).');

    console.log('\n=============================================================');
    console.log('🎉 TOÀN BỘ 4 TEST SUITES ĐÃ VƯỢT QUA 100% THÀNH CÔNG!');
    console.log('=============================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
