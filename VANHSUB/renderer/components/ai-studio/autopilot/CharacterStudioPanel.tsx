import React, { useRef } from 'react';
import {
  Sparkles,
  User,
  Lock,
  Palette,
  ShieldCheck,
  Lightbulb,
} from 'lucide-react';

export const STYLE_PRESETS = [
  {
    id: 'cinematic',
    name: 'Điện ảnh Chân thực',
    badge: 'Phổ biến',
    desc: 'Cinematic 35mm, ánh sáng kịch tính, chân thực chuẩn phim điện ảnh',
    sampleBg: 'Modern cinematic studio environment, atmospheric warm backlight, depth of field',
  },
  {
    id: 'anime_ghibli',
    name: 'Anime Ghibli',
    badge: 'Nghệ thuật',
    desc: 'Họa phong vẽ tay Miyazaki mộng mơ, màu sắc tươi sáng êm dịu',
    sampleBg: 'Idyllic countryside hillside with lush rolling green grass, vibrant wild flowers, blue sky with fluffy watercolor clouds',
  },
  {
    id: 'dark_fantasy',
    name: 'Dark Fantasy',
    badge: 'Huyền bí',
    desc: 'Kỳ ảo u tối, kiến trúc cổ gothic, sương mù ma mị huyền bí',
    sampleBg: 'Ancient ruined gothic cathedral cloaked in misty moonlight, weathered stone pillars, eerie floating embers',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Sci-Fi',
    badge: 'Khoa học',
    desc: 'Thành phố tương lai rực rỡ đèn neon, công nghệ viễn tưởng',
    sampleBg: 'Rain-slicked futuristic Neo-Tokyo street at midnight, glowing neon signs in violet and cyan, towering holographic billboards',
  },
  {
    id: 'history_doc',
    name: 'Tài liệu Lịch sử',
    badge: 'Chân thực',
    desc: 'Phong cách phóng sự National Geographic, trang phục bối cảnh lịch sử chuẩn xác',
    sampleBg: 'Authentic historical ancient workshop with rustic wooden workbenches, parchment scrolls, dust motes in soft light',
  },
  {
    id: '3d_pixar',
    name: '3D Pixar CGI',
    badge: '3D Vui nhộn',
    desc: 'Hoạt hình 3D phong cách Disney/Pixar, tươi sáng, biểu cảm sống động',
    sampleBg: 'Cozy whimsical studio room with colorful wooden furniture, warm ambient lighting, cute stylized props',
  },
];

export interface CharacterStudioPanelProps {
  hostName: string;
  hostDescription: string;
  hostAvatarUrl?: string;
  onUpdateHostName: (name: string) => void;
  onUpdateHostDescription: (desc: string) => void;
  onUploadAvatar: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAvatar: () => void;
  onAiGenerateHost: () => void;
  channelCharacters: Array<{ id: string; name: string; descriptionEn?: string }>;
  newCharName: string;
  newCharDesc: string;
  onNewCharNameChange: (val: string) => void;
  onNewCharDescChange: (val: string) => void;
  onAddCharacter: () => void;
  onRemoveCharacter: (index: number) => void;
  visualArtStylePreset?: string;
  onSelectStylePreset: (preset: (typeof STYLE_PRESETS)[0]) => void;
  projectBackgroundPrompt: string;
  onUpdateBackgroundPrompt: (prompt: string) => void;
  onAiSuggestBackground: () => void;
  hostToast: string | null;
}

