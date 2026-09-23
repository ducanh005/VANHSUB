/**
 * FlowBatchConstants.ts
 *
 * Hằng số cho Google Flow batchexecute transport — port từ FlowKit flow_batch.py (MIT).
 *
 * Tất cả RPC ID, aspect ratio code, model wire id, CAPTCHA action đã được
 * xác minh từ mã nguồn thực tế của FlowKit (commit Sept 2026).
 *
 * ⚠️  CÁC GIÁ TRỊ "CẦN XÁC MINH" được đánh dấu VERIFY — cần chạy
 *     test Giai đoạn 1 để xác nhận trước khi dùng vào production.
 */

// ── Endpoint ─────────────────────────────────────────────────────────────────

/** Path của batchexecute endpoint trên flow.google.com */
export const BATCH_PATH = '/_/AiSandboxAngularFrontend/data/batchexecute';

/** Host domain của Flow */
export const FLOW_HOST = 'https://flow.google.com';

/** Host chứa media (ảnh/video output) */
export const MEDIA_HOST = 'flow-content.google';

// ── RPC IDs ───────────────────────────────────────────────────────────────────
// Xác minh từ FlowKit flow_batch.py source, Sept 2026.

/** Tạo ảnh (Nano Banana / GEM_PIX_2 / NARWHAL / HARBOR_SEAL) */
export const RPC_GEN_IMAGE = 'ogiZ0b';

/** Tạo video image-to-video (Veo, Omni model family) */
export const RPC_GEN_VIDEO = 'eb1hJf';

/** Tạo video text-to-video (Omni Flash) */
export const RPC_GEN_VIDEO_TEXT = 'YhhmEf';

/** Tạo video first-frame + last-frame chaining */
export const RPC_GEN_VIDEO_FIRST_LAST = 'nprQif';

/** Tạo video với reference images */
export const RPC_GEN_VIDEO_REFERENCES = 'MZZa6b';

/** Poll async operation (video generation status) */
export const RPC_OPERATION = 'jwpduf';

/** Liệt kê toàn bộ media trong project */
export const RPC_PROJECT_MEDIA = 'Zzl0ze';

/** Lấy URL của 1 media cụ thể theo media_id */
export const RPC_MEDIA = 'as29s';

/** Upload ảnh local → trả về media_id (UUID) */
export const RPC_UPLOAD_IMAGE = 'maseQ';

/** Upscale ảnh lên 2K hoặc 4K */
export const RPC_UPSCALE_IMAGE = 'SPrCad';

// ── CAPTCHA Actions ───────────────────────────────────────────────────────────
// Truyền vào grecaptcha.enterprise.execute() — phải khớp với action Flow expect.

/** Action CAPTCHA khi tạo ảnh */
export const CAPTCHA_ACTION_IMAGE = 'IMAGE_GENERATION';

/** Action CAPTCHA khi tạo video */
export const CAPTCHA_ACTION_VIDEO = 'VIDEO_GENERATION';

/**
 * Site key reCAPTCHA Enterprise của flow.google.com.
 * Lấy từ FlowKit injected.js source — đã survive migration Sept 2026.
 * Cần tái xác minh nếu Google thay đổi.
 */
export const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

// ── Image Aspect Ratios ───────────────────────────────────────────────────────
// QUAN TRỌNG: Encoding image KHÁC encoding video!

/** Image: Square (1024×1024) */
export const IMG_ASPECT_SQUARE = 1;
/** Image: Portrait 9:16 (768×1376) */
export const IMG_ASPECT_PORTRAIT = 2;
/** Image: Landscape 16:9 (1376×768) */
export const IMG_ASPECT_LANDSCAPE = 3;
/** Image: Portrait 3:4 (896×1200) */
export const IMG_ASPECT_PORTRAIT_4_3 = 4;
/** Image: Landscape 4:3 (1200×896) */
export const IMG_ASPECT_LANDSCAPE_4_3 = 5;

