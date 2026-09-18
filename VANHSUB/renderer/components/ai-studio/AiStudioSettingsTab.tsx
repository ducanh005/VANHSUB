import React, { useState, useEffect } from 'react';
import {
  Save,
  RotateCcw,
  Sparkles,
  Mic,
  Film,
  Video,
  Subtitles,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Settings,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type {
  AiStudioConfig,
  LlmProviderType,
  VoiceProviderType,
  FlowAspectRatio,
  RenderResolution,
  SubtitlePreset,
} from '../../types/aiStudio';

export default function AiStudioSettingsTab() {
  const { config, updateConfig, resetConfig, isLoading, isSaving } =
    useAiStudioStore();

  const [form, setForm] = useState<AiStudioConfig>(config);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // ChatGPT Web Automation status state
  const [chatGptStatus, setChatGptStatus] = useState<{
    isLoggedIn: boolean;
    userEmail?: string;
  } | null>(null);
  const [isCheckingChatGpt, setIsCheckingChatGpt] = useState(false);
  const [isOpeningChatGptLogin, setIsOpeningChatGptLogin] = useState(false);

  // Gemini Web Automation status state
  const [geminiStatus, setGeminiStatus] = useState<{
    isLoggedIn: boolean;
    userEmail?: string;
  } | null>(null);
  const [isCheckingGemini, setIsCheckingGemini] = useState(false);
  const [isOpeningGeminiLogin, setIsOpeningGeminiLogin] = useState(false);

  const checkChatGptStatus = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.checkChatGptLogin) return;
    setIsCheckingChatGpt(true);
    try {
      const res = await window.vanhsub.aiStudio.checkChatGptLogin();
      setChatGptStatus(res);
    } catch {
      setChatGptStatus({ isLoggedIn: false });
    } finally {
      setIsCheckingChatGpt(false);
    }
  };

  const handleOpenChatGptLogin = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.openChatGptLogin) return;
    setIsOpeningChatGptLogin(true);
    try {
      await window.vanhsub.aiStudio.openChatGptLogin();
      await checkChatGptStatus();
    } finally {
      setIsOpeningChatGptLogin(false);
    }
  };

  const checkGeminiStatus = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.checkGeminiLogin) return;
    setIsCheckingGemini(true);
    try {
      const res = await window.vanhsub.aiStudio.checkGeminiLogin();
      setGeminiStatus(res);
    } catch {
      setGeminiStatus({ isLoggedIn: false });
    } finally {
      setIsCheckingGemini(false);
    }
  };

  const handleOpenGeminiLogin = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.openGeminiLogin) return;
    setIsOpeningGeminiLogin(true);
    try {
      await window.vanhsub.aiStudio.openGeminiLogin();
      await checkGeminiStatus();
    } finally {
      setIsOpeningGeminiLogin(false);
    }
  };

  useEffect(() => {
    setForm(config);
    if (config.llm.provider === 'chatgpt_web') {
      checkChatGptStatus();
    } else if (config.llm.provider === 'gemini_web') {
      checkGeminiStatus();
    }
  }, [config]);

  useEffect(() => {
    if (form.llm.provider === 'chatgpt_web') {
      checkChatGptStatus();
    } else if (form.llm.provider === 'gemini_web') {
      checkGeminiStatus();
    }
  }, [form.llm.provider]);

  const handleSave = async () => {
    try {
      await updateConfig(form);
      setSaveMessage('Đã lưu cấu hình AI Studio thành công!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      setSaveMessage(`Lỗi: ${err?.message || 'Không thể lưu'}`);
    }
  };

  const handleReset = async () => {
    if (window.confirm('Bạn có chắc muốn khôi phục toàn bộ cấu hình AI Studio về mặc định?')) {
      await resetConfig();
      setSaveMessage('Đã khôi phục cài đặt mặc định.');
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6 text-slate-200">
      <div className="mb-6 flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-cyan" />
            Cấu hình Phân hệ AI Video Studio
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Kho lưu trữ cấu hình riêng biệt, độc lập hoàn toàn với cài đặt chung của Vanhsub.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
              <CheckCircle2 className="h-4 w-4" />
              {saveMessage}
            </span>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Khôi phục mặc định
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="btn-vanh-gradient flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-brand-cyan/20 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* 1. LLM Settings */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-slate-800/80 pb-3">
            <Sparkles className="h-4 w-4 text-brand-cyan" />
            <h3 className="text-sm font-semibold text-white">1. Mô hình Ngôn ngữ (LLM Script)</h3>
          </div>
          <div className="space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-medium text-slate-300">Nhà cung cấp (Provider)</label>
              <select
                value={form.llm.provider}
                onChange={(e) =>
                  setForm({
                    ...form,
                    llm: { ...form.llm, provider: e.target.value as LlmProviderType },
                  })
                }
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
              >
                <option value="chatgpt_web">⚡ ChatGPT Web (Chế độ Tiết kiệm — Miễn phí 100% token)</option>
                <option value="gemini_web">⚡ Gemini Web (Chế độ Tiết kiệm — Miễn phí 100% token)</option>
                <option value="deepseek">DeepSeek (Khuyến nghị API - Siêu rẻ, nhạy bén)</option>
                <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                <option value="custom">Custom Endpoint (OpenAI-compatible)</option>
              </select>
            </div>

            {form.llm.provider === 'chatgpt_web' ? (
              <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-emerald-300">Trạng thái ChatGPT Web:</span>
                  {chatGptStatus?.isLoggedIn ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/30">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã đăng nhập
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/30">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Chưa đăng nhập
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenChatGptLogin}
                    disabled={isOpeningChatGptLogin}
                    className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 px-3 text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-emerald-900/30"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isOpeningChatGptLogin ? 'Đang mở cửa sổ...' : 'Đăng nhập ChatGPT Web'}
                  </button>
                  <button
                    type="button"
                    onClick={checkChatGptStatus}
                    disabled={isCheckingChatGpt}
                    className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 px-3 text-xs transition cursor-pointer"
                  >
                    {isCheckingChatGpt ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.llm.chatgptWebMode === 'visible'}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: {
                            ...form.llm,
                            chatgptWebMode: e.target.checked ? 'visible' : 'offscreen',
                          },
                        })
                      }
                      className="rounded border-slate-700 bg-slate-900 text-brand-cyan focus:ring-brand-cyan"
                    />
                    <span>Xem trực tiếp AI gõ chữ (Mở cửa sổ Live trên màn hình)</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-1 pl-5">
                    Mặc định: Chạy ngầm trong nền (Offscreen) hoàn toàn không che khuất màn hình.
                  </p>
                </div>

                <p className="text-[11px] text-emerald-400/90 leading-relaxed">
                  💡 <strong>Chế độ Tiết kiệm (Zero API Cost):</strong> Tự động hóa tài khoản ChatGPT miễn phí trên trình duyệt qua phiên lưu trữ vĩnh viễn. Không cần thẻ tín dụng, không mất phí API token.
                </p>
              </div>
            ) : form.llm.provider === 'gemini_web' ? (
              <div className="space-y-3 rounded-xl border border-blue-500/30 bg-blue-950/20 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-blue-300">Trạng thái Gemini Web (Google):</span>
                  {geminiStatus?.isLoggedIn ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-md border border-blue-500/30">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã đăng nhập
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/30">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Chưa đăng nhập
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenGeminiLogin}
                    disabled={isOpeningGeminiLogin}
                    className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-3 text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-blue-900/30"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isOpeningGeminiLogin ? 'Đang mở cửa sổ...' : 'Đăng nhập Gemini Web'}
                  </button>
                  <button
                    type="button"
                    onClick={checkGeminiStatus}
                    disabled={isCheckingGemini}
                    className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 px-3 text-xs transition cursor-pointer"
                  >
                    {isCheckingGemini ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.llm.geminiWebMode === 'visible'}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: {
                            ...form.llm,
                            geminiWebMode: e.target.checked ? 'visible' : 'offscreen',
                          },
                        })
                      }
                      className="rounded border-slate-700 bg-slate-900 text-brand-cyan focus:ring-brand-cyan"
                    />
                    <span>Xem trực tiếp AI gõ chữ (Mở cửa sổ Live trên màn hình)</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-1 pl-5">
                    Mặc định: Chạy ngầm trong nền (Offscreen) hoàn toàn không che khuất màn hình.
                  </p>
                </div>

                <p className="text-[11px] text-blue-400/90 leading-relaxed">
                  💡 <strong>Chế độ Tiết kiệm Gemini (Zero API Cost):</strong> Tự động hóa tài khoản Gemini của bạn tại <code>gemini.google.com</code> qua phiên đăng nhập Google lưu vĩnh viễn trên máy.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block font-medium text-slate-300">API Key</label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={form.llm.apiKey}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: { ...form.llm, apiKey: e.target.value },
                        })
                      }
                      placeholder="sk-..."
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 pr-10 text-slate-200 focus:border-brand-cyan focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Khóa được mã hoá an toàn DPAPI khi lưu trữ trên máy.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block font-medium text-slate-300">Model</label>
                    <input
                      type="text"
                      value={form.llm.model}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: { ...form.llm, model: e.target.value },
                        })
                      }
                      placeholder="deepseek-chat"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-slate-300">Độ sáng tạo (Temp: {form.llm.temperature})</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={form.llm.temperature}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: { ...form.llm, temperature: parseFloat(e.target.value) },
                        })
                      }
                      className="mt-2 w-full accent-brand-cyan"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 2. TTS & Voice Settings */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-slate-800/80 pb-3">
            <Mic className="h-4 w-4 text-brand-cyan" />
            <h3 className="text-sm font-semibold text-white">2. Giọng đọc & Lồng tiếng (Edge TTS)</h3>
          </div>
          <div className="space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-medium text-slate-300">Giọng đọc tiếng Việt</label>
              <select
                value={form.voice.voiceId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    voice: { ...form.voice, voiceId: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
              >
                <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ — Truyền cảm, tự nhiên)</option>
                <option value="vi-VN-NamMinhNeural">Nam Minh (Nam — Trầm ấm, đĩnh đạc)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-300">Tốc độ đọc</label>
                <select
                  value={form.voice.rate}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      voice: { ...form.voice, rate: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
                >
                  <option value="-15%">-15% (Chậm rãi)</option>
                  <option value="-5%">-5% (Vừa phải)</option>
                  <option value="+0%">+0% (Chuẩn)</option>
                  <option value="+10%">+10% (Hơi nhanh)</option>
                  <option value="+20%">+20% (Nhanh - TikTok)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-300">Trích xuất Time từng từ</label>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="autoWordAlignment"
                    checked={form.voice.autoWordAlignment}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        voice: { ...form.voice, autoWordAlignment: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded accent-brand-cyan"
                  />
                  <label htmlFor="autoWordAlignment" className="text-slate-300 cursor-pointer">
                    Bật Word-boundary
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Google Flow Engine Settings */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-slate-800/80 pb-3">
            <Film className="h-4 w-4 text-brand-cyan" />
            <h3 className="text-sm font-semibold text-white">3. Google Flow Engine (Ảnh/Video)</h3>
          </div>
          <div className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-300">Tỷ lệ khung hình</label>
                <select
                  value={form.flowEngine.aspectRatio}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      flowEngine: { ...form.flowEngine, aspectRatio: e.target.value as FlowAspectRatio },
                    })
                  }
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
                >
                  <option value="16:9">16:9 (YouTube ngang)</option>
                  <option value="9:16">9:16 (TikTok / Reels)</option>
                  <option value="1:1">1:1 (Vuông)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-300">Chế độ đầu ra</label>
                <select
                  value={form.flowEngine.outputMode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      flowEngine: { ...form.flowEngine, outputMode: e.target.value as any },
                    })
                  }
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
                >
                  <option value="image">Ảnh tĩnh + Ken Burns Motion</option>
                  <option value="video">Video chuyển động</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-300">Tiền tố phong cách (Style Prefix)</label>
              <input
                type="text"
                value={form.flowEngine.stylePromptPrefix}
                onChange={(e) =>
                  setForm({
                    ...form,
                    flowEngine: { ...form.flowEngine, stylePromptPrefix: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-300">Negative Prompt</label>
              <input
                type="text"
                value={form.flowEngine.negativePrompt}
                onChange={(e) =>
                  setForm({
                    ...form,
                    flowEngine: { ...form.flowEngine, negativePrompt: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 4. Rendering & Subtitle Settings */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-slate-800/80 pb-3">
            <Video className="h-4 w-4 text-brand-cyan" />
            <h3 className="text-sm font-semibold text-white">4. Dựng phim (FFmpeg) & Phụ đề</h3>
          </div>
          <div className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-300">Độ phân giải</label>
                <select
                  value={form.rendering.resolution}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rendering: { ...form.rendering, resolution: e.target.value as RenderResolution },
                    })
                  }
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
                >
                  <option value="1080p">1080p (Full HD)</option>
                  <option value="720p">720p (Nhanh)</option>
                  <option value="4k">4K (Ultra HD)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-300">Kiểu hiển thị phụ đề</label>
                <select
                  value={form.subtitles.preset}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      subtitles: { ...form.subtitles, preset: e.target.value as SubtitlePreset },
                    })
                  }
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-brand-cyan focus:outline-none"
                >
                  <option value="tiktok_bold">TikTok Bold (Chữ to nổi bật)</option>
                  <option value="minimalist">Minimalist (Tinh gọn, thanh lịch)</option>
                  <option value="karaoke_glow">Karaoke Glow (Phát sáng)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-slate-300">
                  Âm lượng nhạc nền ({Math.round(form.rendering.bgmVolume * 100)}%)
                </label>
                <input
                  type="range"
                  min="0.05"
                  max="0.30"
                  step="0.01"
                  value={form.rendering.bgmVolume}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rendering: { ...form.rendering, bgmVolume: parseFloat(e.target.value) },
                    })
                  }
                  className="mt-2 w-full accent-brand-cyan"
                />
              </div>

              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="kenBurns"
                    checked={form.rendering.kenBurnsEffect}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rendering: { ...form.rendering, kenBurnsEffect: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded accent-brand-cyan"
                  />
                  <label htmlFor="kenBurns" className="text-slate-300 cursor-pointer">
                    Hiệu ứng Ken Burns (Zoom/Pan)
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="audioDucking"
                    checked={form.rendering.autoAudioDucking}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rendering: { ...form.rendering, autoAudioDucking: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded accent-brand-cyan"
                  />
                  <label htmlFor="audioDucking" className="text-slate-300 cursor-pointer">
                    Hạ nhạc nền khi nói (Ducking)
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
