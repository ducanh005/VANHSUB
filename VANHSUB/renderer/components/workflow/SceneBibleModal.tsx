import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Plus,
  Trash2,
  X,
  Palette,
  Check,
  Edit2,
  Sun,
  Moon,
  Building,
  TreePine,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

export interface SceneItem {
  id: string;
  name: string;
  description: string;
  referenceImages: string[];
  environment: 'indoor' | 'outdoor' | 'space';
  lightingMood: string;
  colorPalette?: string;
}

const DEFAULT_SCENES: SceneItem[] = [
  {
    id: 'scene-hanoi-cyberpunk',
    name: 'Chợ đêm Hà Nội tương lai (Cyberpunk)',
    description: 'Khu phố cổ ngập ánh đèn neon xanh tím phản chiếu trên mặt đường ướt mưa, hơi nước bốc lên từ quán ăn vỉa hè.',
    referenceImages: [],
    environment: 'outdoor',
    lightingMood: 'Moody neon cyan and amber, volumetric steam',
    colorPalette: 'cyberpunk',
  },
  {
    id: 'scene-quantum-lab',
    name: 'Phòng Thí nghiệm Lượng tử (Quantum Lab)',
    description: 'Phòng thí nghiệm công nghệ cao với màn hình holographic nổi, ánh sáng trắng xanh lạnh.',
    referenceImages: [],
    environment: 'indoor',
    lightingMood: 'Cold sci-fi blue, sterile studio lights',
    colorPalette: 'teal_orange',
  },
];

interface SceneBibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectScene?: (scene: SceneItem) => void;
}