/** Map từ tên cũ (REST era) hoặc ratio string → integer code cho image RPC */
export const IMG_ASPECT_BY_NAME: Record<string, number> = {
  IMAGE_ASPECT_RATIO_SQUARE: IMG_ASPECT_SQUARE,
  IMAGE_ASPECT_RATIO_PORTRAIT: IMG_ASPECT_PORTRAIT,
  IMAGE_ASPECT_RATIO_LANDSCAPE: IMG_ASPECT_LANDSCAPE,
  IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: IMG_ASPECT_PORTRAIT_4_3,
  IMAGE_ASPECT_RATIO_PORTRAIT_FOUR_THREE: IMG_ASPECT_PORTRAIT_4_3,
  IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: IMG_ASPECT_LANDSCAPE_4_3,
  '1:1': IMG_ASPECT_SQUARE,
  '9:16': IMG_ASPECT_PORTRAIT,
  '16:9': IMG_ASPECT_LANDSCAPE,
  '3:4': IMG_ASPECT_PORTRAIT_4_3,
  '4:3': IMG_ASPECT_LANDSCAPE_4_3,
};

// ── Video Aspect Ratios ───────────────────────────────────────────────────────
// KHÁC HOÀN TOÀN với image: portrait=1, landscape=2 (image: portrait=2, landscape=3)

/** Video: Portrait 9:16 (720×1280) */
export const VID_ASPECT_PORTRAIT = 1;
/** Video: Landscape 16:9 (1280×720) */
export const VID_ASPECT_LANDSCAPE = 2;

/** Map từ tên → integer code cho video RPC */
export const VID_ASPECT_BY_NAME: Record<string, number> = {
  VIDEO_ASPECT_RATIO_PORTRAIT: VID_ASPECT_PORTRAIT,
  VIDEO_ASPECT_RATIO_LANDSCAPE: VID_ASPECT_LANDSCAPE,
  '9:16': VID_ASPECT_PORTRAIT,
  '16:9': VID_ASPECT_LANDSCAPE,
};

// ── Image Model Wire IDs ──────────────────────────────────────────────────────
// Gọi là "Nano Banana" trong UI; wire id dùng trong batchexecute payload.

/** Model mặc định (Nano Banana Pro / GEM_PIX_2) — verified từ Google Flow 2026 */
export const IMG_MODEL_DEFAULT = 'GEM_PIX_2';

/** Tất cả image model wire ids hiện tại */
export const IMG_MODELS = new Set(['NARWHAL', 'GEM_PIX_2', 'HARBOR_SEAL']);

/** Friendly alias → wire id */
export const IMG_MODEL_BY_ALIAS: Record<string, string> = {
  NANO_BANANA_2: 'NARWHAL',
  NANO_BANANA_PRO: 'GEM_PIX_2',
  NANO_BANANA_2_LITE: 'HARBOR_SEAL',
  NANO_BANANA_LITE: 'HARBOR_SEAL',
  // Map từ imageEngine config của app hiện tại:
  'banana-pro': 'GEM_PIX_2',
  'nano-banana': 'GEM_PIX_2',  // default to GEM_PIX_2 (Google Flow 2026 default)
  'banana_pro': 'GEM_PIX_2',
};

// ── Video Model Wire IDs ──────────────────────────────────────────────────────

/** Video model mặc định */
export const VID_MODEL_DEFAULT = 'veo_3_1_i2v_lite_low_priority';

/** Tất cả video model wire ids */
export const VID_MODELS = new Set([
  'veo_3_1_i2v_lite_low_priority',
  'veo_3_1_i2v_lite',
  'veo_3_1_i2v_s_fast_ultra',
]);

// ── Operation Status ──────────────────────────────────────────────────────────

/**
 * Terminal status của async operation. Khi jwpduf poll trả về status này,
 * video generation đã hoàn tất và có thể lấy URL media.
 */
export const OPERATION_STATUS_DONE = 'CAE';

/** Outcome OK — media đã sẵn sàng */
export const OUTCOME_OK = 3;

