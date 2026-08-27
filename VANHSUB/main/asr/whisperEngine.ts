// Module xử lý ASR (Speech-to-Text) bằng whisper.cpp qua package nodejs-whisper.
// Đây là "domain logic" thuần túy — KHÔNG import gì từ electron, để có thể test
// độc lập qua script terminal (scripts/test-asr.ts) mà không cần mở app lên.

import fs from 'fs';
import { nodewhisper } from 'nodejs-whisper';

export interface TranscribeOptions {
  /**
   * Tên model whisper cần dùng, vd: 'base', 'small', 'medium'.
   * Sau này khi convert xong PhoWhisper sang ggml, thêm giá trị tương ứng vào đây.
   */
  modelName?: string;

  /**
   * Thư mục lưu model đã tải — để tách khỏi thư mục mặc định của package,
   * dễ quản lý dung lượng và đường dẫn khi đóng gói app.
   */
  modelRootPath?: string;
}

export interface TranscribeResult {
  /** Đường dẫn file .srt vừa được tạo ra */
  srtPath: string;
}

const DEFAULT_MODEL = 'base';

/**
 * Chuyển 1 file audio/video thành phụ đề .srt.
 *
 * @param audioPath  Đường dẫn TUYỆT ĐỐI tới file audio (mp3/wav/m4a...).
 *                    Nếu là video, cần tách audio ra trước (sẽ làm ở module render/ffmpeg sau).
 * @param options    Tùy chọn model.
 */
export async function transcribe(
  audioPath: string,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Không tìm thấy file audio: ${audioPath}`);
  }

  const modelName = options.modelName ?? DEFAULT_MODEL;

  await nodewhisper(audioPath, {
    modelName,
    autoDownloadModelName: modelName,
    ...(options.modelRootPath ? { modelRootPath: options.modelRootPath } : {}),
    whisperOptions: {
      outputInSrt: true,
      outputInText: false,
      outputInVtt: false,
      outputInCsv: false,
      translateToEnglish: false,
      wordTimestamps: false,
      splitOnWord: true,
    },
  });

  // nodejs-whisper thực tế tạo file SRT bằng cách nối ".srt"
  // vào toàn bộ tên file đầu vào.
  //
  // Ví dụ:
  //   video.wav -> video.wav.srt
  //   audio.mp3 -> audio.mp3.srt
  //
  // Không dùng path.extname() ở đây vì cách đó sẽ tạo:
  //   video.wav -> video.srt
  //
  // nhưng nodejs-whisper đang tạo:
  //   video.wav -> video.wav.srt
  const srtPath = `${audioPath}.srt`;

  if (!fs.existsSync(srtPath)) {
    throw new Error(
      `nodejs-whisper chạy xong nhưng không thấy file srt tại: ${srtPath}. ` +
      `Kiểm tra lại output của whisper.cpp.`,
    );
  }

  return { srtPath };
}