export const CharacterStudioPanel: React.FC<CharacterStudioPanelProps> = ({
  hostName,
  hostDescription,
  hostAvatarUrl,
  onUpdateHostName,
  onUpdateHostDescription,
  onUploadAvatar,
  onRemoveAvatar,
  onAiGenerateHost,
  channelCharacters = [],
  newCharName,
  newCharDesc,
  onNewCharNameChange,
  onNewCharDescChange,
  onAddCharacter,
  onRemoveCharacter,
  visualArtStylePreset,
  onSelectStylePreset,
  projectBackgroundPrompt,
  onUpdateBackgroundPrompt,
  onAiSuggestBackground,
  hostToast,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-4">
      {/* Toast thông báo host */}
      {hostToast && (
        <div className="rounded-md border border-amber-500/40 bg-amber-950/40 px-3.5 py-2 text-xs text-amber-200 animate-in fade-in duration-200 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span>{hostToast}</span>
        </div>
      )}

      {/* Box 1: Nhân vật đại diện kênh */}
      <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-amber-400 font-bold text-xs flex items-center gap-1.5">
            <span>⭐</span> Nhân vật đại diện kênh
          </span>
          <span className="text-[11px] text-text-muted flex items-center gap-1">
            <Lock className="h-3 w-3" /> Cố định — không tự sinh lại
          </span>
        </div>

        <p className="text-xs text-text-muted leading-relaxed">
          Xuất hiện LỚN ở thumbnail và trong video, giúp kênh dễ nhận diện. Kênh không cần thì bỏ trống.
        </p>

        {/* Avatar thumbnail preview if available */}
        {hostAvatarUrl ? (
          <div className="flex items-center gap-3 p-2.5 rounded-md border border-border bg-[#070B14]">
            <img
              src={hostAvatarUrl}
              alt="Host Avatar"
              className="h-12 w-12 rounded-md object-cover border border-amber-500/40"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {hostName || 'Host đại diện kênh'}
              </p>
              <p className="text-[11px] text-text-muted line-clamp-1">
                {hostDescription || 'Chưa có mô tả ngoại hình'}
              </p>
            </div>
            <button
              type="button"
              onClick={onRemoveAvatar}
              className="text-[11px] text-rose-400 hover:underline px-2 cursor-pointer"
            >
              Gỡ ảnh
            </button>
          </div>
        ) : (
          <p className="text-xs text-text-muted italic">
            Chưa có nhân vật đại diện. Import ảnh của bạn hoặc để AI tạo.
          </p>
        )}

        {/* Inputs: Tên host & Mô tả host để AI tạo */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <div className="sm:col-span-4">
            <input
              type="text"
              placeholder="Tên host"
              value={hostName}
              onChange={(e) => onUpdateHostName(e.target.value)}
              className="w-full rounded-lg border border-border bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-text-faint focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-8">
            <input
              type="text"
              placeholder="Mô tả host để AI tạo (vd: một chú sói đội mũ, mặc vest, phong cách điện ảnh)"
              value={hostDescription}
              onChange={(e) => onUpdateHostDescription(e.target.value)}
              className="w-full rounded-lg border border-border bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-text-faint focus:border-orange-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Action Buttons: Tải ảnh lên & AI tạo host */}
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={onUploadAvatar}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-border bg-[#162032] hover:bg-[#1E2B43] px-4 py-2 text-xs font-semibold text-text transition cursor-pointer"
          >
            Tải ảnh lên
          </button>
          <button
            type="button"
            onClick={onAiGenerateHost}
            className="rounded-lg bg-[#FA5252] hover:bg-[#e04545] px-4 py-2 text-xs font-bold text-white transition shadow cursor-pointer"
          >
            AI tạo host
          </button>
        </div>
      </div>

      {/* Box 2: Đồng bộ Nhân vật ↔ Cảnh */}
      <div className="rounded-lg border border-amber-950/40 bg-[#151312]/70 p-4 text-xs text-text leading-relaxed">
        <span className="font-bold text-amber-300">Đồng bộ Nhân vật ↔ Cảnh:</span>{' '}
        tạo/khoá ảnh nhân vật một lần ở đây (upload ảnh thật{' '}
        <span className="font-semibold text-white">hoặc</span> để Flow tự sinh khi sản xuất) —
        mọi cảnh có nhân vật đó sẽ dùng đúng ảnh này làm <i>ingredient</i> nên khuôn mặt/trang
        phục nhất quán. AI cũng tự thêm nhân vật mới khi đọc kịch bản.
      </div>

      {/* Box 3: + Thêm nhân vật cho kênh */}
      <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3">
        <h4 className="text-xs font-bold text-text">+ Thêm nhân vật cho kênh</h4>

        <div className="flex flex-col sm:flex-row items-center gap-2">
          <input
            type="text"
            placeholder="Tên (vd: Host)"
            value={newCharName}
            onChange={(e) => onNewCharNameChange(e.target.value)}
            className="w-full sm:w-1/3 rounded-lg border border-border bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-text-faint focus:border-orange-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Mô tả ngoại hình (tiếng Anh tốt hơn cho sinh ảnh)"
            value={newCharDesc}
            onChange={(e) => onNewCharDescChange(e.target.value)}
            className="w-full sm:flex-1 rounded-lg border border-border bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-text-faint focus:border-orange-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onAddCharacter}
            className="w-full sm:w-auto rounded-lg bg-[#FA5252] hover:bg-[#e04545] px-4 py-2 text-xs font-bold text-white shadow transition cursor-pointer"
          >
            Thêm
          </button>
        </div>

        {/* Character List / Empty state */}
        {channelCharacters.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-[#080C14] p-4 text-center text-xs text-text-muted">
            Chưa có nhân vật. Thêm ở trên (vd người dẫn cố định), hoặc cứ sản xuất — AI sẽ tự rút
            nhân vật từ kịch bản.
          </div>
        ) : (
          <div className="space-y-2">
            {channelCharacters.map((char, idx) => (
              <div
                key={char.id || idx}
                className="flex items-center justify-between rounded-md border border-border bg-[#070B14] p-2.5 text-xs"
              >
                <div>
                  <span className="font-bold text-white">{char.name}</span>
                  {char.descriptionEn && (
                    <span className="text-text-muted ml-2 text-[11px]">
                      ({char.descriptionEn})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveCharacter(idx)}
                  className="text-text-muted hover:text-rose-400 p-1 text-xs transition cursor-pointer"
                  title="Xoá nhân vật"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Box 4: Phong cách Bối cảnh & Không gian Thị giác Toàn Dự Án */}
      <div className="rounded-lg border border-indigo-900/50 bg-[#0B101E] p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
              <Palette className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-bold text-indigo-300">
              Phong cách Bối cảnh & Không gian Thị giác Toàn Dự Án
            </span>
          </div>
          <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Cố định cho Storyboard & Video
          </span>
        </div>

        <p className="text-xs text-text-muted leading-relaxed">
          AI sẽ tự động áp dụng bối cảnh và định hướng mỹ thuật này vào <span className="text-text font-semibold">TẤT CẢ</span> các phân cảnh Storyboard, kết hợp nhất quán với ngoại hình/trang phục của nhân vật đã thiết lập ở trên.
        </p>

        {/* Style Presets Grid */}
        <div>
          <label className="text-[11px] font-semibold text-text-muted block mb-1.5">
            Chọn phong cách mỹ thuật mẫu (Preset):
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {STYLE_PRESETS.map((preset) => {
              const isSelected = visualArtStylePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectStylePreset(preset)}
                  className={`flex flex-col items-start p-2.5 rounded-md border text-left transition cursor-pointer ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/50'
                      : 'border-border bg-[#070B14] hover:border-border hover:bg-[#0e1526]'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={`text-xs font-bold ${isSelected ? 'text-indigo-300' : 'text-text'}`}>
                      {preset.name}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-medium">
                      {preset.badge}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted mt-1 line-clamp-1">
                    {preset.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Background Prompt Textarea */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-text">
              Prompt bối cảnh & không gian mỹ thuật của toàn bộ dự án:
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onAiSuggestBackground}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline cursor-pointer"
                title="Tự động gợi ý bối cảnh từ ngách và chủ đề video"
              >
                <Sparkles className="h-3 w-3" /> AI gợi ý theo Kịch bản / Kênh
              </button>
              {projectBackgroundPrompt && (
                <button
                  type="button"
                  onClick={() => onUpdateBackgroundPrompt('')}
                  className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                >
                  Xoá
                </button>
              )}
            </div>
          </div>
          <textarea
            rows={3}
            placeholder="Nhập mô tả bối cảnh để AI cố định cho mọi khung hình (vd: Modern dark sci-fi control room with panoramic space view, volumetric cyan lighting, cinematic photorealistic 8k...)"
            value={projectBackgroundPrompt}
            onChange={(e) => onUpdateBackgroundPrompt(e.target.value)}
            className="w-full rounded-md border border-border bg-[#070B14] p-3 text-xs text-white placeholder:text-text-faint focus:border-indigo-500 focus:outline-none leading-relaxed resize-y"
          />
        </div>

        {/* Explanation of prompt composition */}
        <div className="rounded-md border border-indigo-950/40 bg-[#070B16] p-2.5 text-[11px] text-text-muted flex items-start gap-2">
          <Lightbulb className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-text">Công thức ghép Prompt Storyboard:</strong>{' '}
            <code className="text-indigo-300">[Phong cách nghệ thuật]</code> +{' '}
            <code className="text-accent">[Góc máy & Hành động]</code> +{' '}
            <code className="text-amber-300">[Ngoại hình nhân vật]</code> +{' '}
            <code className="text-emerald-300">in [Bối cảnh dự án]</code> +{' '}
            <code className="text-text-muted">[8k, photorealistic]</code>
          </span>
        </div>
      </div>
    </div>
  );
};

export default CharacterStudioPanel;
