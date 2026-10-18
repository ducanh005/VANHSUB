import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { app } from 'electron';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { getFfmpegBinPath } from '../asr/audioExtractor';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { nextAvailablePath } from '../lib/paths';
import type { MediaInspection } from '../../shared/mediaInspection';

export interface InspectionOptions {
  cleanMetadata?: boolean;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
  source?: MediaInspection['source'];
  ocrCachePath?: string;
  sampleCount?: number;
}

function checkStop(options: InspectionOptions) {
  if (options.shouldStop?.()) throw new CancelledError();
}

/** Bounded child process, cancelled during probe, remux, decode and sampling alike. */
function run(bin: string, args: string[], options: InspectionOptions, timeout = 60_000): Promise<string> {
  checkStop(options);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '', stderr = '';
    let failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error('Kiểm tra media quá thời gian cho phép.'); child.kill(); }, timeout);
    const poll = setInterval(() => {
      if (options.shouldStop?.()) { failure = new CancelledError(); child.kill(); }
    }, 150);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-2_000_000); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    const cleanup = () => { clearTimeout(timer); clearInterval(poll); };
    child.once('error', err => { cleanup(); reject(err); });
    child.once('close', code => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Không thể xử lý media: ${stderr || `exit ${code}`}`));
      else resolve(stdout);
    });
  });
}

async function probe(filePath: string, options: InspectionOptions) {
  const bin = ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked');
  return JSON.parse(await run(bin, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath], options, 30_000));
}

function tagsOf(probeData: any): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(probeData.format?.tags || {})) tags[`format.${key}`] = String(value);
  for (const stream of probeData.streams || []) {
    for (const [key, value] of Object.entries(stream.tags || {})) tags[`stream.${stream.index}.${key}`] = String(value);
  }
  return tags;
}

export function sourceMetadataFields(tags: Record<string, string>): string[] {
  return Object.keys(tags).filter(key => /^(?:vid:|.*com\.bytedance\.info)/i.test(tags[key]) || /(?:aweme|video_id|source_id)/i.test(key));
}

/** Only remove technical IDs; preserve attribution, copyright and non-empty provenance/AI labels. */
export function removableMetadataFields(tags: Record<string, string>): string[] {
  return Object.keys(tags).filter(key => {
    if (/\.comment$/i.test(key)) return /^vid:[a-z0-9_-]+$/i.test(tags[key].trim());
    if (/\.information$/i.test(key)) {
      try {
        const value = JSON.parse(tags[key]);
        return Object.keys(value).length === 1 && value['com.bytedance.info'] === '{}';
      } catch { return false; }
    }
    return false;
  });
}

export function sampleTimes(duration: number, count = 24): number[] {
  const end = Math.max(0, duration - 0.1);
  const size = Math.max(1, Math.min(24, Number.isFinite(count) ? Math.floor(count) : 24, Math.ceil(duration / 2) + 1));
  return [...new Set(Array.from({ length: size }, (_, i) => size === 1 ? 0 : Number((end * i / (size - 1)).toFixed(3))))];
}

export function looksLikeMark(text: string): boolean {
  return /抖\s*音|\bdouyin\b|\btik\s*tok\b|小\s*云\s*雀|@[\w\u3400-\u9fff.-]+|\bID\b\s*[:：]?\s*[a-z0-9_-]+/i.test(text);
}

async function guarded<T>(promise: Promise<T>, options: InspectionOptions, timeout: number): Promise<T> {
  checkStop(options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Quét OCR quá thời gian cho phép.')), timeout);
      poll = setInterval(() => { if (options.shouldStop?.()) reject(new CancelledError()); }, 150);
    })]);
  } finally { clearTimeout(timer); clearInterval(poll); }
}

async function scanFrames(report: MediaInspection, options: InspectionOptions) {
  let worker: Worker | undefined;
  let abandoned = false;
  const cache = options.ocrCachePath || (app?.getPath ? path.join(app.getPath('userData'), 'tessdata') : '');
  // Reuse installed OCR data, without silently downloading models during a video download.
  const language = ['chi_sim', 'eng'].filter(lang => cache && fs.existsSync(path.join(cache, `${lang}.traineddata`))).join('+');
  if (!language) {
    report.visual.status = 'unavailable';
    report.visual.message = 'Chưa có dữ liệu OCR Trung/Anh. Chạy OCR tiếng Trung trong app để cài dữ liệu, rồi kiểm tra lại. Có thể xem các khung hình ngay.';
    return;
  }
  report.visual.language = language;
  try {
    const pending = createWorker(language, 1, { cachePath: cache, langPath: cache, gzip: false, cacheMethod: 'readOnly', logger: () => {}, errorHandler: () => {} });
    void pending.then(value => { if (abandoned) void value.terminate(); }, () => {});
    worker = await guarded(pending, options, 30_000);
    await guarded(worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }), options, 10_000);
    const deadline = Date.now() + 120_000;
    for (const frame of report.visual.frames) {
      checkStop(options);
      if (Date.now() >= deadline) throw new Error('Đã hết thời gian quét lấy mẫu; cần xem các khung chưa quét.');
      options.onProgress?.(`Đang quét chữ/ID trên khung ${report.visual.scannedFrames + 1}/${report.visual.frames.length}...`);
      const { data } = await guarded(worker.recognize(frame.imagePath, {}, { text: true, blocks: true }), options, Math.min(15_000, deadline - Date.now()));
      const lines = data.blocks?.flatMap(block => block.paragraphs.flatMap(para => para.lines)) || [];
      frame.text = lines.filter(line => line.confidence >= 40).map(line => line.text.trim()).filter(Boolean).join('\n').slice(0, 2000);
      frame.suspectedMark = looksLikeMark(frame.text);
      frame.scanned = true;
      report.visual.scannedFrames++;
    }
    report.visual.status = report.visual.frames.some(frame => frame.text) ? 'review_needed' : 'no_text_detected_in_samples';
    report.visual.message = 'OCR lấy mẫu chỉ phát hiện chữ và dấu hiệu logo/ID dạng chữ. Cần xem ảnh để kiểm tra logo đồ họa; không xác nhận toàn bộ khung hình hay watermark ẩn.';
  } catch (err: any) {
    if (isCancelledError(err)) throw err;
    report.visual.status = report.visual.scannedFrames ? 'partial' : 'unavailable';
    report.visual.message = `OCR chưa hoàn tất: ${err?.message || err}`;
  } finally {
    abandoned = true;
    if (worker) await worker.terminate();
  }
}

/** Produces a separate editing copy and a report. Never overwrites the input. */
export async function inspectMediaFile(originalPath: string, options: InspectionOptions = {}): Promise<MediaInspection> {
  checkStop(options);
  options.onProgress?.('Đang đọc thông số và metadata...');
  const beforeProbe = await probe(originalPath, options);
  const streams = beforeProbe.streams || [];
  if (!streams.some((s: any) => s.codec_type === 'video' || s.codec_type === 'audio')) throw new Error('File không có luồng video hoặc âm thanh hợp lệ.');
  const duration = Number(beforeProbe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Thời lượng media không hợp lệ.');
  const before = tagsOf(beforeProbe);
  const remove = options.cleanMetadata ? removableMetadataFields(before) : [];
  const ffmpeg = getFfmpegBinPath();
  let filePath = originalPath;
  let createdCopy = '';
  try {
    if (options.cleanMetadata) {
      options.onProgress?.('Đang tạo bản biên tập, giữ nguyên bản gốc...');
      const ext = path.extname(originalPath);
      createdCopy = nextAvailablePath(path.join(path.dirname(originalPath), `${path.basename(originalPath, ext)}_edit${ext}`));
      const args = ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-i', originalPath, '-map', '0', '-c', 'copy', '-map_metadata', '0'];
      if (['.mp4', '.mov', '.m4a'].includes(ext.toLowerCase())) args.push('-movflags', 'use_metadata_tags');
      for (const field of remove) {
        const match = field.match(/^stream\.(\d+)\.(.+)$/);
        args.push(match ? `-metadata:s:${match[1]}` : '-metadata', `${match ? match[2] : field.slice(7)}=`);
      }
      // Explicit empty tags only; do not strip copyright/author/AI provenance wholesale.
      await run(ffmpeg, [...args, createdCopy], options);
      filePath = createdCopy;
    }
    const afterProbe = createdCopy ? await probe(filePath, options) : beforeProbe;
    const after = tagsOf(afterProbe);
    if (createdCopy && (afterProbe.streams?.length !== streams.length || Math.abs(Number(afterProbe.format?.duration) - duration) > 0.1)) {
      throw new Error('Bản biên tập không giữ đủ luồng hoặc thời lượng; bản gốc được giữ nguyên.');
    }
    if (remove.some(field => Object.hasOwn(after, field))) throw new Error('Metadata kỹ thuật vẫn còn sau xử lý. Bản gốc được giữ nguyên.');
    options.onProgress?.('Đang giải mã kiểm tra toàn bộ file...');
    await run(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-nostdin', '-i', filePath, '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-'], options, Math.min(1_800_000, Math.max(60_000, duration * 2000)));
    const reportDir = fs.mkdtempSync(path.join(path.dirname(originalPath), 'media-check-'));
    const video = streams.find((s: any) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const report: MediaInspection = {
      version: 1, checkedAt: new Date().toISOString(), originalPath, filePath,
      reportPath: path.join(reportDir, 'report.json'), duration, width: video?.width || 0, height: video?.height || 0,
      decode: 'passed',
      metadata: { status: !options.cleanMetadata ? 'not_requested' : remove.length ? 'cleaned' : 'unchanged', removedFields: remove, remainingSourceFields: sourceMetadataFields(after), before, after },
      visual: { status: video ? 'unavailable' : 'not_applicable', method: 'sampled_ocr_and_manual_review', frames: [], scannedFrames: 0, message: video ? 'Chưa quét.' : 'File chỉ có âm thanh; không kiểm tra hình ảnh.' },
      warnings: [], source: options.source,
    };
    if (report.metadata.remainingSourceFields.length) report.warnings.push('Còn trường thông tin nguồn trong metadata; xem báo cáo chi tiết.');
    if (video) {
      let samplingFailed = false;
      for (const [index, time] of sampleTimes(duration, options.sampleCount).entries()) {
        checkStop(options);
        options.onProgress?.(`Đang lấy khung hình kiểm tra ${index + 1}...`);
        const imagePath = path.join(reportDir, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
        try {
          await run(ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-ss', String(time), '-i', filePath, '-frames:v', '1', '-vf', "scale='min(960,iw)':-2", imagePath], options, 30_000);
          if (!fs.existsSync(imagePath)) throw new Error('Không tạo được khung hình.');
          report.visual.frames.push({ time, imagePath, text: '', suspectedMark: false, scanned: false });
        } catch (err: any) {
          if (isCancelledError(err)) throw err;
          samplingFailed = true;
          report.warnings.push(`Không lấy được khung ở ${time}s: ${err.message}`);
          break;
        }
      }
      await scanFrames(report, options);
      if (samplingFailed) { report.visual.status = 'partial'; report.visual.message += ' Chưa lấy đủ khung hình dự kiến.'; }
    }
    checkStop(options);
    fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  } catch (err) {
    // Only the newly allocated editing copy belongs to this operation; preserve input/evidence.
    if (createdCopy && fs.existsSync(createdCopy)) fs.unlinkSync(createdCopy);
    throw err;
  }
}
