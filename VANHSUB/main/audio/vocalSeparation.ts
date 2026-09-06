// Tách lời thoại khỏi nhạc nền bằng Demucs (AI source separation — cùng loại
// công nghệ mà CapCut dùng cho tính năng "tách giọng"). Kết quả: file
// no_vocals.wav (nhạc nền/SFX không lời) để trộn với audio TTS, thay vì giữ
// nguyên giọng người gốc trong video.
//
// Yêu cầu môi trường: Python 3 + gói demucs (python -m pip install demucs —
// lần đầu kèm PyTorch ~2GB). Model htdemucs (~80MB) tự tải lần chạy đầu.
// Chạy CPU — thời lượng xử lý xấp xỉ thời lượng audio, video dài cần kiên nhẫn.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface DemucsCheck {
  ok: boolean;
  detail: string;
}

function runPython(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // bỏ qua
      }
      reject(new Error('Quá thời gian chạy python.'));
    }, timeoutMs);

    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** Kiểm tra máy đã cài sẵn demucs chưa (import nhanh) */
export async function checkDemucs(): Promise<DemucsCheck> {
  try {
    const { code, stderr } = await runPython(['-c', 'import demucs'], 60_000);
    if (code === 0) {
      return { ok: true, detail: 'Demucs đã sẵn sàng.' };
    }
    return {
      ok: false,
      detail:
        'Chưa cài gói demucs. Chạy: python -m pip install demucs (lần đầu tải PyTorch ~2GB).' +
        (stderr.trim() ? ` (${stderr.trim().split('\n').slice(-1)[0]})` : ''),
    };
  } catch {
    return {
      ok: false,
      detail: 'Không chạy được python — cài Python 3 rồi chạy: python -m pip install demucs',
    };
  }
}

export interface StemPaths {
  /** Nhạc nền/SFX không lời */
  noVocals: string;
  /** Giọng hát/thoại đã tách riêng */
  vocals: string;
}

/**
 * Tách audio thành 2 stem (vocals / no_vocals) và trả về đường dẫn cả 2 file.
 * Model htdemucs tự tải về lần chạy đầu (~80MB).
 */
export async function separateVocals(
  inputAudioPath: string,
  outDir: string,
  shouldStop?: () => boolean,
): Promise<StemPaths> {
  fs.mkdirSync(outDir, { recursive: true });
  const modelName = 'htdemucs';

  return new Promise((resolve, reject) => {
    console.log(`[Demucs] Bắt đầu tách lời thoại: ${path.basename(inputAudioPath)}`);
    const args = [
      '-m', 'demucs',
      '--two-stems=vocals',
      '-n', modelName,
      '-o', outDir,
      inputAudioPath,
    ];
    const child = spawn('python', args, { windowsHide: true });
    let stderrTail = '';

    const stopTimer = shouldStop
      ? setInterval(() => {
          if (shouldStop()) {
            try {
              child.kill();
            } catch {
              // bỏ qua
            }
          }
        }, 1000)
      : null;

    child.stdout?.on('data', (d) => {
      const text = d.toString();
      // demucs in tiến trình dạng phần trăm trên stderr/stdout — log thô ra terminal
      const match = /(\d{1,3})%/.exec(text);
      if (match) console.log(`[Demucs] ${match[1]}%`);
    });
    child.stderr?.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    child.on('error', (err) => {
      if (stopTimer) clearInterval(stopTimer);
      reject(
        new Error(
          `Không chạy được python/demucs: ${err.message}. Cài bằng lệnh: python -m pip install demucs`,
        ),
      );
    });
    child.on('exit', (code) => {
      if (stopTimer) clearInterval(stopTimer);
      if (code !== 0) {
        const tail = stderrTail.trim().split('\n').slice(-3).join(' | ');
        reject(new Error(`Demucs thoát với mã ${code}. ${tail}`));
        return;
      }
      // Kết quả nằm tại <outDir>/<model>/<tên file không đuôi>/{no_vocals,vocals}.wav
      const stemDir = path.join(outDir, modelName, path.basename(inputAudioPath, path.extname(inputAudioPath)));
      const noVocals = path.join(stemDir, 'no_vocals.wav');
      const vocals = path.join(stemDir, 'vocals.wav');
      if (!fs.existsSync(noVocals)) {
        reject(new Error(`Demucs chạy xong nhưng không thấy no_vocals.wav tại ${stemDir}`));
        return;
      }
      console.log(`[Demucs] ✓ Tách xong: ${noVocals}`);
      resolve({ noVocals, vocals: fs.existsSync(vocals) ? vocals : noVocals });
    });
  });
}
