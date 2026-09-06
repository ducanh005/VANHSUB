import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  FolderOpen,
  Globe2,
  HardDrive,
  Key,
  Languages,
  Layers,
  Loader2,
  Mic,
  RefreshCw,
  Save,
  ScanText,
  Trash2,
  Zap,
} from 'lucide-react';
import ASRModelSelector from './ASRModelSelector';
import { VOICE_OPTIONS, SPEED_OPTIONS } from '../lib/ttsOptions';

interface ModelInfo {
  name: string;
  fileName: string;
  size: string;
  filePath: string;
}

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-flash-latest');
  const [targetLanguage, setTargetLanguage] = useState('vi');
  const [asrModel, setAsrModel] = useState('base');
  const [exportDir, setExportDir] = useState('');
  const [translateBatchSize, setTranslateBatchSize] = useState(15);
  const [translateConcurrency, setTranslateConcurrency] = useState(1);
  const [autoTranslateAfterAsr, setAutoTranslateAfterAsr] = useState(false);
  const [vietTtsEndpoint, setVietTtsEndpoint] = useState('http://localhost:6006');
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [ocrLanguage, setOcrLanguage] = useState('vie');
  const [ocrFps, setOcrFps] = useState(2);
  const [ocrRegion, setOcrRegion] = useState<'bottom' | 'full'>('bottom');
  const [glossary, setGlossary] = useState('');
  const [translationStyleGuide, setTranslationStyleGuide] = useState('');
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
      window.vanhsub.settings.get('translateConcurrency'),
      window.vanhsub.settings.get('autoTranslateAfterAsr'),
      window.vanhsub.settings.get('vietTtsEndpoint'),
      window.vanhsub.settings.get('ttsVoice'),
      window.vanhsub.settings.get('ttsSpeed'),
      window.vanhsub.settings.get('ocrLanguage'),
      window.vanhsub.settings.get('ocrFps'),
      window.vanhsub.settings.get('ocrRegion'),
      window.vanhsub.settings.get('glossary'),
      window.vanhsub.settings.get('translationStyleGuide'),
    ])
      .then(([key, gModel, lang, aModel, expDir, batchSize, autoTrans, ttsEndpoint, voice, spd, oLang, oFps, oRegion, glossaryVal, styleVal]) => {
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
        if (oLang) setOcrLanguage(String(oLang));
        if (oFps) setOcrFps(Number(oFps) || 2);
        if (oRegion) setOcrRegion(oRegion === 'full' ? 'full' : 'bottom');
        if (glossaryVal !== undefined) setGlossary(String(glossaryVal || ''));
        if (styleVal !== undefined) setTranslationStyleGuide(String(styleVal || ''));
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
      const [list, dir] = await Promise.all([
        window.vanhsub.models.list(),
        window.vanhsub.models.directory?.() ?? Promise.resolve(null),
      ]);
      setModelsList(list || []);
      if (dir) setModelsDir(dir);
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
        window.vanhsub.settings.set('translateConcurrency', Math.min(8, Math.max(1, Math.round(Number(translateConcurrency) || 1)))),
        window.vanhsub.settings.set('autoTranslateAfterAsr', autoTranslateAfterAsr),
        window.vanhsub.settings.set('vietTtsEndpoint', vietTtsEndpoint.trim() || 'http://localhost:6006'),
        window.vanhsub.settings.set('ttsVoice', ttsVoice),
        window.vanhsub.settings.set('ttsSpeed', Number(ttsSpeed) || 1.0),
        window.vanhsub.settings.set('ocrLanguage', ocrLanguage),
        window.vanhsub.settings.set('ocrFps', Math.min(5, Math.max(0.5, Number(ocrFps) || 2))),
        window.vanhsub.settings.set('ocrRegion', ocrRegion),
        window.vanhsub.settings.set('glossary', glossary),
        window.vanhsub.settings.set('translationStyleGuide', translationStyleGuide),
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

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="mb-1 block font-medium text-slate-200">Số request dịch song song</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={translateConcurrency}
                  onChange={(e) => setTranslateConcurrency(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">
                  1 = lần lượt (an toàn với rate limit) — tăng để dịch nhanh hơn
                </span>
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
                <option value="large-v3-turbo">large-v3-turbo (1.6GB - Gần bằng large, nhanh gấp nhiều lần)</option>
                <option value="large">large (2.9GB - Tối đa độ chính xác, rất chậm trên CPU)</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                Mặc định cho task mới — từng task vẫn chọn được model riêng ở tab Phụ đề &amp; ASR.
                Model nào chưa có trên máy sẽ tự tải khi phiên âm đầu tiên (xem vị trí lưu ở khối bên dưới).
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

          {/* Model đang dùng mặc định + trạng thái tải */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-cyan/30 bg-brand-cyan/5 px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <Cpu className="h-4 w-4 text-brand-cyan" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Model đang dùng mặc định (cho task mới)
                </div>
                <div className="font-mono text-sm font-semibold text-white">whisper {asrModel}</div>
              </div>
            </div>
            {modelsList.some((m) => m.name === asrModel) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Đã tải trên máy
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                Chưa tải — tự tải khi phiên âm đầu tiên
              </span>
            )}
          </div>

          {/* Vị trí lưu model trên đĩa */}
          {modelsDir && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Vị trí lưu model
                </span>
                <button
                  type="button"
                  onClick={() => window.vanhsub.dialog.showInFolder(modelsDir.path)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition cursor-pointer"
                  title="Mở thư mục chứa model trong Explorer"
                >
                  <FolderOpen className="h-3 w-3" />
                  <span>Mở thư mục</span>
                </button>
              </div>
              <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-slate-400" title={modelsDir.path}>
                {modelsDir.path}
                {!modelsDir.exists && (
                  <span className="text-amber-400"> — thư mục sẽ được tạo khi tải model đầu tiên</span>
                )}
              </p>
            </div>
          )}

          {modelsList.length === 0 ? (
            <p className="py-4 text-center text-slate-500 text-xs">
              Chưa tìm thấy model offline nào đã tải. Khi bạn bắt đầu phiên âm task đầu tiên, app sẽ tự động tải model base.
            </p>
          ) : (
            <div className="space-y-2">
              {modelsList.map((m) => {
                const isCurrent = m.name === asrModel;
                return (
                  <div
                    key={m.fileName}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                      isCurrent ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800 bg-slate-950'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Cpu className={`h-4 w-4 ${isCurrent ? 'text-emerald-400' : 'text-brand-cyan'}`} />
                      <div>
                        <div className="flex items-center gap-2 font-semibold text-white">
                          Model {m.name}
                          {isCurrent && (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                              Đang dùng
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500" title={m.filePath}>
                          {m.fileName}
                        </div>
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
                );
              })}
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

        {/* Khối 5: OCR — quét phụ đề cứng trong video */}
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-sm font-bold text-white">
            <ScanText className="h-4 w-4 text-brand-cyan" />
            <span>Quét phụ đề cứng (OCR)</span>
          </div>

          <div className="space-y-4">
            <p className="text-[11px] text-slate-400">
              Trích phụ đề đã ghẽ sẵn trong khung hình video thành file .srt. Lần quét đầu tiên
              cần internet để tải gói ngôn ngữ (~15MB), sau đó lưu offline trong máy.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-200">Ngôn ngữ quét</label>
                <select
                  value={ocrLanguage}
                  onChange={(e) => setOcrLanguage(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="vie">Tiếng Việt</option>
                  <option value="eng">English</option>
                  <option value="vie+eng">Việt + Anh (song ngữ)</option>
                  <option value="jpn">Japanese</option>
                  <option value="kor">Korean</option>
                  <option value="chi_sim">Chinese (Giản thể)</option>
                  <option value="chi_tra">Chinese (Phồn thể)</option>
                  <option value="tha">Thai</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-200">Vùng quét phụ đề</label>
                <select
                  value={ocrRegion}
                  onChange={(e) => setOcrRegion(e.target.value === 'full' ? 'full' : 'bottom')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="bottom">Đáy khung hình (Khuyên dùng)</option>
                  <option value="full">Toàn khung hình</option>
                </select>
                <span className="text-[10px] text-slate-400">Đổi sang "Toàn khung" nếu phụ đề nằm giữa màn hình</span>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-200">Số khung quét mỗi giây</label>
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.5}
                value={ocrFps}
                onChange={(e) => setOcrFps(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white focus:outline-none"
              />
              <span className="text-[10px] text-slate-400">
                2 khung/giây là cân bằng tốc độ — độ chính xác (quét chậm hơn nhưng đỡ sót dòng)
              </span>
            </div>

            <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
              <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan" />
              <span>
                Nút <strong className="text-slate-300">Quét OCR</strong> nằm ở tab{' '}
                <strong className="text-slate-300">Phụ đề &amp; ASR</strong>, cạnh nút Nhập SRT.
              </span>
            </p>
          </div>
        </div>
        {/* Khối 6: Nhất quán bản dịch (Glossary & Văn phong) */}
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-sm font-bold text-white">
            <Languages className="h-4 w-4 text-brand-rose" />
            <span>Nhất quán bản dịch (Glossary &amp; Văn phong)</span>
          </div>

          <div className="space-y-4">
            <p className="text-[11px] text-slate-400">
              Hai mục này được đưa thẳng vào prompt khi dịch bằng Gemini — áp dụng cho toàn bộ
              video, giữ tên riêng / thuật ngữ / cách xưng hô đồng nhất từ đầu đến cuối.
            </p>

            <div>
              <label className="mb-1 block font-medium text-slate-200">
                Bảng thuật ngữ — mỗi dòng: <code className="font-mono text-[10px] text-brand-cyan">gốc = bản dịch</code>
              </label>
              <textarea
                rows={5}
                value={glossary}
                onChange={(e) => setGlossary(e.target.value)}
                placeholder={'Ví dụ:\nLý Bạch = Lý Bạch\nsword = kiếm\nTiên Đế = Thiên Đế\ngiemony = Zhen Mon'}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white placeholder:text-slate-600 focus:border-brand-cyan focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-200">Văn phong &amp; xưng hô (tự do)</label>
              <textarea
                rows={4}
                value={translationStyleGuide}
                onChange={(e) => setTranslationStyleGuide(e.target.value)}
                placeholder={'Ví dụ:\n- Văn phong cổ trang, trang trọng\n- Vua tự xưng "trẫm", kẻ dưới gọi vua là "bệ hạ"\n- Hai kẻ thù xưng hô "tao/mày", người quen xưng "tôi/cậu"'}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-brand-cyan focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
