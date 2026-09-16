import * as fs from 'fs';
import * as crypto from 'crypto';

export type DetectedMediaType = 'png' | 'jpeg' | 'webp' | 'mp4' | 'webm' | 'html_or_json' | 'unknown';

export interface MediaVerificationOptions {
  /**
   * Định dạng media mong đợi ('image', 'video', 'png', 'jpeg', 'webp', 'mp4', 'webm')
   */
  expectedType?: 'image' | 'video' | 'png' | 'jpeg' | 'webp' | 'mp4' | 'webm' | string;
  /**
   * Ngưỡng dung lượng tối thiểu (bytes).
   * Mặc định: 512 bytes cho ảnh, 4096 bytes cho video, 1 byte cho generic.
   */
  minSizeBytes?: number;
  /**
   * Chuỗi hash SHA-256 mong đợi (nếu có). So khớp không phân biệt hoa thường.
   */
  expectedSha256?: string;
  /**
   * Cho phép dữ liệu rỗng (0 bytes). Mặc định: false.
   */
  allowEmpty?: boolean;
}

export interface MediaVerificationResult {
  isValid: boolean;
  detectedType: DetectedMediaType;
  sizeBytes: number;
  sha256: string;
  expectedType?: string;
  error?: string;
  errorDetail?: string;
}

/**
 * FlowMediaVerifier: Bộ xác thực tính toàn vẹn và định dạng tệp media (Phase 8 - Step 3)
 * 
 * TIÊU CHUẨN KỸ THUẬT:
 * 1. Xác thực File Signature / Magic Bytes (PNG, JPEG, WEBP, MP4, WEBM).
 * 2. Ngăn chặn giả mạo trang lỗi (Phát hiện phản hồi HTML / JSON error từ CDN được lưu dưới dạng file media).
 * 3. Kiểm soát ngưỡng dung lượng tối thiểu (Tránh file rỗng hoặc tải dở dang).
 * 4. Tính toán Checksum SHA-256 theo luồng (Streaming) an toàn bộ nhớ cho video dung lượng lớn.
 */
export class FlowMediaVerifier {
  public static readonly MIN_IMAGE_SIZE_BYTES = 512;
  public static readonly MIN_VIDEO_SIZE_BYTES = 4096;
  public static readonly MIN_GENERIC_SIZE_BYTES = 1;

  /**
   * Nhận diện định dạng tệp media dựa trên Magic Bytes / Header
   */
  public static detectMediaType(buf: Buffer): DetectedMediaType {
    if (!buf || buf.length === 0) {
      return 'unknown';
    }

    // 1. Kiểm tra HTML / JSON error response
    if (this.isHtmlOrJson(buf)) {
      return 'html_or_json';
    }

    // 2. PNG Signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return 'png';
    }

