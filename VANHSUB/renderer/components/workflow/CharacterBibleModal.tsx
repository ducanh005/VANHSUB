import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Lock,
  Sparkles,
  X,
  Camera,
  Check,
  Edit2,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

export interface CharacterItem {
  id: string;
  name: string;
  description: string;
  referenceImages: string[];
  gender: 'male' | 'female' | 'other';
  ageGroup?: string;
  lockedSeed?: number;
}

const DEFAULT_CHARS: CharacterItem[] = [
  {
    id: 'char-agent-vanh',
    name: 'Điệp viên Vanh',
    description: 'Nam mật vụ người Việt, áo khoác măng-tô sẫm màu, ánh mắt tập trung sắc bén.',
    referenceImages: [],
    gender: 'male',
    ageGroup: '28 tuổi',
    lockedSeed: 424242,
  },
  {
    id: 'char-dr-lan-anh',
    name: 'Tiến sĩ Lan Anh',
    description: 'Nữ tiến sĩ công nghệ lượng tử, kính cận thanh lịch, áo blouse trắng hiện đại.',
    referenceImages: [],
    gender: 'female',
    ageGroup: '30 tuổi',
    lockedSeed: 108108,
  },
];

interface CharacterBibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCharacter?: (character: CharacterItem) => void;
}

export default function CharacterBibleModal({
  isOpen,
  onClose,
  onSelectCharacter,
}: CharacterBibleModalProps) {
  const [characters, setCharacters] = useState<CharacterItem[]>(DEFAULT_CHARS);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');
  const [ageGroup, setAgeGroup] = useState('25-30');
  const [lockedSeed, setLockedSeed] = useState<number | undefined>(424242);
  const [refImage, setRefImage] = useState('');

  const loadCharacters = async () => {
    if (typeof window !== 'undefined' && window.vanhsub?.bible?.getCharacters) {
      try {
        const list = await window.vanhsub.bible.getCharacters();
        if (list && list.length > 0) {
          setCharacters(list);
        }
      } catch (err) {
        console.warn('Không tải được danh sách Character Bible từ IPC:', err);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCharacters();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOpenAdd = () => {
    setIsEditing(true);
    setEditId(null);
    setName('');
    setDescription('');
    setGender('male');
    setAgeGroup('25-30');
    setLockedSeed(Math.floor(Math.random() * 899999) + 100000);
    setRefImage('');
  };

  const handleOpenEdit = (c: CharacterItem) => {
    setIsEditing(true);
    setEditId(c.id);
    setName(c.name);
    setDescription(c.description);
    setGender(c.gender);
    setAgeGroup(c.ageGroup || '25-30');
    setLockedSeed(c.lockedSeed);
    setRefImage(c.referenceImages?.[0] || '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Vui lòng nhập tên nhân vật');
      return;
    }

    const payload: Partial<CharacterItem> & { name: string } = {
      ...(editId ? { id: editId } : {}),
      name: name.trim(),
      description: description.trim(),
      gender,
      ageGroup,
      lockedSeed,
      referenceImages: refImage ? [refImage] : [],
    };

    if (typeof window !== 'undefined' && window.vanhsub?.bible?.saveCharacter) {
      try {
        await window.vanhsub.bible.saveCharacter(payload);
        toast.success(editId ? 'Đã cập nhật nhân vật' : 'Đã thêm nhân vật mới vào Character Bible');
        await loadCharacters();
      } catch (err: any) {
        toast.error(`Lỗi khi lưu: ${err?.message || err}`);
      }
    } else {
      // Local state fallback
      if (editId) {
        setCharacters((prev) =>
          prev.map((c) => (c.id === editId ? ({ ...c, ...payload } as CharacterItem) : c))
        );
      } else {
        setCharacters((prev) => [
          ...prev,
          {
            ...payload,
            id: `char-${Date.now().toString(36)}`,
            referenceImages: payload.referenceImages || [],
          } as CharacterItem,
        ]);
      }
      toast.success('Đã lưu nhân vật');
    }

    setIsEditing(false);
  };

  const handleDelete = async (id: string, charName: string) => {
    if (!confirm(`Bạn có chắc muốn xóa nhân vật "${charName}"?`)) return;

    if (typeof window !== 'undefined' && window.vanhsub?.bible?.deleteCharacter) {
      await window.vanhsub.bible.deleteCharacter(id);
      await loadCharacters();
    } else {
      setCharacters((prev) => prev.filter((c) => c.id !== id));
    }
    toast.success('Đã xóa nhân vật');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/60 text-rose-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Character Bible (Hồ sơ Nhân vật)
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-900/40 text-rose-300 border border-rose-800/40">
                  Consistency Lock
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Lưu trữ định danh khuôn mặt, trang phục và hạt giống Seed nhất quán xuyên suốt các Shot
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isEditing && (
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-900/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm nhân vật</span>
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
            /* Form thêm / sửa nhân vật */
            <form onSubmit={handleSave} className="space-y-4 max-w-xl mx-auto">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-sm font-bold text-slate-200">
                  {editId ? 'Chỉnh sửa Hồ sơ Nhân vật' : 'Thêm Nhân vật mới'}
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
                  Tên nhân vật *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Điệp viên Vanh, Tiến sĩ Lan Anh..."
                  className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Giới tính
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as any)}
                    className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                  >
                    <option value="male">Nam</option>
                    <option value="female">Nữ</option>
                    <option value="other">Khác</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Độ tuổi / Nhận diện
                  </label>
                  <input
                    type="text"
                    value={ageGroup}
                    onChange={(e) => setAgeGroup(e.target.value)}
                    placeholder="Ví dụ: 28 tuổi, trung niên..."
                    className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Mô tả ngoại hình & trang phục đặc trưng
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả khuôn mặt, kiểu tóc, trang phục giúp AI giữ nguyên hình ảnh..."
                  className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-white focus:outline-none focus:border-rose-500 leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-rose-400" />
                    <span>Locked Seed (Cố định hạt giống)</span>
                  </label>
                  <input
                    type="number"
                    value={lockedSeed ?? ''}
                    onChange={(e) => setLockedSeed(parseInt(e.target.value) || undefined)}
                    placeholder="Ví dụ: 424242"
                    className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white font-mono focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Camera className="w-3 h-3 text-rose-400" />
                    <span>URL Ảnh chân dung tham chiếu</span>
                  </label>
                  <input
                    type="text"
                    value={refImage}
                    onChange={(e) => setRefImage(e.target.value)}
                    placeholder="Dán đường dẫn ảnh hoặc URL..."
                    className="w-full text-xs rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
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
                  className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-900/30"
                >
                  Lưu Nhân vật
                </button>
              </div>
            </form>
          ) : (
            /* Danh sách thẻ nhân vật */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {characters.map((char) => (
                <div
                  key={char.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 hover:border-rose-500/50 transition-all flex flex-col justify-between group relative overflow-hidden"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-full bg-rose-950 border border-rose-800/80 flex items-center justify-center font-bold text-sm text-rose-300 shrink-0">
                          {char.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white tracking-wide">
                            {char.name}
                          </h4>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                            <span>{char.gender === 'male' ? 'Nam' : 'Nữ'}</span>
                            <span>•</span>
                            <span>{char.ageGroup || '25-30'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenEdit(char)}
                          className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                          title="Chỉnh sửa"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(char.id, char.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-rose-950/40"
                          title="Xóa"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                      {char.description || 'Chưa có mô tả chi tiết.'}
                    </p>

                    <div className="flex items-center gap-2 pt-1 text-[10px] font-mono text-slate-400">
                      <span className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        <Lock className="w-2.5 h-2.5 text-rose-400" />
                        <span>Seed: {char.lockedSeed || 'Auto'}</span>
                      </span>
                      <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        ID: {char.id}
                      </span>
                    </div>
                  </div>

                  {onSelectCharacter && (
                    <button
                      onClick={() => {
                        onSelectCharacter(char);
                        onClose();
                      }}
                      className="mt-3 w-full py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/80 text-slate-200 hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1"
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
