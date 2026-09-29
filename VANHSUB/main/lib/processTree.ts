import { spawn, type ChildProcess } from 'child_process';

/**
 * Tiêu diệt tiến trình và toàn bộ cây tiến trình con cháu (process tree) theo PID.
 * Trên Windows (win32): dùng lệnh hệ thống `taskkill /pid <PID> /T /F`.
 * Trên POSIX: fallback về `process.kill(pid, 'SIGKILL')`.
 */
export function killProcessTreeByPid(pid: number): void {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', () => {
        // Tránh unhandled error event nếu taskkill gặp lỗi hiếm gặp
      });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Bỏ qua nếu tiến trình đã thoát
      }
    }
  } catch {
    // Bỏ qua an toàn
  }
}

/**
 * Tiêu diệt triệt để cây tiến trình từ đối tượng ChildProcess của Node.js.
 */
export function killProcessTree(child: ChildProcess): void {
  if (!child) return;
  try {
    if (child.pid) {
      killProcessTreeByPid(child.pid);
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // Bỏ qua an toàn
  }
}