    // 3. JPEG Signature: FF D8 FF
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'jpeg';
    }

    // 4. WEBP Signature: 'RIFF' (0..3) + 'WEBP' (8..11)
    if (buf.length >= 12) {
      const isRiff = buf.toString('ascii', 0, 4) === 'RIFF';
      const isWebp = buf.toString('ascii', 8, 12) === 'WEBP';
      if (isRiff && isWebp) {
        return 'webp';
      }
    }

    // 5. MP4 / MOV (ISOBMFF): ftyp / moov / mdat box
    if (buf.length >= 8) {
      const boxType = buf.toString('ascii', 4, 8);
      if (boxType === 'ftyp' || boxType === 'moov' || boxType === 'mdat') {
        return 'mp4';
      }
      // Kiểm tra trường hợp ftyp ngay ở đầu
      const rawType = buf.toString('ascii', 0, 4);
      if (rawType === 'ftyp') {
        return 'mp4';
      }
    }

    // 6. WEBM / MKV: EBML ID 1A 45 DF A3
    if (
      buf.length >= 4 &&
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3
    ) {
      return 'webm';
    }

    return 'unknown';
  }

  /**
   * Kiểm tra xem buffer có phải là HTML hoặc JSON (trang lỗi từ CDN/Server)
   */
  private static isHtmlOrJson(buf: Buffer): boolean {
    const checkLen = Math.min(buf.length, 512);
    const text = buf.subarray(0, checkLen).toString('utf-8').trimStart().toLowerCase();

    return (
      text.startsWith('<!doctype html') ||
      text.startsWith('<html') ||
      text.startsWith('<?xml') ||
      text.startsWith('{"error"') ||
      text.startsWith('{"code"') ||
      text.startsWith('{"message"') ||
      text.startsWith('{"status":') ||
      (text.startsWith('{') && (text.includes('"error"') || text.includes('"code"')))
    );
  }

  /**
   * Tính toán chuỗi mã băm SHA-256 từ Buffer
   */
  public static calculateBufferSha256(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
  }

  /**
   * Tính toán chuỗi mã băm SHA-256 từ file bằng phương pháp Streaming an toàn bộ nhớ
   */
  public static async calculateFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Xác thực Buffer dữ liệu media
   */
  public static verifyBuffer(
    buffer: Buffer,
    options: MediaVerificationOptions = {}
  ): MediaVerificationResult {
    const sizeBytes = buffer ? buffer.length : 0;
    const sha256 = buffer && buffer.length > 0 ? this.calculateBufferSha256(buffer) : '';

    if (!buffer || sizeBytes === 0) {
      if (options.allowEmpty) {
        return {
          isValid: true,
          detectedType: 'unknown',
          sizeBytes: 0,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          expectedType: options.expectedType,
        };
      }
      return {
        isValid: false,
        detectedType: 'unknown',
        sizeBytes: 0,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        expectedType: options.expectedType,
        error: 'EMPTY_BUFFER',
        errorDetail: 'Dữ liệu buffer media rỗng (0 bytes).',
      };
    }

    const detectedType = this.detectMediaType(buffer);

    // Kiểm tra trang lỗi HTML/JSON trước tiên để báo lỗi ngữ nghĩa chuẩn xác
    if (detectedType === 'html_or_json') {
      return {
        isValid: false,
        detectedType,
        sizeBytes,
        sha256,
        expectedType: options.expectedType,
        error: 'INVALID_FORMAT_HTML_OR_JSON',
        errorDetail: 'Phát hiện nội dung là phản hồi lỗi HTML/JSON từ máy chủ thay vì tệp media nhị phân.',
      };
    }

    // Xác định ngưỡng dung lượng tối thiểu
    let minSize = FlowMediaVerifier.MIN_GENERIC_SIZE_BYTES;
    if (options.minSizeBytes !== undefined) {
      minSize = options.minSizeBytes;
    } else if (
      options.expectedType === 'video' ||
      detectedType === 'mp4' ||
      detectedType === 'webm'
    ) {
      minSize = FlowMediaVerifier.MIN_VIDEO_SIZE_BYTES;
    } else if (
      options.expectedType === 'image' ||
      detectedType === 'png' ||
      detectedType === 'jpeg' ||
      detectedType === 'webp'
    ) {
      minSize = FlowMediaVerifier.MIN_IMAGE_SIZE_BYTES;
    }

    if (sizeBytes < minSize) {
      return {
        isValid: false,
        detectedType,
        sizeBytes,
        sha256,
        expectedType: options.expectedType,
        error: 'BUFFER_TOO_SMALL',
        errorDetail: `Dung lượng dữ liệu (${sizeBytes} bytes) nhỏ hơn ngưỡng tối thiểu cho phép (${minSize} bytes).`,
      };
    }

    // Kiểm tra tính tương thích với định dạng mong đợi
    if (options.expectedType) {
      const isCompatible = this.isTypeCompatible(detectedType, options.expectedType);
      if (!isCompatible) {
        return {
          isValid: false,
          detectedType,
          sizeBytes,
          sha256,
          expectedType: options.expectedType,
          error: 'UNEXPECTED_MEDIA_TYPE',
          errorDetail: `Định dạng tệp thực tế (${detectedType}) không khớp với định dạng yêu cầu (${options.expectedType}).`,
        };
      }
    }

    // Kiểm tra khớp SHA-256 (nếu có cung cấp)
    if (options.expectedSha256) {
      const cleanExpected = options.expectedSha256.trim().toLowerCase();
      if (cleanExpected !== sha256) {
        return {
          isValid: false,
          detectedType,
          sizeBytes,
          sha256,
          expectedType: options.expectedType,
          error: 'CHECKSUM_MISMATCH',
          errorDetail: `Mã băm SHA-256 không khớp. Kỳ vọng: ${cleanExpected}, Thực tế: ${sha256}.`,
        };
      }
    }

    return {
      isValid: true,
      detectedType,
      sizeBytes,
      sha256,
      expectedType: options.expectedType,
    };
  }

  /**
   * Xác thực tệp media lưu trên đĩa
   */
  public static async verifyFile(
    filePath: string,
    options: MediaVerificationOptions = {}
  ): Promise<MediaVerificationResult> {
    if (!fs.existsSync(filePath)) {
      return {
        isValid: false,
        detectedType: 'unknown',
        sizeBytes: 0,
        sha256: '',
        expectedType: options.expectedType,
        error: 'FILE_NOT_FOUND',
        errorDetail: `Không tìm thấy tệp tin tại đường dẫn: ${filePath}`,
      };
    }

    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch (err: any) {
      return {
        isValid: false,
        detectedType: 'unknown',
        sizeBytes: 0,
        sha256: '',
        expectedType: options.expectedType,
        error: 'STAT_ERROR',
        errorDetail: `Không thể đọc thông tin tệp: ${err.message}`,
      };
    }

    const sizeBytes = stats.size;
    if (sizeBytes === 0) {
      const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      if (options.allowEmpty) {
        return {
          isValid: true,
          detectedType: 'unknown',
          sizeBytes: 0,
          sha256: emptyHash,
          expectedType: options.expectedType,
        };
      }
      return {
        isValid: false,
        detectedType: 'unknown',
        sizeBytes: 0,
        sha256: emptyHash,
        expectedType: options.expectedType,
        error: 'EMPTY_FILE',
        errorDetail: 'Tệp tin trên đĩa có dung lượng 0 bytes.',
      };
    }

    // Đọc header tối đa 4096 bytes để kiểm tra định dạng
    let headerBuf: Buffer;
    try {
      const readLen = Math.min(sizeBytes, 4096);
      const fd = await fs.promises.open(filePath, 'r');
      const tempBuf = Buffer.alloc(readLen);
      const { bytesRead } = await fd.read(tempBuf, 0, readLen, 0);
      await fd.close();
      headerBuf = tempBuf.subarray(0, bytesRead);
    } catch (err: any) {
      return {
        isValid: false,
        detectedType: 'unknown',
        sizeBytes,
        sha256: '',
        expectedType: options.expectedType,
        error: 'READ_HEADER_ERROR',
        errorDetail: `Không thể đọc phần đầu tệp: ${err.message}`,
      };
    }

    const detectedType = this.detectMediaType(headerBuf);

    if (detectedType === 'html_or_json') {
      return {
        isValid: false,
        detectedType,
        sizeBytes,
        sha256: '',
        expectedType: options.expectedType,
        error: 'INVALID_FORMAT_HTML_OR_JSON',
        errorDetail: 'Tệp chứa nội dung phản hồi lỗi HTML/JSON từ máy chủ thay vì tệp media nhị phân hợp lệ.',
      };
    }

    // Xác định ngưỡng dung lượng tối thiểu
    let minSize = FlowMediaVerifier.MIN_GENERIC_SIZE_BYTES;
    if (options.minSizeBytes !== undefined) {
      minSize = options.minSizeBytes;
    } else if (
      options.expectedType === 'video' ||
      detectedType === 'mp4' ||
      detectedType === 'webm'
    ) {
      minSize = FlowMediaVerifier.MIN_VIDEO_SIZE_BYTES;
    } else if (
      options.expectedType === 'image' ||
      detectedType === 'png' ||
      detectedType === 'jpeg' ||
      detectedType === 'webp'
    ) {
      minSize = FlowMediaVerifier.MIN_IMAGE_SIZE_BYTES;
    }

    if (sizeBytes < minSize) {
      return {
        isValid: false,
        detectedType,
        sizeBytes,
        sha256: '',
        expectedType: options.expectedType,
        error: 'FILE_TOO_SMALL',
        errorDetail: `Dung lượng tệp (${sizeBytes} bytes) nhỏ hơn ngưỡng tối thiểu cho phép (${minSize} bytes).`,
      };
    }

    if (options.expectedType) {
      const isCompatible = this.isTypeCompatible(detectedType, options.expectedType);
      if (!isCompatible) {
        return {
          isValid: false,
          detectedType,
          sizeBytes,
          sha256: '',
          expectedType: options.expectedType,
          error: 'UNEXPECTED_MEDIA_TYPE',
          errorDetail: `Định dạng tệp thực tế (${detectedType}) không khớp với định dạng yêu cầu (${options.expectedType}).`,
        };
      }
    }

    // Tính SHA-256 qua streaming
    let sha256 = '';
    try {
      sha256 = await this.calculateFileSha256(filePath);
    } catch (err: any) {
      return {
        isValid: false,
        detectedType,
        sizeBytes,
        sha256: '',
        expectedType: options.expectedType,
        error: 'HASH_CALCULATION_ERROR',
        errorDetail: `Không thể tính toán mã băm SHA-256: ${err.message}`,
      };
    }

    if (options.expectedSha256) {
      const cleanExpected = options.expectedSha256.trim().toLowerCase();
      if (cleanExpected !== sha256) {
        return {
          isValid: false,
          detectedType,
          sizeBytes,
          sha256,
          expectedType: options.expectedType,
          error: 'CHECKSUM_MISMATCH',
          errorDetail: `Mã băm SHA-256 không khớp. Kỳ vọng: ${cleanExpected}, Thực tế: ${sha256}.`,
        };
      }
    }

    return {
      isValid: true,
      detectedType,
      sizeBytes,
      sha256,
      expectedType: options.expectedType,
    };
  }

  /**
   * Khẳng định tính hợp lệ của tệp media. Ném ngoại lệ có mô tả chi tiết nếu tệp không hợp lệ.
   */
  public static async assertFileValid(
    filePath: string,
    options: MediaVerificationOptions = {}
  ): Promise<MediaVerificationResult> {
    const result = await this.verifyFile(filePath, options);
    if (!result.isValid) {
      throw new Error(
        `[FlowMediaVerifier] Xác thực tệp thất bại (${result.error}): ${result.errorDetail || 'Tệp không đạt chuẩn'}`
      );
    }
    return result;
  }

  /**
   * Kiểm tra tính tương thích giữa định dạng phát hiện và định dạng mong đợi
   */
  private static isTypeCompatible(detected: DetectedMediaType, expected: string): boolean {
    const exp = expected.trim().toLowerCase();
    if (exp === 'image') {
      return detected === 'png' || detected === 'jpeg' || detected === 'webp';
    }
    if (exp === 'video') {
      return detected === 'mp4' || detected === 'webm';
    }
    return detected === exp;
  }
}
