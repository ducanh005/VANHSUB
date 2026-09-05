/**
 * Options dùng chung cho TTS (TTSPage + SettingsPage)
 */

export interface VoiceOption {
  value: string;
  label: string;
}

/**
 * Fallback khi server VietTTS không phản hồi.
 * Khi server chạy, danh sách voice được lấy động từ endpoint /v1/voices.
 */
export const VOICE_OPTIONS: VoiceOption[] = [
  { value: 'son-tung-mtp', label: 'Sơn Tùng M-TP (Nam)' },
  { value: 'nguyen-ngoc-ngan', label: 'Nguyễn Ngọc Ngạn (Nam)' },
  { value: 'quynh', label: 'Quỳnh (Nữ)' },
  { value: 'diep-chi', label: 'Diệp Chi (Nữ)' },
  { value: 'nu-nhe-nhang', label: 'Nữ nhẹ nhàng' },
  { value: 'cdteam', label: 'CD Team (Nam)' },
  { value: 'doremon', label: 'Doremon (Hoạt hình)' },
  { value: 'speechify_1', label: 'Speechify 1' },
  { value: 'speechify_2', label: 'Speechify 2' },
  { value: 'speechify_3', label: 'Speechify 3' },
  { value: 'speechify_4', label: 'Speechify 4' },
  { value: 'speechify_5', label: 'Speechify 5' },
  { value: 'speechify_6', label: 'Speechify 6' },
  { value: 'speechify_7', label: 'Speechify 7' },
  { value: 'speechify_8', label: 'Speechify 8' },
  { value: 'speechify_9', label: 'Speechify 9' },
  { value: 'speechify_10', label: 'Speechify 10' },
  { value: 'speechify_11', label: 'Speechify 11' },
  { value: 'speechify_12', label: 'Speechify 12' },
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
