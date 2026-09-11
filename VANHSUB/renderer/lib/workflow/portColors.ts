import type { PortDataType, NodeCategory } from '../../types/workflow';

export interface PortStyle {
  color: string;
  bg: string;
  border: string;
  glow: string;
  label: string;
}

export const PORT_STYLES: Record<PortDataType, PortStyle> = {
  text: {
    color: '#34d399', // emerald-400
    bg: '#064e3b',
    border: '#059669',
    glow: 'rgba(52, 211, 153, 0.4)',
    label: 'Văn bản (Text)',
  },
  image: {
    color: '#c084fc', // purple-400
    bg: '#581c87',
    border: '#9333ea',
    glow: 'rgba(192, 132, 252, 0.4)',
    label: 'Hình ảnh (Image)',
  },
  video: {
    color: '#fbbf24', // amber-400
    bg: '#78350f',
    border: '#d97706',
    glow: 'rgba(251, 191, 36, 0.4)',
    label: 'Video',
  },
  audio: {
    color: '#38bdf8', // sky-400
    bg: '#0c4a6e',
    border: '#0284c7',
    glow: 'rgba(56, 189, 248, 0.4)',
    label: 'Âm thanh (Audio)',
  },
  character_ref: {
    color: '#fb7185', // rose-400
    bg: '#881337',
    border: '#e11d48',
    glow: 'rgba(251, 113, 133, 0.4)',
    label: 'Nhân vật (Character Ref)',
  },
  scene_ref: {
    color: '#818cf8', // indigo-400
    bg: '#312e81',
    border: '#4f46e5',
    glow: 'rgba(129, 140, 248, 0.4)',
    label: 'Bối cảnh (Scene Ref)',
  },
  any: {
    color: '#94a3b8', // slate-400
    bg: '#1e293b',
    border: '#475569',
    glow: 'rgba(148, 163, 184, 0.4)',
    label: 'Đa năng (Any)',
  },
};

export interface CategoryStyle {
  label: string;
  badgeBg: string;
  badgeText: string;
  headerBg: string;
  borderColor: string;
  glowColor: string;
}

export const CATEGORY_STYLES: Record<NodeCategory, CategoryStyle> = {
  input: {
    label: 'Dữ liệu vào (Input)',
    badgeBg: 'bg-emerald-950/80',
    badgeText: 'text-emerald-400',
    headerBg: 'from-emerald-900/60 to-emerald-950/30',
    borderColor: 'border-emerald-600/40',
    glowColor: 'rgba(16, 185, 129, 0.2)',
  },
  model: {
    label: 'Mô hình AI (Model)',
    badgeBg: 'bg-purple-950/80',
    badgeText: 'text-purple-400',
    headerBg: 'from-purple-900/60 to-indigo-950/30',
    borderColor: 'border-purple-600/40',
    glowColor: 'rgba(168, 85, 247, 0.25)',
  },
  control: {
    label: 'Điều khiển (Control)',
    badgeBg: 'bg-amber-950/80',
    badgeText: 'text-amber-400',
    headerBg: 'from-amber-900/60 to-amber-950/30',
    borderColor: 'border-amber-600/40',
    glowColor: 'rgba(245, 158, 11, 0.2)',
  },
  consistency: {
    label: 'Nhất quán (Consistency)',
    badgeBg: 'bg-rose-950/80',
    badgeText: 'text-rose-400',
    headerBg: 'from-rose-900/60 to-rose-950/30',
    borderColor: 'border-rose-600/40',
    glowColor: 'rgba(244, 63, 94, 0.2)',
  },
  editing: {
    label: 'Hậu kỳ (Editing)',
    badgeBg: 'bg-sky-950/80',
    badgeText: 'text-sky-400',
    headerBg: 'from-sky-900/60 to-sky-950/30',
    borderColor: 'border-sky-600/40',
    glowColor: 'rgba(14, 165, 233, 0.2)',
  },
  output: {
    label: 'Đầu ra (Output)',
    badgeBg: 'bg-yellow-950/80',
    badgeText: 'text-yellow-400',
    headerBg: 'from-yellow-900/60 to-amber-950/30',
    borderColor: 'border-yellow-600/40',
    glowColor: 'rgba(234, 179, 8, 0.25)',
  },
  logic: {
    label: 'Logic & Luồng',
    badgeBg: 'bg-slate-900/80',
    badgeText: 'text-slate-400',
    headerBg: 'from-slate-800/60 to-slate-900/30',
    borderColor: 'border-slate-600/40',
    glowColor: 'rgba(148, 163, 184, 0.2)',
  },
};
