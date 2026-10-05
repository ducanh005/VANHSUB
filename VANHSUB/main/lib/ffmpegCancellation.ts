import type ffmpeg from 'fluent-ffmpeg';
import { killProcessTreeByPid } from './processTree';

export function withFfmpegCancellation(
  command: ffmpeg.FfmpegCommand,
  shouldStop?: () => boolean
): ffmpeg.FfmpegCommand {
  if (!shouldStop) return command;
  let killed = false;
  const timer = setInterval(() => {
    if (!shouldStop() || killed) return;
    const child = (command as any).ffmpegProc;
    if (child?.pid) {
      killed = true;
      killProcessTreeByPid(child.pid);
      try {
        command.kill('SIGKILL');
      } catch {}
    }
  }, 150);
  const cleanup = () => clearInterval(timer);
  command.once('end', cleanup).once('error', cleanup);
  return command;
}
