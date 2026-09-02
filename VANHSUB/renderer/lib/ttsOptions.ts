/**
 * Options dùng chung cho TTS (TTSPage + SettingsPage)
 */

export interface VoiceOption {
  value: string;
  label: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { value: 'alloy', label: 'Alloy (Trung tính)' },
  { value: 'echo', label: 'Echo (Nam)' },
  { value: 'fable', label: 'Fable (Kể chuyện)' },
  { value: 'onyx', label: 'Onyx (Sâu, lịch sự)' },
  { value: 'nova', label: 'Nova (Nữ, tươi sáng)' },
  { value: 'shimmer', label: 'Shimmer (Nữ, mềm mại)' },
];

export const SPEED_OPTIONS: { value: number; label: string }[] = [
  { value: 0.5, label: '0.5x (Rất chậm)' },
  { value: 0.75, label: '0.75x (Chậm)' },
  { value: 1.0, label: '1.0x (Bình thường)' },
  { value: 1.25, label: '1.25x (Nhanh)' },
  { value: 1.5, label: '1.5x (Rất nhanh)' },
  { value: 2.0, label: '2.0x (Siêu nhanh)' },
];

/** Nhãn hiển thị của 1 voice (fallback: tên gốc nếu voice không nằm trong danh sách) */
export function voiceLabel(value: string): string {
  return VOICE_OPTIONS.find((v) => v.value === value)?.label || value;
}

/** Nhãn hiển thị của 1 tốc độ (fallback: "1.37x") */
export function speedLabel(value: number): string {
  return SPEED_OPTIONS.find((s) => s.value === value)?.label || `${value}x`;
}