export default function SceneBibleModal({
  isOpen,
  onClose,
  onSelectScene,
}: SceneBibleModalProps) {
  const [scenes, setScenes] = useState<SceneItem[]>(DEFAULT_SCENES);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<'indoor' | 'outdoor' | 'space'>('outdoor');
  const [lightingMood, setLightingMood] = useState('Cinematic daylight');
  const [colorPalette, setColorPalette] = useState('teal_orange');

  const loadScenes = async () => {
    if (typeof window !== 'undefined' && window.vanhsub?.bible?.getScenes) {
      try {
        const list = await window.vanhsub.bible.getScenes();
        if (list && list.length > 0) {
          setScenes(list);
        }
      } catch (err) {
        console.warn('Không tải được Scene Bible từ IPC:', err);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadScenes();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOpenAdd = () => {
    setIsEditing(true);
    setEditId(null);
    setName('');
    setDescription('');
    setEnvironment('outdoor');
    setLightingMood('Moody golden hour, soft cinematic sun flare');
    setColorPalette('teal_orange');
  };

  const handleOpenEdit = (s: SceneItem) => {
    setIsEditing(true);
    setEditId(s.id);
    setName(s.name);
    setDescription(s.description);
    setEnvironment(s.environment);
    setLightingMood(s.lightingMood);
    setColorPalette(s.colorPalette || 'teal_orange');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Vui lòng nhập tên bối cảnh');
      return;
    }

    const payload: Partial<SceneItem> & { name: string } = {
      ...(editId ? { id: editId } : {}),
      name: name.trim(),
      description: description.trim(),
      environment,
      lightingMood: lightingMood.trim(),
      colorPalette,
      referenceImages: [],
    };

    if (typeof window !== 'undefined' && window.vanhsub?.bible?.saveScene) {
      try {
        await window.vanhsub.bible.saveScene(payload);
        toast.success(editId ? 'Đã cập nhật bối cảnh' : 'Đã thêm bối cảnh mới vào Scene Bible');
        await loadScenes();
      } catch (err: any) {
        toast.error(`Lỗi khi lưu: ${err?.message || err}`);
      }
    } else {
      // Local state fallback
      if (editId) {
        setScenes((prev) =>
          prev.map((s) => (s.id === editId ? ({ ...s, ...payload } as SceneItem) : s))
        );
      } else {
        setScenes((prev) => [
          ...prev,
          {
            ...payload,
            id: `scene-${Date.now().toString(36)}`,
            referenceImages: [],
          } as SceneItem,
        ]);
      }
      toast.success('Đã lưu bối cảnh');
    }

    setIsEditing(false);
  };

  const handleDelete = async (id: string, sceneName: string) => {
    if (!confirm(`Bạn có chắc muốn xóa bối cảnh "${sceneName}"?`)) return;

    if (typeof window !== 'undefined' && window.vanhsub?.bible?.deleteScene) {
      await window.vanhsub.bible.deleteScene(id);
      await loadScenes();
    } else {
      setScenes((prev) => prev.filter((s) => s.id !== id));
    }
    toast.success('Đã xóa bối cảnh');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-950/80 border border-indigo-800/60 text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Scene Bible (Bối cảnh Không gian)
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-300 border border-indigo-800/40">
                  Environment Continuity
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Đồng bộ ánh sáng, bảng màu điện ảnh và môi trường giữa các phân cảnh
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isEditing && (
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-900/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm bối cảnh</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {isEditing ? (
            /* Form thêm / sửa bối cảnh */
            <form onSubmit={handleSave} className="space-y-4 max-w-xl mx-auto">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-sm font-bold text-slate-200">
                  {editId ? 'Chỉnh sửa Bối cảnh' : 'Thêm Bối cảnh mới'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Quay lại danh sách
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Tên bối cảnh *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Phố cổ Hà Nội, Phòng Lab Lượng tử..."
                  className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Môi trường
                  </label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as any)}
                    className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="indoor">Trong nhà (Indoor)</option>
                    <option value="outdoor">Ngoài trời (Outdoor)</option>
                    <option value="space">Vũ trụ / Giả tưởng (Space)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Bảng màu chủ đạo
                  </label>
                  <select
                    value={colorPalette}
                    onChange={(e) => setColorPalette(e.target.value)}
                    className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="teal_orange">Teal & Orange (Hollywood)</option>
                    <option value="cyberpunk">Cyberpunk Neon (Xanh/Hồng)</option>
                    <option value="noir">Vintage Noir (Đen trắng cổ điển)</option>
                    <option value="warm">Warm Earthy (Tông đất ấm cúng)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Mô tả không gian & kiến trúc
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả bối cảnh xung quanh để AI bảo toàn tính liên tục..."
                  className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-white focus:outline-none focus:border-indigo-500 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                  <Sun className="w-3 h-3 text-amber-400" />
                  <span>Ánh sáng & Tâm trạng (Lighting Mood)</span>
                </label>
                <input
                  type="text"
                  value={lightingMood}
                  onChange={(e) => setLightingMood(e.target.value)}
                  placeholder="Ví dụ: Hoàng hôn rực rỡ, ánh đèn neon sương mù mờ ảo..."
                  className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-300"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-900/30"
                >
                  Lưu Bối cảnh
                </button>
              </div>
            </form>
          ) : (
            /* Danh sách thẻ bối cảnh */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 hover:border-indigo-500/50 transition-all flex flex-col justify-between group relative overflow-hidden"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-indigo-950 border border-indigo-800/80 flex items-center justify-center text-indigo-400 shrink-0">
                          {scene.environment === 'indoor' ? (
                            <Building className="w-5 h-5" />
                          ) : (
                            <TreePine className="w-5 h-5" />
                          )}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white tracking-wide">
                            {scene.name}
                          </h4>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                            <span>{scene.environment === 'indoor' ? 'Trong nhà' : 'Ngoài trời'}</span>
                            <span>•</span>
                            <span className="capitalize">{scene.colorPalette || 'Standard'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenEdit(scene)}
                          className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                          title="Chỉnh sửa"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(scene.id, scene.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-rose-950/40"
                          title="Xóa"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                      {scene.description || 'Chưa có mô tả chi tiết.'}
                    </p>

                    <div className="pt-1 text-[11px] text-indigo-300 bg-indigo-950/40 px-2.5 py-1 rounded border border-indigo-900/50 truncate">
                      💡 {scene.lightingMood || 'Ánh sáng tự nhiên'}
                    </div>
                  </div>

                  {onSelectScene && (
                    <button
                      onClick={() => {
                        onSelectScene(scene);
                        onClose();
                      }}
                      className="mt-3 w-full py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      <span>Chọn cho Node hiện tại</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
