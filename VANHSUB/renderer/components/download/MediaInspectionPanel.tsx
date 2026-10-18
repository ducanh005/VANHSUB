import React, { useEffect, useState } from 'react';
import type { MediaInspection } from '../../../shared/mediaInspection';

const visualLabels: Record<MediaInspection['visual']['status'], string> = {
  review_needed: 'Có chữ/logo/ID nghi vấn — cần xem lại',
  no_text_detected_in_samples: 'Không phát hiện chữ trong mẫu — cần xem logo bằng mắt',
  unavailable: 'Chưa hoàn tất kiểm tra hình ảnh',
  partial: 'Mới kiểm tra một phần — cần xem lại',
  not_applicable: 'File âm thanh — không kiểm tra hình ảnh',
};

export function MediaInspectionPanel({ report, title = 'Kết quả kiểm tra file' }: { report: MediaInspection; title?: string }) {
  const [index, setIndex] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setIndex(Math.max(0, report.visual.frames.findIndex(frame => frame.suspectedMark))); }, [report.reportPath]);
  const frame = report.visual.frames[index];
  useEffect(() => {
    let active = true;
    setImage(null);
    if (expanded && frame) {
      window.vanhsub.files.readImageAsDataUrl(frame.imagePath).then(value => { if (active) setImage(value); }).catch(() => { if (active) setImage(null); });
    }
    return () => { active = false; };
  }, [expanded, frame?.imagePath]);
  const metadataLabel = report.metadata.status === 'cleaned'
    ? `Đã làm sạch ${report.metadata.removedFields.length} trường ID kỹ thuật trên bản biên tập`
    : report.metadata.status === 'unchanged' ? 'Đã kiểm tra — không có trường ID kỹ thuật thuộc nhóm xử lý'
    : 'Đã kiểm tra metadata — không yêu cầu làm sạch';
  return (
    <section className="rounded-lg border border-border bg-surface-2 p-3 space-y-2 text-xs text-text" aria-label={title}>
      <h3 className="font-semibold">{title}</h3>
      <p>File hợp lệ · Đã giải mã toàn bộ · {report.duration.toFixed(1)} giây{report.width ? ` · ${report.width}×${report.height}` : ''}</p>
      <p>{metadataLabel}.</p>
      {report.filePath !== report.originalPath && <p className="text-text-muted">Đã giữ bản gốc; bản dùng biên tập: {report.filePath.split(/[/\\]/).pop()}</p>}
      {report.metadata.remainingSourceFields.length > 0 && <p className="text-amber-400">Còn trường thông tin nguồn: {report.metadata.remainingSourceFields.join(', ')}.</p>}
      <p className="font-medium text-amber-400">{visualLabels[report.visual.status]}</p>
      <p className="text-text-muted">Đã OCR {report.visual.scannedFrames}/{report.visual.frames.length} khung lấy mẫu. {report.visual.message}</p>
      {report.warnings.map((warning, i) => <p key={i} className="text-amber-400">{warning}</p>)}
      <p className="text-text-muted">Kết quả này không xác nhận quyền đăng lại hoặc khả năng tránh nhận diện bản quyền.</p>
      <div className="flex gap-3">
        {!!report.visual.frames.length && <button type="button" className="text-accent underline" onClick={() => setExpanded(!expanded)}>{expanded ? 'Ẩn khung hình' : 'Xem khung hình và chữ nghi vấn'}</button>}
        <button type="button" className="text-accent underline" onClick={() => { setError(''); void window.vanhsub.dialog.openFolder(report.reportPath.replace(/[/\\][^/\\]+$/, '')).catch(() => setError('Không mở được thư mục báo cáo.')); }}>Mở báo cáo chi tiết</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {expanded && frame && <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {report.visual.frames.map((item, i) => <button type="button" key={item.imagePath} aria-pressed={index === i} onClick={() => setIndex(i)} className={`rounded border px-2 py-1 ${index === i ? 'border-accent text-accent' : 'border-border'}`}>
            {item.time.toFixed(1)}s{item.suspectedMark ? ' · ID/logo?' : item.text ? ' · chữ' : !item.scanned ? ' · chưa quét' : ''}
          </button>)}
        </div>
        {image ? <img src={image} alt={`Khung hình lấy mẫu tại ${frame.time.toFixed(1)} giây`} className="max-h-80 max-w-full object-contain rounded" /> : <p>Đang tải ảnh hoặc ảnh không còn trên đĩa.</p>}
        <p className="whitespace-pre-wrap break-words">{frame.text || (frame.scanned ? 'OCR không tìm thấy chữ đủ rõ ở khung này.' : 'Khung này chưa được OCR.')}</p>
      </div>}
    </section>
  );
}
