/**
 * Cờ huỷ dùng chung cho các runner (dịch, TTS, …).
 *
 * Cơ chế: runner giữ Set id đang bị yêu cầu huỷ; vòng lặp xử lý kiểm tra
 * qua callback shouldStop giữa các đơn vị việc (batch dịch, dòng phụ đề)
 * và throw CancelledError. Huỷ mang tính hợp tác — đơn vị việc đang chạy
 * (1 request Gemini, 1 câu TTS) sẽ chạy xong rồi mới dừng.
 */

export const CANCELLED_MESSAGE = 'Đã huỷ bởi người dùng';

export class CancelledError extends Error {
  constructor() {
    super(CANCELLED_MESSAGE);
    this.name = 'CancelledError';
  }
}

export function isCancelledError(err: unknown): boolean {
  return err instanceof Error && err.message === CANCELLED_MESSAGE;
}
