import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Sparkles,
  Layers,
  AlertCircle,
  Clock,
  CheckCircle2,
  Trash2,
  HelpCircle,
  Maximize2,
  Tag,
  Hash,
  Play,
  Users,
  Building,
  ShieldCheck,
  X,
  Coins,
  FolderOpen,
} from 'lucide-react';
import { useWorkflowStore } from '../../lib/store/workflowStore';
import { NODE_DEFINITIONS } from '../../lib/workflow/nodeRegistry';
import { CATEGORY_STYLES } from '../../lib/workflow/portColors';
import { calculateNodeCreditEstimate } from '../../lib/workflow/creditCalculator';
import type { ConfigFieldSchema, NodeCategory } from '../../types/workflow';

export interface InspectorProps {
  onClose?: () => void;
}

export default function Inspector({ onClose }: InspectorProps = {}) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode);
  const runningNodeId = useWorkflowStore((s) => s.runningNodeId);

  const [bibleCharacters, setBibleCharacters] = useState<any[]>([]);
  const [bibleScenes, setBibleScenes] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.bible) {
      window.vanhsub.bible.getCharacters().then((chars) => {
        if (chars) setBibleCharacters(chars);
      }).catch(() => {});

      window.vanhsub.bible.getScenes().then((sc) => {
        if (sc) setBibleScenes(sc);
      }).catch(() => {});
    }
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <aside className="w-80 h-full bg-[#0d131f]/95 border-l border-slate-800/80 flex flex-col p-6 items-center justify-center text-center text-slate-500 select-none relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            title="Thu gọn Bảng Điều khiển"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600 mb-3 shadow-inner">
          <Sliders className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Bảng Điều khiển (Inspector)</h3>
        <p className="text-xs text-slate-400 max-w-[220px] leading-relaxed">
          Bấm chọn một node bất kỳ trên canvas để xem và tinh chỉnh các tham số cấu hình.
        </p>
      </aside>
    );
  }

  const def = NODE_DEFINITIONS[selectedNode.data.nodeType];
  const category = (def?.category || selectedNode.data.category || 'logic') as NodeCategory;
  const catStyle = CATEGORY_STYLES[category] || CATEGORY_STYLES.logic;
  const configSchema = def?.configSchema || {};
  const configValues = selectedNode.data.config || {};
  const runtime = selectedNode.data.runtime;
  const outputData = runtime?.outputData;
  const creditEst = calculateNodeCreditEstimate(selectedNode.data.nodeType, configValues);

  const handleFieldChange = (fieldKey: string, value: any) => {
    updateNodeConfig(selectedNode.id, fieldKey, value);
  };

  const handleSelectCharacterFromBible = (charId: string) => {
    const char = bibleCharacters.find((c) => c.id === charId);
    if (!char) return;
    updateNodeConfig(selectedNode.id, 'characterName', char.name);
    if (char.description) {
      updateNodeConfig(selectedNode.id, 'description', char.description);
    }
    if (char.referenceImages?.[0]) {
      updateNodeConfig(selectedNode.id, 'referenceImageUrl', char.referenceImages[0]);
    }
    if (char.gender) updateNodeConfig(selectedNode.id, 'gender', char.gender);
    if (char.ageGroup) updateNodeConfig(selectedNode.id, 'ageGroup', char.ageGroup);
  };

  const handleSelectSceneFromBible = (sceneId: string) => {
    const scene = bibleScenes.find((s) => s.id === sceneId);
    if (!scene) return;
    updateNodeConfig(selectedNode.id, 'sceneName', scene.name);
    if (scene.description) {
      updateNodeConfig(selectedNode.id, 'description', scene.description);
    }
    if (scene.environment) updateNodeConfig(selectedNode.id, 'environment', scene.environment);
    if (scene.lightingMood) updateNodeConfig(selectedNode.id, 'lightingMood', scene.lightingMood);
    if (scene.colorPalette) updateNodeConfig(selectedNode.id, 'colorPalette', scene.colorPalette);
  };

  const handlePickFile = async (fieldKey: string, schema: ConfigFieldSchema) => {
    const isVideoField =
      fieldKey.toLowerCase().includes('video') ||
      Boolean(schema.label && schema.label.toLowerCase().includes('video'));
    const isAudioField =
      fieldKey.toLowerCase().includes('audio') ||
      Boolean(schema.label && schema.label.toLowerCase().includes('audio'));

    try {
      if (typeof window !== 'undefined' && window.vanhsub?.dialog) {
        if (isVideoField) {
          if (window.vanhsub.dialog.openVideoFile) {
            const filePath = await window.vanhsub.dialog.openVideoFile();
            if (filePath) handleFieldChange(fieldKey, filePath);
            return;
          }
          const files = await window.vanhsub.dialog.openMediaFile();
          if (files && files.length > 0) {
            handleFieldChange(fieldKey, files[0]);
            return;
          }
        } else if (isAudioField) {
          const files = await window.vanhsub.dialog.openMediaFile();
          if (files && files.length > 0) {
            handleFieldChange(fieldKey, files[0]);
            return;
          }
        } else {
          // Mặc định là file hình ảnh
          const filePath = await window.vanhsub.dialog.openImageFile();
          if (filePath) {
            handleFieldChange(fieldKey, filePath);
            return;
          }
        }
      } else {
        // Fallback input cho web
        const input = document.createElement('input');
        input.type = 'file';
        if (isVideoField) input.accept = 'video/*';
        else if (isAudioField) input.accept = 'audio/*';
        else input.accept = 'image/*';

        input.onchange = (e: any) => {
          const file = e.target.files?.[0];
          if (file) {
            const path = (file as any).path || URL.createObjectURL(file);
            handleFieldChange(fieldKey, path);
          }
        };
        input.click();
      }
    } catch (err) {
      console.warn('Lỗi khi mở hộp thoại chọn file:', err);
    }
  };

  return (
    <aside className="w-84 h-full bg-[#0d131f]/95 border-l border-slate-800/80 flex flex-col overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-900/50">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${catStyle.badgeBg} ${catStyle.badgeText} uppercase tracking-wider`}>
            {catStyle.label}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => removeNode(selectedNode.id)}
              title="Xóa node này"
              className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setSelectedNodeId(null);
                if (onClose) onClose();
              }}
              title="Đóng Bảng Điều khiển (Ẩn panel)"
              className="p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <h2 className="text-base font-bold text-white tracking-wide truncate">
          {selectedNode.data.label || def?.label || selectedNode.data.nodeType}
        </h2>
        <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
          {def?.description || 'Không có mô tả cho node này.'}
        </p>

        {/* Node ID & Type tag */}
        <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-slate-800/60 text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-1">
            <Hash className="w-3 h-3 text-slate-500" />
            <span>{selectedNode.id}</span>
          </div>
          <div className="flex items-center gap-1">
            <Tag className="w-3 h-3 text-slate-500" />
            <span>{def?.type || selectedNode.data.nodeType}</span>
          </div>
        </div>

        {/* Run Node Action Bar (Phong cách Weavy.ai / Flow Studio) */}
        <div className="mt-3.5 pt-3 border-t border-slate-800/80">
          <button
            type="button"
            onClick={() => runSingleNode(selectedNode.id)}
            disabled={runtime?.status === 'running'}
            className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer ${
              runtime?.status === 'running'
                ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 animate-pulse'
                : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-950/50 hover:shadow-indigo-600/30 border border-indigo-400/30'
            }`}
          >
            {runtime?.status === 'running' ? (
              <>
                <Clock className="w-4 h-4 animate-spin text-amber-400" />
                <span>Đang thực thi node {runtime.progress ? `(${runtime.progress}%)` : '...'}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Chạy node này (Run Node)</span>
              </>
            )}
          </button>

          {/* Execution Status Tag */}
          <div className="flex items-center justify-between mt-2 px-1 text-[11px]">
            <span className="text-slate-400">Trạng thái:</span>
            <div className="flex items-center gap-1.5">
              {runtime?.status === 'running' && (
                <span className="text-amber-400 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3 animate-spin" /> Đang xử lý
                </span>
              )}
              {runtime?.status === 'success' && (
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Hoàn tất {runtime.durationMs ? `(${(runtime.durationMs / 1000).toFixed(1)}s)` : ''}
                </span>
              )}
              {runtime?.status === 'failed' && (
                <span className="text-rose-400 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Thất bại
                </span>
              )}
              {(!runtime?.status || runtime.status === 'idle') && (
                <span className="text-slate-500 font-mono">Chưa chạy (Idle)</span>
              )}
              {runtime?.status === 'queued' && (
                <span className="text-sky-400 font-mono">Đang chờ (Queued)</span>
              )}
            </div>
          </div>

          {/* Error display if failed */}
          {runtime?.status === 'failed' && runtime?.error && (
            <div className="mt-2 p-2 rounded bg-rose-950/70 border border-rose-800/80 text-[11px] text-rose-300 leading-tight">
              {runtime.error}
            </div>
          )}
        </div>
      </div>

      {/* QC Check Report Card (Nếu là node qc-check) */}
      {selectedNode.data.nodeType === 'qc-check' && outputData?.similarityScore !== undefined && (
        <div className="m-3 p-3.5 rounded-xl border bg-slate-900/90 border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-rose-400" />
              <span>Báo Cáo Kiểm Định QC</span>
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                outputData.status === 'pass'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : outputData.status === 'warn'
                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                  : 'bg-rose-950 text-rose-300 border border-rose-800'
              }`}
            >
              {outputData.status === 'pass' ? 'ĐẠT (PASS)' : outputData.status === 'warn' ? 'CẢNH BÁO' : 'TRƯỢT (FAIL)'}
            </span>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Điểm tương đồng:</span>
              <span className="font-mono font-bold text-emerald-400">
                {outputData.similarityScore}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, outputData.similarityScore)}%` }}
              />
            </div>

            {outputData.colorDelta !== undefined && (
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-slate-400">Độ lệch màu:</span>
                <span className="font-mono font-bold text-slate-300">
                  {outputData.colorDelta}%
                </span>
              </div>
            )}
          </div>

          {outputData.details && (
            <p className="text-[11px] text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 leading-relaxed font-sans">
              {outputData.details}
            </p>
          )}
        </div>
      )}

      {/* Runtime Status Card if active */}
      {runtime && runtime.status !== 'idle' && selectedNode.data.nodeType !== 'qc-check' && (
        <div className="m-3 p-3 rounded-lg border bg-slate-900/90 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-400">Trạng thái render:</span>
            {runtime.status === 'running' && (
              <span className="flex items-center gap-1 text-amber-400 font-semibold">
                <Clock className="w-3.5 h-3.5 animate-spin" /> Đang chạy {runtime.progress ? `(${runtime.progress}%)` : ''}
              </span>
            )}
            {runtime.status === 'success' && (
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Thành công
              </span>
            )}
            {runtime.status === 'failed' && (
              <span className="flex items-center gap-1 text-rose-400 font-semibold">
                <AlertCircle className="w-3.5 h-3.5" /> Thất bại
              </span>
            )}
          </div>
          {runtime.error && (
            <p className="text-[11px] text-rose-300 font-mono bg-rose-950/60 p-2 rounded border border-rose-900/50">
              {runtime.error}
            </p>
          )}
        </div>
      )}

      {/* Dynamic Form Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
        {/* Quick select from Character Bible */}
        {(selectedNode.data.nodeType === 'character-ref' || selectedNode.data.nodeType === 'character-lock') && (
          <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-rose-400" />
                <span>Chọn từ Character Bible:</span>
              </span>
            </div>
            <select
              onChange={(e) => handleSelectCharacterFromBible(e.target.value)}
              value={bibleCharacters.find((c) => c.name === configValues.characterName)?.id || ''}
              className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
            >
              <option value="" disabled>-- Chọn hồ sơ nhân vật có sẵn --</option>
              {bibleCharacters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.gender === 'male' ? 'Nam' : 'Nữ'}, {c.ageGroup})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quick select from Scene Bible */}
        {(selectedNode.data.nodeType === 'scene-ref' || selectedNode.data.nodeType === 'scene-continuity') && (
          <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-800/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-indigo-400" />
                <span>Chọn từ Scene Bible:</span>
              </span>
            </div>
            <select
              onChange={(e) => handleSelectSceneFromBible(e.target.value)}
              value={bibleScenes.find((s) => s.name === configValues.sceneName)?.id || ''}
              className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="" disabled>-- Chọn bối cảnh có sẵn --</option>
              {bibleScenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.environment})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Free Image Generation Card for google-imagen */}
        {selectedNode.data.nodeType === 'google-imagen' && (
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/60 space-y-2 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-emerald-200 block">Sinh Ảnh Google Imagen 3</span>
                  <span className="text-[10px] text-slate-400">Ảnh tĩnh Keyframe & Storyboard</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold font-mono text-emerald-300 bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/60">
                  FREE (0 Credit)
                </span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Tạo ảnh tĩnh bằng Imagen 3 được <b>miễn phí hoàn toàn (0đ)</b> trên Google Labs. Bạn có thể sinh ảnh thoải mái mà không lo bị trừ credit video!
            </p>
          </div>
        )}

        {/* Pre-generation Credit & Cost Estimation Card */}
        {creditEst.credits > 0 && (
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-amber-950/40 to-slate-900 border border-amber-800/60 space-y-2.5 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-amber-200 block">Dự Tính Tiêu Tốn Credit</span>
                  <span className="text-[10px] text-slate-400">Trước khi sinh video</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold font-mono text-amber-300 block">
                  ~{creditEst.credits} Credits
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  ~${creditEst.costUsd} USD
                </span>
              </div>
            </div>

            <div className="text-[11px] p-2.5 rounded-lg bg-black/50 border border-slate-800 font-mono text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Model:</span>
                <span className="text-indigo-300 font-semibold">{creditEst.modelLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Thời lượng:</span>
                <span>{configValues.durationSeconds || 5}s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Chế độ chất lượng:</span>
                <span className={configValues.qualityPreset === 'quality' ? 'text-purple-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                  {configValues.qualityPreset === 'quality' ? 'Quality (Nét cao)' : 'Lite (Tiết kiệm)'}
                </span>
              </div>
            </div>

            {selectedNode.data.nodeType === 'google-flow-video' && (
              <p className="text-[10px] text-slate-400 leading-relaxed">
                💡 <span className="text-slate-300">Gợi ý:</span> Chọn <b>Veo 3.1 Lite</b> để tiết kiệm ~65% credit khi test shot; chọn <b>Veo 3.1 Quality</b> khi render phim chính thức.
              </p>
            )}
          </div>
        )}

        {Object.keys(configSchema).length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            Node này không có tham số cấu hình bổ sung.
          </div>
        ) : (
          Object.entries(configSchema).map(([fieldKey, schema]: [string, ConfigFieldSchema]) => {
            const currentValue = configValues[fieldKey] !== undefined ? configValues[fieldKey] : schema.defaultValue;

            return (
              <div key={fieldKey} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    {schema.label}
                  </label>
                  {schema.type === 'slider' && (
                    <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-800/60">
                      {currentValue}
                    </span>
                  )}
                </div>

                {schema.description && (
                  <p className="text-[11px] text-slate-400 leading-tight">
                    {schema.description}
                  </p>
                )}

                {/* Form Field Switcher */}
                {schema.type === 'textarea' ? (
                  <textarea
                    rows={4}
                    value={currentValue || ''}
                    placeholder={schema.placeholder}
                    onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                    className="w-full text-xs font-sans rounded-lg bg-slate-950/80 border border-slate-800 p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 leading-relaxed resize-y"
                  />
                ) : schema.type === 'string' ? (
                  <input
                    type="text"
                    value={currentValue || ''}
                    placeholder={schema.placeholder}
                    onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                    className="w-full text-xs rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                ) : schema.type === 'number' ? (
                  <input
                    type="number"
                    value={currentValue ?? ''}
                    onChange={(e) => handleFieldChange(fieldKey, parseFloat(e.target.value) || 0)}
                    className="w-full text-xs rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                ) : schema.type === 'slider' ? (
                  <div className="space-y-1 pt-1">
                    <input
                      type="range"
                      min={schema.min ?? 0}
                      max={schema.max ?? 100}
                      step={schema.step ?? 1}
                      value={currentValue ?? (schema.min ?? 0)}
                      onChange={(e) => handleFieldChange(fieldKey, parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>{schema.min}</span>
                      <span>{schema.max}</span>
                    </div>
                  </div>
                ) : schema.type === 'select' ? (
                  <select
                    value={currentValue}
                    onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                    className="w-full text-xs rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                  >
                    {schema.options?.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-slate-900 text-slate-200">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : schema.type === 'boolean' ? (
                  <label className="flex items-center gap-3 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 cursor-pointer hover:bg-slate-900 transition-colors">
                    <input
                      type="checkbox"
                      checked={Boolean(currentValue)}
                      onChange={(e) => handleFieldChange(fieldKey, e.target.checked)}
                      className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs text-slate-300 select-none">
                      {Boolean(currentValue) ? 'Đang bật' : 'Đang tắt'}
                    </span>
                  </label>
                ) : schema.type === 'file' ? (
                  <div className="space-y-2">
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="Nhập đường dẫn file hoặc dán URL..."
                        value={currentValue || ''}
                        onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                        className="flex-1 min-w-0 text-xs rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => handlePickFile(fieldKey, schema)}
                        title="Chọn file từ máy tính"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shrink-0 transition-all shadow-sm cursor-pointer active:scale-95"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Chọn file</span>
                      </button>
                    </div>

                    {currentValue ? (
                      <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/80 p-2 rounded-lg border border-slate-800/80">
                        <span className="truncate max-w-[170px] font-mono text-[10px] text-slate-300" title={currentValue}>
                          📁 {String(currentValue).split(/[\\/]/).pop()}
                        </span>
                        <div className="flex items-center gap-2 shrink-0 text-[10px]">
                          {typeof window !== 'undefined' && window?.vanhsub?.dialog?.showInFolder && !String(currentValue).startsWith('http') && (
                            <button
                              type="button"
                              onClick={() => window.vanhsub?.dialog?.showInFolder?.(currentValue)}
                              className="text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer"
                            >
                              Mở thư mục
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleFieldChange(fieldKey, '')}
                            className="text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 text-[11px] text-slate-500 flex items-center justify-between">
        <span>Tự động đồng bộ với Graph</span>
        <span className="text-indigo-400 font-mono text-[10px]">React Flow v12</span>
      </div>
    </aside>
  );
}
