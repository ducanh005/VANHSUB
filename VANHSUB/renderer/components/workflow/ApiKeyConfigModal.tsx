import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Trash2,
  ShieldCheck,
  Zap,
  X,
  Cpu,
} from 'lucide-react';
import { toast } from 'sonner';

interface ApiKeyConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyUpdated?: (hasKey: boolean) => void;
}

export default function ApiKeyConfigModal({
  isOpen,
  onClose,
  onKeyUpdated,
}: ApiKeyConfigModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setTestResult(null);
    setIsLoading(true);

    if (typeof window !== 'undefined' && window.vanhsub?.settings) {
      window.vanhsub.settings
        .get('geminiApiKey')
        .then((storedKey) => {
          setApiKey(typeof storedKey === 'string' ? storedKey : '');
        })
        .catch(() => {
          setApiKey('');
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const hasConfiguredKey = Boolean(apiKey.trim());

  const handleSave = async (keyToSave = apiKey) => {
    setIsSaving(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.settings) {
        await window.vanhsub.settings.set('geminiApiKey', keyToSave.trim());
      }
      toast.success(
        keyToSave.trim()
          ? 'Đã lưu Gemini API Key! Sẵn sàng sử dụng Google Veo 3.1 & Imagen 3.'
          : 'Đã xóa API Key. Đã chuyển sang chế độ Mô phỏng Offline an toàn.'
      );
      if (onKeyUpdated) {
        onKeyUpdated(Boolean(keyToSave.trim()));
      }
      onClose();
    } catch (err: any) {
      toast.error('Lỗi khi lưu API Key: ' + (err?.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    const key = apiKey.trim();
    if (!key) {
      toast.error('Vui lòng nhập Gemini API Key trước khi kiểm tra!');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      if (typeof window !== 'undefined' && window.vanhsub?.settings) {
        await window.vanhsub.settings.set('geminiApiKey', key);
      }

      if (typeof window !== 'undefined' && window.vanhsub?.ai?.polishLine) {
        await window.vanhsub.ai.polishLine({
          text: 'Xin chào Google AI',
        });
        setTestResult({
          ok: true,
          message: 'Kết nối thành công! Key hợp lệ cho Google Veo 3.1, Imagen 3 và Gemini Director.',
        });
        toast.success('Kết nối Google Gemini AI thành công!');
        if (onKeyUpdated) onKeyUpdated(true);
      } else {
        if (key.startsWith('AIza') && key.length >= 35) {
          setTestResult({
            ok: true,
            message: 'Định dạng Key hợp lệ chuẩn Google AI Studio!',
          });
          toast.success('Định dạng key hợp lệ!');
          if (onKeyUpdated) onKeyUpdated(true);
        } else {
          setTestResult({
            ok: false,
            message: 'Key không đúng định dạng chuẩn của Google (thường bắt đầu bằng "AIza...").',
          });
        }
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || 'Không thể kết nối đến Google Gemini API. Vui lòng kiểm tra lại key.',
      });
      toast.error('Kiểm tra kết nối thất bại');
    } finally {
      setIsTesting(false);
    }
  };

  const handleResetToSimulation = async () => {
    setApiKey('');
    setTestResult(null);
    await handleSave('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-[#0d131f] p-6 shadow-2xl flex flex-col gap-5 text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 via-rose-500 to-indigo-600 p-0.5 shadow-lg shadow-indigo-950/40">
              <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#0d131f]">
                <Sparkles className="h-5 w-5 text-amber-400" />
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Cấu hình Google Veo 3.1 & Gemini API</span>
              </h2>
              <p className="text-xs text-slate-400">
                Quản lý quyền truy cập mô hình video, hình ảnh và kịch bản phim
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Banner */}
        <div
          className={`flex items-start gap-3 p-3.5 rounded-xl border ${
            hasConfiguredKey
              ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
              : 'bg-amber-950/30 border-amber-800/60 text-amber-200'
          }`}
        >
          {hasConfiguredKey ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="text-xs space-y-1">
            <div className="font-semibold flex items-center gap-2">
              <span>
                {hasConfiguredKey
                  ? 'Đã cấu hình: Google Veo 3.1 & Imagen 3 Sẵn sàng'
                  : 'Chế độ Hiện tại: Mô phỏng Offline An toàn (Miễn phí 100%)'}
              </span>
            </div>
            <p className="text-[11px] opacity-90 leading-relaxed">
              {hasConfiguredKey
                ? 'Hệ thống sẽ gọi trực tiếp mô hình Google Veo 3.1 preview và Imagen 3 để sinh video & hình ảnh chân thực.'
                : 'Bạn không bắt buộc phải nhập key ngay! Khi để trống, VANHSUB tự động sinh video gradient mô phỏng bằng FFmpeg để bạn tự do thử nghiệm nối node, dựng kịch bản mà không tốn quota.'}
            </p>
          </div>
        </div>

        {/* 2 Modes Comparison */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-indigo-300">
              <Zap className="w-3.5 h-3.5 text-indigo-400" />
              <span>Chế độ Render Thật (Veo 3.1)</span>
            </div>
            <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
              <li>Mô hình Veo 3.1 (720p/1080p, 24fps)</li>
              <li>Ảnh siêu thực Google Imagen 3</li>
              <li>Gemini 2.5 Flash đạo diễn phân cảnh</li>
              <li>Cần Gemini API Key (từ Google)</li>
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-amber-300">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              <span>Chế độ Mô phỏng Offline</span>
            </div>
            <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
              <li>Hoàn toàn miễn phí & không cần mạng</li>
              <li>Tự tạo clip video gradient sống động</li>
              <li>Kiểm tra luồng DAG, Inspector & Preset</li>
              <li>Ghép Master Sequence không tốn chi phí</li>
            </ul>
          </div>
        </div>

        {/* Input Form */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <label className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Google Gemini API Key</span>
            </label>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline"
              title="Mở Google AI Studio trong trình duyệt"
            >
              <span>Lấy API Key tại Google AI Studio</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="relative flex items-center">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy... (dán key lấy từ aistudio.google.com)"
              className="w-full text-xs font-mono rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 pr-10 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              disabled={isLoading || isTesting || isSaving}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 text-slate-500 hover:text-slate-300 transition-colors"
              title={showKey ? 'Ẩn key' : 'Hiện key'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            * Khóa được mã hóa an toàn trên máy của bạn (safeStorage) và dùng chung cho dịch thuật Subtitle, Veo 3.1 và Imagen 3.
          </p>
        </div>

        {/* Test Result Message */}
        {testResult && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              testResult.ok
                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800 text-rose-300'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
          <div>
            {hasConfiguredKey && (
              <button
                type="button"
                onClick={handleResetToSimulation}
                disabled={isSaving || isTesting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                title="Xóa key để chuyển sang chế độ mô phỏng an toàn"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa Key / Quay về Mô phỏng</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={!apiKey.trim() || isTesting || isSaving}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span>Đang kiểm tra...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Kiểm tra kết nối</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSave()}
              disabled={isSaving || isTesting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-950/40 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <span>Lưu Cấu Hình</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
