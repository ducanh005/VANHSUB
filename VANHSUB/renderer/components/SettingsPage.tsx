import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  FolderOpen,
  Globe2,
  HardDrive,
  Key,
  Layers,
  Loader2,
  Mic,
  RefreshCw,
  Save,
  Trash2,
  Zap,
} from 'lucide-react';
import ASRModelSelector from './ASRModelSelector';
import { VOICE_OPTIONS, SPEED_OPTIONS } from '../lib/ttsOptions';

interface ModelInfo {
  name: string;
  fileName: string;
  size: string;
}

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-flash-latest');
  const [targetLanguage, setTargetLanguage] = useState('vi');
  const [asrModel, setAsrModel] = useState('base');
  const [exportDir, setExportDir] = useState('');
  const [translateBatchSize, setTranslateBatchSize] = useState(15);
  const [autoTranslateAfterAsr, setAutoTranslateAfterAsr] = useState(false);
  const [vietTtsEndpoint, setVietTtsEndpoint] = useState('http://localhost:6006');
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [ttsConnected, setTtsConnected] = useState<boolean | null>(null);
  const [checkingTts, setCheckingTts] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState(VOICE_OPTIONS);

  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [savedMessage, setSavedMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;

    Promise.all([
      window.vanhsub.settings.get('geminiApiKey'),
      window.vanhsub.settings.get('geminiModel'),
      window.vanhsub.settings.get('targetLanguage'),
      window.vanhsub.settings.get('asrModel'),
      window.vanhsub.settings.get('exportDir'),
      window.vanhsub.settings.get('translateBatchSize'),
      window.vanhsub.settings.get('autoTranslateAfterAsr'),
      window.vanhsub.settings.get('vietTtsEndpoint'),
      window.vanhsub.settings.get('ttsVoice'),
      window.vanhsub.settings.get('ttsSpeed'),
    ])
      .then(([key, gModel, lang, aModel, expDir, batchSize, autoTrans, ttsEndpoint, voice, spd]) => {
        if (key) setApiKey(key);
        if (gModel) setGeminiModel(gModel);
        if (lang) setTargetLanguage(lang);
        if (aModel) setAsrModel(aModel);
        if (expDir) setExportDir(expDir);
        if (batchSize) setTranslateBatchSize(Number(batchSize));
        if (autoTrans !== undefined) setAutoTranslateAfterAsr(Boolean(autoTrans));
        if (ttsEndpoint) setVietTtsEndpoint(String(ttsEndpoint));
        if (voice) setTtsVoice(String(voice));
        if (spd) setTtsSpeed(Number(spd) || 1.0);
      })
      .catch((err) => console.error('Lỗi khi nạp cài đặt:', err));

    // Danh sách giọng đọc thật từ server VietTTS (fallback: VOICE_OPTIONS)
    if (window.vanhsub?.tts?.voices) {
      window.vanhsub.tts
        .voices()
        .then((list) => {
          if (Array.isArray(list) && list.length > 0) {
            setVoiceOptions(list.map((v) => ({ value: v, label: v })));
          }
        })
        .catch(() => {});
    }

    loadModelsList();
  }, []);

  const loadModelsList = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.models) return;
    setLoadingModels(true);
    try {
      const list = await window.vanhsub.models.list();
      setModelsList(list || []);
    } catch (err) {
      console.error('Lỗi khi tải danh sách model:', err);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavedMessage('');
    setErrorMessage('');
    try {
      await Promise.all([
        window.vanhsub.settings.set('geminiApiKey', apiKey),
        window.vanhsub.settings.set('geminiModel', geminiModel),
        window.vanhsub.settings.set('targetLanguage', targetLanguage),
        window.vanhsub.settings.set('asrModel', asrModel),
        window.vanhsub.settings.set('exportDir', exportDir),
        window.vanhsub.settings.set('translateBatchSize', Number(translateBatchSize)),
        window.vanhsub.settings.set('autoTranslateAfterAsr', autoTranslateAfterAsr),
        window.vanhsub.settings.set('vietTtsEndpoint', vietTtsEndpoint.trim() || 'http://localhost:6006'),
        window.vanhsub.settings.set('ttsVoice', ttsVoice),
        window.vanhsub.settings.set('ttsSpeed', Number(ttsSpeed) || 1.0),
      ]);
      setSavedMessage('Đã lưu tất cả cài đặt thành công!');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể lưu cài đặt.');
    }
  };

  const handleChooseExportDir = async () => {
    try {
      const dir = await window.vanhsub.dialog.chooseDirectory();
      if (dir) {
        setExportDir(dir);
      }
    } catch (err) {
      console.error('Lỗi khi chọn thư mục:', err);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xoá model ASR "${modelName}" khỏi máy?`)) return;
    try {
      await window.vanhsub.models.delete(modelName);
      loadModelsList();
    } catch (err: any) {
      alert('Không thể xoá model: ' + (err?.message || err));
    }
  };

  const handleTestTtsConnection = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.tts?.checkConnection) return;
    setCheckingTts(true);
    try {
      // Lưu endpoint trước để kiểm tra đúng địa chỉ vừa nhập
      await window.vanhsub.settings.set('vietTtsEndpoint', vietTtsEndpoint.trim() || 'http://localhost:6006');
      const connected = await window.vanhsub.tts.checkConnection();
      setTtsConnected(connected);
    } catch {
      setTtsConnected(false);
    } finally {
      setCheckingTts(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 text-xs text-slate-300">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div>
          <h2 className="text-sm font-bold text-white">Cấu hình Hệ thống & Dịch vụ AI</h2>
          <p className="mt-0.5 text-slate-400">
            Quản lý API Key, thư mục lưu trữ, cấu hình model Whisper ASR và dịch thuật Gemini
          </p>
        </div>
        <button
          type="button"
          onClick={handleSaveSettings}
          className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer shadow-lg shadow-brand-indigo/20"
        >
          <Save className="h-4 w-4" />
          <span>Lưu cài đặt</span>
        </button>
      </div>

      {savedMessage && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 font-medium text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>{savedMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-300">
          {errorMessage}
        </div>
      )}

      {/* ASR Model Selector */}
      <ASRModelSelector 
        currentModel={asrModel}
        onModelChange={setAsrModel}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Khối 1: Gemini API Key */}
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-sm font-bold text-white">
            <Key className="h-4 w-4 text-brand-cyan" />
            <span>Gemini AI (Dịch thuật & Hiệu đính)</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-medium text-slate-200">Gemini API Key</label>
              <div className="flex gap-2">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white focus:border-brand-cyan focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-medium text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  {showApiKey ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Lấy API key miễn phí tại{' '}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-cyan underline hover:text-white"
                >
                  aistudio.google.com
                </a>
                . Key được mã hoá an toàn trên máy của bạn.
              </p>
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-200">Mô hình Gemini (Model)</label>
              <select
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
              >
                <option value="gemini-flash-latest">gemini-flash-latest (Khuyên dùng — tự động bản Flash mới nhất)</option>
                <option value="gemini-3.6-flash">gemini-3.6-flash</option>
                <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                <option value="gemini-pro-latest">gemini-pro-latest (Chính xác cao nhất)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="mb-1 block font-medium text-slate-200">Batch Size Dịch</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={translateBatchSize}
                  onChange={(e) => setTranslateBatchSize(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">Số câu / 1 request API</span>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-200">Ngôn ngữ đích mặc định</label>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="zh">Chinese</option>
                </select>
              </div>
            </div>

            <div className="pt-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTranslateAfterAsr}
                  onChange={(e) => setAutoTranslateAfterAsr(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                />
                <span className="text-xs text-slate-200">Tự động dịch ngay sau khi phiên âm (ASR) hoàn tất</span>
              </label>
            </div>
          </div>
        </div>

        {/* Khối 2: Cấu hình Chung & Xuất file */}
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-sm font-bold text-white">
            <Layers className="h-4 w-4 text-brand-indigo" />
            <span>Cấu hình Chung & Xuất file</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block font-medium text-slate-200">Thư mục xuất video mặc định</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={exportDir || 'Lưu cùng thư mục với video gốc (Mặc định)'}
                  className="flex-1 truncate rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-[11px] text-slate-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleChooseExportDir}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-brand-cyan" />
                  <span>Chọn</span>
                </button>
                {exportDir && (
                  <button
                    type="button"
                    onClick={() => setExportDir('')}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-400 hover:text-white cursor-pointer"
                    title="Đặt lại mặc định"
                  >
                    Mặc định
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-200">Model Whisper ASR mặc định</label>
              <select
                value={asrModel}
                onChange={(e) => setAsrModel(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
              >
                <option value="tiny">tiny (75MB - Nhanh nhất, độ chính xác vừa)</option>
                <option value="base">base (147MB - Cân bằng tốc độ & chính xác)</option>
                <option value="small">small (488MB - Chính xác cao hơn)</option>
                <option value="medium">medium (1.5GB - Tốt cho tiếng Việt phong phú)</option>
                <option value="large-v3">large-v3 (3GB - Tối đa độ chính xác)</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                Tự động tải model tương ứng khi khởi chạy lần đầu nếu chưa có trong máy.
              </p>
            </div>
          </div>
        </div>

        {/* Khối 3: Quản lý Model Whisper trên đĩa */}
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <HardDrive className="h-4 w-4 text-emerald-400" />
              <span>Model Whisper ASR đã lưu trên đĩa</span>
            </div>
            <button
              type="button"
              onClick={loadModelsList}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
              title="Làm mới"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? 'animate-spin text-brand-cyan' : ''}`} />
            </button>
          </div>

          {modelsList.length === 0 ? (
            <p className="py-4 text-center text-slate-500 text-xs">
              Chưa tìm thấy model offline nào đã tải. Khi bạn bắt đầu phiên âm task đầu tiên, app sẽ tự động tải model base.
            </p>
          ) : (
            <div className="space-y-2">
              {modelsList.map((m) => (
                <div
                  key={m.fileName}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <Cpu className="h-4 w-4 text-brand-cyan" />
                    <div>
                      <div className="font-semibold text-white">Model {m.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{m.fileName}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-medium text-slate-300">{m.size}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteModel(m.name)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition cursor-pointer"
                      title="Xoá model khỏi ổ đĩa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Khối 4: VietTTS Studio (Lồng tiếng) */}
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Mic className="h-4 w-4 text-brand-rose" />
              <span>Lồng tiếng VietTTS (TTS)</span>
            </div>
            <button
              type="button"
              onClick={handleTestTtsConnection}
              disabled={checkingTts}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingTts ? 'animate-spin text-brand-cyan' : ''}`} />
              <span>Kiểm tra kết nối</span>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block font-medium text-slate-200">Endpoint VietTTS</label>
              <input
                type="text"
                value={vietTtsEndpoint}
                onChange={(e) => {
                  setVietTtsEndpoint(e.target.value);
                  setTtsConnected(null);
                }}
                placeholder="http://localhost:6006"
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white focus:border-brand-cyan focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Server tương thích OpenAI chạy Docker local:{' '}
                <code className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-300">
                  docker run -p 6006:6006 vanhsub/viettts
                </code>
              </p>
              {ttsConnected !== null && (
                <p className={`mt-1.5 text-[11px] font-medium ${ttsConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {ttsConnected
                    ? '✓ Đã kết nối VietTTS thành công'
                    : '✗ Chưa kết nối được — kiểm tra Docker container và endpoint'}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-200">Giọng đọc mặc định</label>
                <select
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  {voiceOptions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-200">Tốc độ đọc mặc định</label>
                <select
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  {SPEED_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              Mặc định chỉ áp dụng cho task mới — có thể đổi riêng từng lần ở tab{' '}
              <strong className="text-slate-300">Lồng tiếng</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