/**
 * Outcome complaint — Flow "grumble" nhưng KHÔNG phải lỗi terminal.
 * Jobs với code này vẫn hoàn tất; media sẽ xuất hiện vài giây sau.
 * KHÔNG dừng poll khi gặp code này.
 */
export const OUTCOME_COMPLAINT = 4;

// ── Payload Constants ─────────────────────────────────────────────────────────

/**
 * Surface ID — cố định 22 trong mọi request Flow.
 * Xác minh từ FlowKit source: "Constant in every capture."
 */
export const SURFACE_ID = 22;

/**
 * Crop box mặc định cho reference image — verbatim từ UI khi không có reframe.
 * Spanning 128/129 of the frame (một chút padding trong).
 * Xác minh từ FlowKit: FULL_FRAME_CROP
 */
export const FULL_FRAME_CROP: [null, number, number, number] = [
  null,
  0.0038759689922481244,
  1,
  0.9961240310077519,
];

/** Image input type: reference image (dùng cho character/background refs) */
export const INPUT_TYPE_REFERENCE = 1;

/** Image input type: base image to edit */
export const INPUT_TYPE_BASE_IMAGE = 2;

/** Image upscale resolution codes */
export const UPSCALE_RESOLUTIONS: Record<string, number> = {
  '2K': 1,
  '4K': 2,
};

// ── Response Parsing ──────────────────────────────────────────────────────────

/**
 * Sentinel dòng đầu của mọi batchexecute response.
 * Bắt buộc present — thiếu sentinel = response không hợp lệ.
 */
export const RESPONSE_SENTINEL = ")]}'\n";

// ── Retry / Timing ────────────────────────────────────────────────────────────

/** Poll interval khi chờ video generation (ms) */
export const OPERATION_POLL_INTERVAL_MS = 5000;

/** Timeout tối đa chờ video generation (ms) — 15 phút */
export const OPERATION_POLL_TIMEOUT_MS = 15 * 60 * 1000;

/** Timeout cho 1 batchexecute HTTP request (ms) */
export const RPC_REQUEST_TIMEOUT_MS = 60_000;

/** Delay retry khi gặp lỗi transient (ms) */
export const RPC_TRANSIENT_RETRY_DELAY_MS = 8_000;

/** Số lần retry tối đa cho image generation (FlowKit: IMAGE_TRANSIENT_MAX_ATTEMPTS = 2) */
export const IMAGE_TRANSIENT_MAX_RETRIES = 2;

// ── VERIFY Markers ────────────────────────────────────────────────────────────
// Các hằng số sau CẦN XÁC MINH qua test Giai đoạn 1 (chạy thật trong DevTools).

/**
 * VERIFY P1: Tên biến JavaScript chứa XSRF token `at` trong window object
 * của trang flow.google.com.
 *
 * Google dùng WIZ_global_data.SNlM0e cho hầu hết sản phẩm batchexecute.
 * Cần xác minh bằng: `window.WIZ_global_data` trong DevTools của lobbyWindow.
 *
 * Nếu sai: FlowRpcClient.getAtToken() sẽ trả về null và ghi warning rõ.
 */
export const WIZ_DATA_AT_TOKEN_KEY = 'SNlM0e';

/**
 * VERIFY P2: Field name trong POST body chứa CAPTCHA token / XSRF at token.
 *
 * Từ FlowKit source: body = "f.req=...&at=__CAPTCHA__&"
 * → `at` field trong body = CAPTCHA token (single-use reCAPTCHA)
 * → XSRF `at` token từ WIZ_global_data được embed VÀO URL query param, không vào body
 *
 * Cần xác minh bằng Network capture trong DevTools.
 * Nếu sai: request sẽ trả về 403 hoặc error trong payload.
 */
export const BODY_CAPTCHA_FIELD = 'at';

/** Placeholder token cho reCAPTCHA khi gửi qua Chrome Extension Bridge */
export const CAPTCHA_SLOT = '__CAPTCHA__';

/** Port WebSocket Server của Electron lắng nghe kết nối từ Chrome Extension */
export const BRIDGE_WS_PORT = 9222;
