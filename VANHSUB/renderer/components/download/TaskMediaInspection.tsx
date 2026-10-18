import React, { useState } from 'react';
import type { Task } from '../../types/task';
import { MediaInspectionPanel } from './MediaInspectionPanel';

export function TaskMediaInspection({ task }: { task: Task }) {
  const [checking, setChecking] = useState<'source' | 'output' | null>(null);
  const [error, setError] = useState('');
  const busy = checking !== null || ['exporting', 'dubbing'].includes(task.status);
  const check = async (target: 'source' | 'output') => {
    setChecking(target); setError('');
    try { await window.vanhsub.downloader.checkTask(task.id, target); }
    catch (err: any) { setError(err.message || 'Không kiểm tra được file.'); }
    finally { setChecking(null); }
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3 text-xs">
      <button type="button" disabled={busy} className="text-accent underline disabled:opacity-50" onClick={() => void check('source')}>Kiểm tra lại file đầu vào</button>
      {task.outputPath && <button type="button" disabled={busy} className="text-accent underline disabled:opacity-50" onClick={() => void check('output')}>Kiểm tra lại file xuất</button>}
      {checking && <>
        <span>Đang kiểm tra {checking === 'output' ? 'file xuất' : 'file đầu vào'} và quét khung hình...</span>
        <button type="button" className="underline" onClick={() => { void window.vanhsub.downloader.cancelCheck(task.id).catch(() => setError('Không gửi được yêu cầu hủy.')); }}>Hủy kiểm tra</button>
      </>}
    </div>
    {error && <p role="alert" className="text-xs text-amber-400">{error}</p>}
    {task.outputInspection?.filePath === task.outputPath && task.outputInspection && <MediaInspectionPanel report={task.outputInspection} title="Kiểm tra video xuất cuối" />}
    {task.mediaInspection && <details className="text-xs"><summary className="cursor-pointer text-text-muted">Kết quả kiểm tra lúc tải / đầu vào</summary><div className="mt-2"><MediaInspectionPanel report={task.mediaInspection} /></div></details>}
  </div>;
}
