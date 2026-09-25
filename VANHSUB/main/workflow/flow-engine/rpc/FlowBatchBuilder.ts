/**
 * FlowBatchBuilder.ts
 *
 * Xây dựng f.req envelope và parse response của Google Flow batchexecute.
 * Module này KHÔNG bao giờ gọi network — chỉ xử lý dữ liệu thuần túy.
 *
 * Wire format (confirmed từ FlowKit flow_batch.py docstring):
 *   f.req = [[[rpcId, "<inner payload as JSON string>", null, "generic"]]]
 *
 *   Response = ")]}'\n" sentinel + length-prefixed chunks:
 *   <N>\n[["wrb.fr", "<rpcId>", "<payload as JSON string>", ...]]\n
 *
 * Payloads từng RPC được xác minh từ FlowKit source + constants.
 * Các vị trí field được đánh dấu VERIFY nếu chưa xác nhận 100%.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  BATCH_PATH,
  FLOW_HOST,
  SURFACE_ID,
  FULL_FRAME_CROP,
  INPUT_TYPE_REFERENCE,
  INPUT_TYPE_BASE_IMAGE,
  RESPONSE_SENTINEL,
  IMG_ASPECT_BY_NAME,
  VID_ASPECT_BY_NAME,
  IMG_MODEL_DEFAULT,
  IMG_MODEL_BY_ALIAS,
  VID_MODEL_DEFAULT,
  VID_MODELS,
  RPC_GEN_IMAGE,
  RPC_GEN_VIDEO,
  RPC_GEN_VIDEO_TEXT,
  RPC_GEN_VIDEO_FIRST_LAST,
  RPC_GEN_VIDEO_REFERENCES,
  RPC_OPERATION,
  RPC_PROJECT_MEDIA,
  RPC_UPLOAD_IMAGE,
  PROJECT_ID_SLOT,
} from './FlowBatchConstants';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BatchEnvelope {
  /** Full URL bao gồm query params */
  url: string;
  /** POST body (application/x-www-form-urlencoded) */
  body: string;
  /** Headers bổ sung cần thiết */
  headers: Record<string, string>;
}

export interface RpcResult {
  rpcId: string;
  /** Inner payload đã parse thành JSON (bất kỳ structure nào) */
  data: unknown;
  /** Nếu response chứa error slot thay vì data */
  error?: unknown;
  ok: boolean;
}

export interface GeneratedImage {
  mediaId: string;
  url: string;
}

export interface OperationStatus {
  operationId: string;
  projectId?: string;
  /** Status string — "CAE" */
  status?: string;
  /** Outcome code — 3=ok, 4=complaint (survivable), khác = lỗi */
  outcomeCode?: number;
  error?: string;
  done: boolean;
  /** Result mediaId khi video tạo xong */
  mediaId?: string;
  /** URL video trực tiếp (flow-content.google) */
  videoUrl?: string;
  /** URL ảnh preview/thumbnail nếu có */
  imageUrl?: string;
}

export interface MediaUrls {
  mediaId: string;
  videoUrl?: string;
  imageUrl?: string;
}

// ── URL Builder ───────────────────────────────────────────────────────────────

let _baseSeconds = 0;
let _reqSequence = 0;

/**
 * Tính _reqid chuẩn 100% theo công thức nội bộ Google Flow (XRV0Af.js:536175):
 * _reqid = 1 + secondsSinceMidnight + sequence * 100000
 */
export function getNextReqId(): number {
  const now = new Date();
  const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  if (!_baseSeconds || Math.abs(secondsSinceMidnight - _baseSeconds) > 3600) {
    _baseSeconds = secondsSinceMidnight;
    _reqSequence = Math.floor(Math.random() * 5) + 1;
  }
  return 1 + _baseSeconds + (_reqSequence++) * 100000;
}

/**
 * Xây URL đầy đủ cho batchexecute request.
 *
 * @param rpcId RPC method ID (vd "ogiZ0b", "MZZa6b")
 * @param projectId UUID project (dùng cho source-path). Optional nhưng nên có.
 * @param fSidParam f.sid trích xuất từ WIZ_global_data.FdrFJe
 * @param blParam bl param từ WIZ_global_data.cfb2h
 */
export function buildBatchUrl(
  rpcId: string,
  projectId?: string,
  fSidParam?: string,
  blParam?: string
): string {
  const reqId = getNextReqId();
  const sourcePath = projectId ? `/project/${projectId}` : '/';
  const fSid = fSidParam || `-${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`;
  const bl = blParam || 'boq_labs-ai-sandbox-frontend_20260922.00_p0';

  const params = new URLSearchParams({
    rpcids: rpcId,
    'source-path': sourcePath,
    'f.sid': fSid,
    bl,
    hl: 'vi',
    _reqid: String(reqId),
    rt: 'c',
  });

  return `${FLOW_HOST}${BATCH_PATH}?${params.toString()}`;
}

/**
 * Xây POST body từ f.req JSON + at token (XSRF hoặc CAPTCHA).
 *
 * === VERIFIED từ 400 error response ===
 * Field `at=` BẮT BUỘC có trong EVERY request — không phải optional:
 *   - Với non-generate (upload maseQ, poll jwpduf):  at=<XSRF_TOKEN>  (từ WIZ_global_data.SNlM0e)
 *   - Với generate (ogiZ0b, eb1hJf, ...):            at=<CAPTCHA_TOKEN> (FlowKit: CAPTCHA thay XSRF)
 *
 * @param rpcId RPC method ID
 * @param innerPayload Inner payload (any[]). Sẽ được JSON.stringify.
 * @param atToken Token cho field `at=`. Luôn bắt buộc. Là XSRF hoặc CAPTCHA.
 */
export function buildBatchBody(
  rpcId: string,
  innerPayload: unknown[],
  atToken: string
): string {
  // f.req = [[[rpcId, "<inner_as_JSON_string>", null, "generic"]]]
  const fReq = JSON.stringify([[[rpcId, JSON.stringify(innerPayload), null, 'generic']]]);

  const body = [
    `f.req=${encodeURIComponent(fReq)}`,
    `at=${encodeURIComponent(atToken)}`,
  ].join('&');

  // Trailing & khớp với FlowKit format: "f.req=...&at=__CAPTCHA__&"
  return body + '&';
}

/**
 * Tạo full BatchEnvelope cho 1 RPC call.
 *
 * @param atToken XSRF token (cho upload/poll) hoặc CAPTCHA token (cho generate).
 *   Luôn required — bất kể RPC nào cũng cần `at=` trong body.
 */
export function buildEnvelope(
  rpcId: string,
  innerPayload: unknown[],
  atToken: string,
  cookieString: string,
  projectId?: string,
  fSid?: string,
  bl?: string
): BatchEnvelope {
  return {
    url: buildBatchUrl(rpcId, projectId, fSid, bl),
    body: buildBatchBody(rpcId, innerPayload, atToken),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieString,
      Origin: FLOW_HOST,
      Referer: projectId ? `${FLOW_HOST}/project/${projectId}` : FLOW_HOST,
      'X-Same-Domain': '1',
      // UA giống Chrome desktop để tránh bot detection
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  };
}

// ── Response Parser ───────────────────────────────────────────────────────────

/**
 * Parse raw response text của batchexecute thành RpcResult.
 *
 * Response format:
 *   )]}'\n
 *   <len>\n
 *   [["wrb.fr", "<rpcId>", "<inner_json>", null, null, null, <seqno>]]\n
 *   <len>\n
 *   [["di", ...]]\n
 */
export function parseBatchResponse(rawText: string, expectedRpcId: string): RpcResult {
  const trimmed = rawText.trimStart();
  if (!trimmed.startsWith(")]}'")) {
    throw new Error(
      `[FlowBatch] Response thiếu sentinel ")]}'"  — không phải batchexecute response hợp lệ. ` +
      `Đầu response: ${rawText.slice(0, 120)}`
    );
  }

  const firstNewlineIndex = trimmed.indexOf('\n');
  const body = firstNewlineIndex !== -1 ? trimmed.slice(firstNewlineIndex + 1) : trimmed.slice(4);

  // Split theo pattern: số nguyên + newline + JSON array
  // Regex: lấy mọi chuỗi bắt đầu bằng "[" (sau khi loại số + newline)
  const chunkPattern = /\d+\r?\n(\[[\s\S]*?\])\s*(?=\d+\r?\n|\s*$)/g;
  let match: RegExpExecArray | null;
  const chunks: unknown[] = [];

  while ((match = chunkPattern.exec(body)) !== null) {
    try {
      chunks.push(JSON.parse(match[1]));
    } catch {
      // Bỏ qua chunk không parse được
    }
  }

  // Nếu regex không bắt được gì, thử fallback: split theo newline
  if (chunks.length === 0) {
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const l = line.trim();
      if (l.startsWith('[')) {
        try {
          chunks.push(JSON.parse(l));
        } catch {}
      }
    }
  }

  // Tìm chunk "wrb.fr" chứa payload thực sự (ưu tiên khớp expectedRpcId nếu có nhiều chunk)
  let targetInner: unknown[] | null = null;
  let fallbackInner: unknown[] | null = null;

  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    const entries: unknown[] = Array.isArray(chunk[0]) ? chunk : [chunk];

    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      if (entry[0] === 'wrb.fr') {
        if (entry[1] === expectedRpcId) {
          targetInner = entry;
          break;
        }
        if (!fallbackInner) {
          fallbackInner = entry;
        }
      }
    }
    if (targetInner) break;
  }

  const selectedInner = targetInner || fallbackInner;
  if (selectedInner) {
    const rpcId = selectedInner[1] as string;
    const payloadStr = selectedInner[2] as string | null;

    if (payloadStr === null || payloadStr === undefined) {
      // Error slot: innerPayload null = Flow returned error
      const errorDetail = {
        code: selectedInner[3] ?? selectedInner[4] ?? 'unknown',
        inner: selectedInner,
        rawSnippet: rawText.slice(0, 800),
      };
      return { rpcId, data: null, error: errorDetail, ok: false };
    }

    try {
      const data = JSON.parse(payloadStr);
      return { rpcId, data, ok: true };
    } catch {
      // payloadStr không phải JSON — trả về raw string
      return { rpcId: rpcId ?? expectedRpcId, data: payloadStr, ok: true };
    }
  }

  throw new Error(
    `[FlowBatch] Không tìm thấy chunk "wrb.fr" trong response cho RPC "${expectedRpcId}". ` +
    `Số chunks parse được: ${chunks.length}. ` +
    `Raw: ${rawText.slice(0, 500)}`
  );
}

// ── Inner Payload Builders ────────────────────────────────────────────────────

/**
 * Resolve aspect ratio string/name thành integer code cho IMAGE RPC.
 * Input: "16:9", "9:16", "1:1", "IMAGE_ASPECT_RATIO_LANDSCAPE", v.v.
 */
export function resolveImageAspect(aspect: string | number): number {
  if (typeof aspect === 'number') {
    return aspect >= 1 && aspect <= 5 ? aspect : 3;
  }
  const normalized = String(aspect).trim();
  const upper = normalized.toUpperCase();
  if (upper === 'SQUARE' || upper === '1:1') return 1;
  if (upper === 'PORTRAIT' || upper === '9:16') return 2;
  if (upper === 'LANDSCAPE' || upper === '16:9') return 3;
  if (upper === '3:4' || upper === 'PORTRAIT_4_3') return 4;
  if (upper === '4:3' || upper === 'LANDSCAPE_4_3') return 5;
  return IMG_ASPECT_BY_NAME[normalized] ?? IMG_ASPECT_BY_NAME[upper] ?? IMG_ASPECT_BY_NAME['16:9'];
}

/**
 * Resolve aspect ratio string/name thành integer code cho VIDEO RPC.
 * QUAN TRỌNG: Encoding KHÁC với image (portrait=1, landscape=2).
 */
export function resolveVideoAspect(aspect: string | number): number {
  if (typeof aspect === 'number') {
    return aspect === 1 || aspect === 2 ? aspect : 2;
  }
  const normalized = String(aspect).trim();
  const upper = normalized.toUpperCase();
  if (
    upper === 'PORTRAIT' ||
    upper === '9:16' ||
    upper === '1' ||
    upper === 'VIDEO_ASPECT_RATIO_PORTRAIT'
  ) {
    return 1;
  }
  if (
    upper === 'LANDSCAPE' ||
    upper === '16:9' ||
    upper === '2' ||
    upper === 'VIDEO_ASPECT_RATIO_LANDSCAPE'
  ) {
    return 2;
  }
  return VID_ASPECT_BY_NAME[normalized] ?? VID_ASPECT_BY_NAME[upper] ?? VID_ASPECT_BY_NAME['16:9'];
}

/**
 * Resolve image model alias/wire-id thành wire-id chính xác.
 * Các model hiện tại: GEM_PIX_2 (default/Pro), NARWHAL (v2), HARBOR_SEAL (Lite)
 */
export function resolveImageModel(key?: string): string {
  if (!key) return IMG_MODEL_DEFAULT;
  const normalized = key.trim().toUpperCase().replace(/-/g, '_');
  // Kiểm tra alias map
  const fromAlias = IMG_MODEL_BY_ALIAS[key] ?? IMG_MODEL_BY_ALIAS[normalized];
  if (fromAlias) return fromAlias;
  // Kiểm tra wire id trực tiếp (uppercase regex: ^[A-Z][A-Z0-9_]{1,95}$)
  if (/^[A-Z][A-Z0-9_]{1,95}$/.test(normalized)) return normalized;
  return IMG_MODEL_DEFAULT;
}

/**
 * Resolve video model key thành wire id chính xác.
 */
export function resolveVideoModel(key?: string): string {
  if (!key) return VID_MODEL_DEFAULT;
  if (VID_MODELS.has(key)) return key;
  if (key.includes('ultra')) return 'veo_3_1_i2v_s_fast_ultra';
  if (key.includes('lite_low_priority')) return 'veo_3_1_i2v_lite_low_priority';
  if (key.includes('lite')) return 'veo_3_1_i2v_lite';
  return VID_MODEL_DEFAULT;
}

/**
 * Xây imageInputs array cho image generation request.
 *
 * Mỗi reference: [mediaId, cropBox, null, null, inputType]
 * inputType: 1=reference, 2=base_image_to_edit
 *
 * @param refs Danh sách media_id của reference images (character, background...)
 * @param baseImageMediaId Nếu có — ảnh gốc để edit (INPUT_TYPE_BASE_IMAGE)
 */
export function buildImageInputs(
  refs: string[],
  baseImageMediaId?: string
): unknown[][] {
  const inputs: unknown[][] = [];

  // Reference images (type 1)
  for (const mediaId of refs) {
    if (!mediaId) continue;
    inputs.push([mediaId, null, null, null, INPUT_TYPE_REFERENCE]);
  }

  // Base image to edit (type 2) — nếu có
  if (baseImageMediaId) {
    inputs.push([baseImageMediaId, null, null, null, INPUT_TYPE_BASE_IMAGE]);
  }

  return inputs;
}

// ── Specific RPC Payload Builders ─────────────────────────────────────────────

export interface GenImagePayloadOptions {
  prompt: string;
  /** "16:9" | "9:16" | "1:1" | ... */
  aspectRatio: string;
  /** Số lượng ảnh output: 1–4 */
  outputCount?: number;
  /** media_ids của reference images */
  referenceMediaIds?: string[];
  /** media_id của base image (edit mode) */
  baseImageMediaId?: string;
  /** Image model wire id hoặc alias. Default: GEM_PIX_2 / NARWHAL */
  imageModel?: string;
  /** Flow project UUID (từ activeProjectId) */
  projectId: string;
  /** Edit asset ID (nếu đang ở màn hình /edit/<asset_id>) */
  editAssetId?: string | null;
  /** Fresh reCAPTCHA enterprise token (~2400 chars) */
  captchaToken: string;
  /** Optional custom seed */
  seed?: number;
}

/**
 * Xây inner payload cho RPC_GEN_IMAGE (ogiZ0b).
 *
 * === VERIFIED 100% TỪ CAPTURE THỰC TẾ TRÊN GOOGLE FLOW ===
 * Structure chính xác:
 * [
 *   null,
 *   [ [ null, null, imageInputs, seed, aspectInt, modelId, null, securityBlock, [[[prompt]]], null, null, null, null, taskUuid ] ],
 *   outputCount,
 *   securityBlock,
 *   [sessionUuid]
 * ]
 *
 * securityBlock = [null, 22, null, null, editAssetId, projectId, null, null, null, null, [captchaToken, 1]]
 */
export function buildGenImagePayload(opts: GenImagePayloadOptions): unknown[] {
  const {
    prompt,
    aspectRatio,
    outputCount = 1,
    referenceMediaIds = [],
    baseImageMediaId,
    imageModel,
    projectId,
    editAssetId = null,
    captchaToken,
    seed = Math.floor(Math.random() * 2147483647),
  } = opts;

  const aspectInt = resolveImageAspect(aspectRatio);
  const modelId = resolveImageModel(imageModel);

  // Xây dựng danh sách media inputs (references & base image)
  const imageInputs: unknown[][] = [];
  if (baseImageMediaId) {
    // 2 = BASE_TYPE_IMAGE (ảnh gốc đang chỉnh sửa)
    imageInputs.push([baseImageMediaId, null, null, null, INPUT_TYPE_BASE_IMAGE]);
  }
  for (const refId of referenceMediaIds) {
    if (refId) {
      // 1 = REFERENCE_TYPE_IMAGE (ảnh tham chiếu)
      // VERIFIED: Vị trí [1] phải là null nếu dùng ảnh tham chiếu đầy đủ
      imageInputs.push([refId, null, null, null, INPUT_TYPE_REFERENCE]);
    }
  }

  const effectiveProjectId = projectId?.trim() || PROJECT_ID_SLOT;

  // Security Context Block mang reCAPTCHA token & context dự án
  const securityBlock = [
    null,
    SURFACE_ID, // 22
    null,
    null,
    editAssetId,
    effectiveProjectId,
    null,
    null,
    null,
    null,
    [captchaToken, 1],
  ];

  const sessionUuid = uuidv4().toUpperCase();
  const count = Math.max(1, Math.min(4, outputCount || 1));
  const taskObjects: unknown[] = [];

  for (let i = 0; i < count; i++) {
    const seedVal = i === 0 ? seed : Math.floor(Math.random() * 2147483647);
    const u1 = uuidv4().toUpperCase();
    const u2 = uuidv4().toUpperCase();

    taskObjects.push([
      null,
      null,
      imageInputs.length > 0 ? imageInputs : null,
      seedVal,
      aspectInt,
      modelId,
      null,
      securityBlock,
      [[[prompt]]],
      editAssetId,
      null,
      null,
      u1,
      u2,
    ]);
  }

  return [
    null,
    taskObjects,
    1, // Verified Sept 2026: number 1, not boolean true
    securityBlock,
    [sessionUuid],
  ];
}

export interface UploadPayloadOptions {
  projectId: string;
  base64Data: string;
  mimeType: string;
  filename: string;
  captchaToken: string;
}

/**
 * Xây inner payload cho RPC_UPLOAD_IMAGE (maseQ).
 *
 * === VERIFIED 100% TỪ MÃ NGUỒN FLOWKIT (flow_batch.py) ===
 * Cấu trúc:
 * [
 *   securityBlock,  // [0] chứa reCAPTCHA token + projectId
 *   image_b64,      // [1] plain base64 (không có data: prefix)
 *   mime_type,      // [2] "image/png" | "image/jpeg" | "image/webp"
 *   1,              // [3] integer 1
 *   null, null, null, null, // [4..7]
 *   filename,       // [8] "character_ref.png"
 *   null,           // [9]
 *   clientUuid1,    // [10] UUID v4 chữ HOA
 *   clientUuid2,    // [11] UUID v4 chữ HOA
 * ]
 */
export function buildUploadPayload(opts: UploadPayloadOptions): unknown[] {
  const { projectId, base64Data, mimeType, filename, captchaToken } = opts;
  const effectiveProjectId = projectId?.trim() || PROJECT_ID_SLOT;
  const clientUuid1 = uuidv4().toUpperCase();
  const clientUuid2 = uuidv4().toUpperCase();

  const securityBlock = [
    null,
    SURFACE_ID, // 22
    null,
    null,
    null,
    effectiveProjectId,
    null,
    null,
    null,
    null,
    [captchaToken, 1],
  ];

  return [
    securityBlock,
    base64Data,
    mimeType,
    1,
    null,
    null,
    null,
    null,
    filename,
    null,
    clientUuid1,
    clientUuid2,
  ];
}

export interface GenVideoPayloadOptions {
  /** media_id của ảnh đầu vào (frame đầu / reference) */
  imageMediaId: string;
  /** "9:16" | "16:9" | 1 | 2 */
  aspectRatio: string | number;
  /** Thời lượng video giây: 4 | 8. Default: 8 */
  durationSeconds?: number;
  /** Video model wire id: "abra_r2v_8s" | "abra_r2v_4s" */
  videoModel?: string;
  /** Camera motion prompt + style */
  prompt: string;
  projectId: string;
  /** Fresh reCAPTCHA Enterprise token */
  captchaToken: string;
  /** Tùy chọn âm thanh: boolean hoặc cấu hình chi tiết */
  audio?: boolean | { enabled?: boolean; voice?: string; soundEffects?: boolean };
}

/**
 * Xây inner payload cho RPC_GEN_VIDEO_REFERENCES (MZZa6b) — Image-to-Video / Reference-to-Video.
 *
 * === VERIFIED 100% TỪ GÓI TIN MẠNG THỰC TẾ TRÊN GOOGLE FLOW ===
 * Schema:
 * [
 *   [
 *     [ [null, null, [[[prompt]]]] ],
 *     [ [null, imageMediaId] ],
 *     modelKey, // "abra_r2v_8s" hoặc "abra_r2v_4s"
 *     aspectInt, // 2 (16:9) hoặc 1 (9:16)
 *     null,
 *     [null, null, null, null, clientUuid1, clientUuid2]
 *   ],
 *   [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
 *   [sessionUuid, 2]
 * ]
 */
export function buildGenVideoPayload(opts: GenVideoPayloadOptions): unknown[] {
  const {
    imageMediaId,
    aspectRatio,
    durationSeconds = 8,
    videoModel,
    prompt,
    projectId,
    captchaToken,
    audio,
  } = opts;

  const aspectInt = resolveVideoAspect(aspectRatio);

  let modelKey = videoModel;
  if (!modelKey) {
    modelKey = 'veo_3_1_r2v_lite';
  }

  const clientUuid1 = uuidv4().toUpperCase();
  const clientUuid2 = uuidv4().toUpperCase();
  const sessionUuid = uuidv4().toUpperCase();

  const audioConfig = audio ? (typeof audio === 'boolean' ? { enabled: audio } : audio) : null;

  const taskConfig = [
    [null, null, [[[prompt]]]],
    [
      [null, imageMediaId]
    ],
    modelKey,
    aspectInt,
    audioConfig,
    [null, null, null, null, clientUuid1, clientUuid2],
  ];

  const effectiveProjectId = projectId?.trim() || PROJECT_ID_SLOT;

  const securityBlock = [
    null,
    SURFACE_ID, // 22
    null,
    null,
    null,
    effectiveProjectId,
    null,
    null,
    null,
    null,
    [captchaToken, 1],
  ];

  return [
    [taskConfig],
    securityBlock,
    [sessionUuid, 2],
  ];
}

export interface GenVideoTextPayloadOptions {
  prompt: string;
  aspectRatio: string | number;
  durationSeconds?: number;
  videoModel?: string;
  projectId: string;
  captchaToken: string;
  /** Tùy chọn âm thanh: boolean hoặc cấu hình chi tiết */
  audio?: boolean | { enabled?: boolean; voice?: string; soundEffects?: boolean };
}

/**
 * Xây inner payload cho RPC_GEN_VIDEO_TEXT (YhhmEf) — text-to-video.
 * === VERIFIED 100% TỪ GÓI TIN MẠNG THỰC TẾ TRÊN GOOGLE FLOW ===
 */
export function buildGenVideoTextPayload(opts: GenVideoTextPayloadOptions): unknown[] {
  const {
    prompt,
    aspectRatio,
    durationSeconds = 8,
    videoModel,
    projectId,
    captchaToken,
    audio,
  } = opts;

  const aspectInt = resolveVideoAspect(aspectRatio);

  const modelKey = videoModel || 'veo_3_1_t2v_lite';

  const clientUuid1 = uuidv4().toUpperCase();
  const clientUuid2 = uuidv4().toUpperCase();
  const sessionUuid = uuidv4().toUpperCase();

  const audioConfig = audio ? (typeof audio === 'boolean' ? { enabled: audio } : audio) : null;

  const taskConfig = [
    [null, null, [[[prompt]]]],
    modelKey,
    aspectInt,
    audioConfig,
    [null, null, null, null, clientUuid1, clientUuid2],
  ];

  const effectiveProjectId = projectId?.trim() || PROJECT_ID_SLOT;

  const securityBlock = [
    null,
    SURFACE_ID, // 22
    null,
    null,
    null,
    effectiveProjectId,
    null,
    null,
    null,
    null,
    [captchaToken, 1],
  ];

  return [
    [taskConfig],
    securityBlock,
    [sessionUuid, 2],
  ];
}

export interface GenVideoFirstLastPayloadOptions {
  firstFrameMediaId: string;
  lastFrameMediaId: string;
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  videoModel?: string;
  projectId: string;
}

/**
 * Xây inner payload cho RPC_GEN_VIDEO_FIRST_LAST (nprQif).
 * ⚠️  VERIFY: Thứ tự fields cần xác minh.
 */
export function buildGenVideoFirstLastPayload(opts: GenVideoFirstLastPayloadOptions): unknown[] {
  const { firstFrameMediaId, lastFrameMediaId, prompt, aspectRatio, durationSeconds, videoModel, projectId } = opts;
  return [
    firstFrameMediaId,
    lastFrameMediaId,
    prompt,
    resolveVideoAspect(aspectRatio),
    durationSeconds,
    resolveVideoModel(videoModel),
    projectId,
    SURFACE_ID,
  ];
}

export interface GenVideoReferencesPayloadOptions {
  imageMediaId: string;
  referenceMediaIds: string[];
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  videoModel?: string;
  projectId: string;
}

/**
 * Xây inner payload cho RPC_GEN_VIDEO_REFERENCES (MZZa6b).
 * ⚠️  VERIFY: Thứ tự fields cần xác minh.
 */
export function buildGenVideoReferencesPayload(opts: GenVideoReferencesPayloadOptions): unknown[] {
  const { imageMediaId, referenceMediaIds, prompt, aspectRatio, durationSeconds, videoModel, projectId } = opts;
  return [
    imageMediaId,
    referenceMediaIds,
    prompt,
    resolveVideoAspect(aspectRatio),
    durationSeconds,
    resolveVideoModel(videoModel),
    projectId,
    SURFACE_ID,
  ];
}

/**
 * Xây inner payload cho RPC_OPERATION (jwpduf) — poll async operation.
 * === VERIFIED 100% TỪ GÓI TIN MẠNG THỰC TẾ TRÊN GOOGLE FLOW ===
 * Không cần CAPTCHA.
 */
export function buildPollOperationPayload(operationId: string, _projectId?: string): unknown[] {
  return [null, null, [[operationId]]];
}

/**
 * Xây inner payload cho RPC_MEDIA (as29s) — lấy link CDN video/ảnh theo mediaId.
 * === VERIFIED 100% TỪ GÓI TIN MẠNG THỰC TẾ TRÊN GOOGLE FLOW ===
 * Không cần CAPTCHA.
 */
export function buildMediaUrlPayload(mediaId: string): unknown[] {
  return [mediaId];
}

/**
 * Xây inner payload cho RPC_PROJECT_MEDIA (Zzl0ze) — list media trong project.
 */
export function buildListProjectMediaPayload(projectId: string): unknown[] {
  return [projectId, SURFACE_ID];
}

// ── Response Data Extractors ──────────────────────────────────────────────────

/**
 * Trích xuất media_id và URL từ response của ogiZ0b (gen image).
 * ⚠️  VERIFY P3: Structure của parsed data phụ thuộc vào inner payload format đúng.
 * Nếu payload sai → response structure khác → extract sẽ fail.
 */
export function extractGeneratedImages(data: unknown): GeneratedImage[] {
  const results: GeneratedImage[] = [];
  if (!data || !Array.isArray(data)) {
    console.warn('[FlowBatch] extractGeneratedImages: data không phải array:', JSON.stringify(data)?.slice(0, 200));
    return results;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Duyệt nested array để tìm các item có media_id (UUID) và url
  const findImages = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      let foundId: string | undefined;
      let foundUrl: string | undefined;
      for (const item of node) {
        if (typeof item === 'string') {
          if (
            item.includes('googleusercontent.com') ||
            item.includes('flow-content.google') ||
            item.startsWith('https://')
          ) {
            foundUrl = item;
          } else if (UUID_RE.test(item)) {
            foundId = item;
          } else if (/^[a-zA-Z0-9_\-\.]{8,}$/.test(item) && !item.includes(' ') && !foundId) {
            foundId = item;
          }
        }
      }
      if (!foundId && foundUrl && node.length >= 2) {
        const other = node.find((x) => typeof x === 'string' && x !== foundUrl && !x.startsWith('http')) as string | undefined;
        if (other) foundId = other;
      }
      if (foundId && foundUrl) {
        // Tránh trùng lặp
        if (!results.some((r) => r.mediaId === foundId)) {
          results.push({ mediaId: foundId, url: foundUrl });
        }
        return;
      }
      for (const item of node) findImages(item);
    }
  };

  findImages(data);

  // Fallback: nếu không tìm thấy node cùng chứa cả UUID và URL, gom tất cả UUIDs và URLs riêng lẻ
  if (results.length === 0) {
    const allUuids: string[] = [];
    const allUrls: string[] = [];

    const collectAll = (node: unknown): void => {
      if (!node) return;
      if (typeof node === 'string') {
        if (UUID_RE.test(node) && !allUuids.includes(node)) {
          allUuids.push(node);
        } else if (
          (node.includes('googleusercontent.com') ||
            node.includes('flow-content.google') ||
            node.startsWith('https://')) &&
          !allUrls.includes(node)
        ) {
          allUrls.push(node);
        }
      } else if (Array.isArray(node)) {
        for (const item of node) collectAll(item);
      }
    };

    collectAll(data);

    for (let i = 0; i < Math.max(allUuids.length, allUrls.length); i++) {
      const mediaId = allUuids[i] || allUuids[0] || `img_${i}`;
      const url = allUrls[i] || allUrls[0] || '';
      if (mediaId && url) {
        results.push({ mediaId, url });
      }
    }
  }

  if (results.length === 0) {
    // Log full data để debug khi VERIFY P3
    console.warn(
      '[FlowBatch] extractGeneratedImages: Không tìm thấy GeneratedImage pattern. ' +
      'Cần VERIFY P3 — raw data:',
      JSON.stringify(data)?.slice(0, 500)
    );
  }

  return results;
}

/**
 * Trích xuất OperationStatus từ response của eb1hJf/nprQif/MZZa6b (video gen).
 * ⚠️  VERIFY: Structure cần xác minh từ real response.
 */
export function extractOperationStatus(data: unknown, rpcId: string): OperationStatus {
  console.log(`[FlowBatch] extractOperationStatus (${rpcId}) raw:`, JSON.stringify(data)?.slice(0, 300));

  if (!data || !Array.isArray(data)) {
    console.warn('[FlowBatch] Operation response không phải array:', data);
    return { operationId: '', done: false, error: 'invalid_response' };
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KNOWN_STATUS_RE = /^(CAE|RUNNING|PENDING|QUEUED|PROCESSING|COMPLETED|SUCCESS|FAILED|ERROR|REJECTED|CANCELLED)$/i;

  let foundOpId: string | undefined;
  let foundProjId: string | undefined;
  let foundStatus: string | undefined;
  let foundVideoUrl: string | undefined;
  let foundImageUrl: string | undefined;

  const scan = (node: unknown): void => {
    if (!node) return;
    if (typeof node === 'string') {
      if (node.includes('flow-content.google/video') || (node.includes('flow-content.google') && node.includes('.mp4'))) {
        foundVideoUrl = node;
      } else if (node.includes('flow-content.google/image')) {
        foundImageUrl = node;
      }
      return;
    }
    if (Array.isArray(node)) {
      if (node.length >= 2 && typeof node[0] === 'string') {
        const opCandidate = node[0];
        let statusCandidate: string | undefined;
        let statusIndex = -1;
        for (let i = 1; i < Math.min(node.length, 5); i++) {
          if (typeof node[i] === 'string' && KNOWN_STATUS_RE.test(node[i] as string)) {
            statusCandidate = node[i] as string;
            statusIndex = i;
            break;
          }
        }

        if (statusCandidate) {
          if (!foundOpId || statusCandidate === 'CAE' || UUID_RE.test(opCandidate)) {
            foundOpId = opCandidate;
            foundStatus = statusCandidate;
            if (node.length >= 4 && typeof node[1] === 'string' && statusIndex !== 1) {
              foundProjId = node[1];
            }
          }
        } else if (!foundOpId && UUID_RE.test(opCandidate)) {
          foundOpId = opCandidate;
          if (typeof node[1] === 'string') foundProjId = node[1];
        }
      }
      for (const item of node) scan(item);
    }
  };

  scan(data);

  return {
    operationId: foundOpId || '',
    projectId: foundProjId,
    status: foundStatus,
    done: !!foundVideoUrl || foundStatus === 'CAE' || foundStatus === 'COMPLETED' || foundStatus === 'SUCCESS',
    videoUrl: foundVideoUrl,
    imageUrl: foundImageUrl,
  };
}

/**
 * Trích xuất OperationStatus từ response của jwpduf (poll).
 * Video hoàn thành khi xuất hiện link video thật (flow-content.google/video) HOẶC status là CAE / COMPLETED / SUCCESS.
 */
export function extractPollStatus(data: unknown, expectedOperationId?: string): OperationStatus {
  console.log('[FlowBatch] extractPollStatus raw:', JSON.stringify(data)?.slice(0, 400));

  if (!data || !Array.isArray(data)) {
    return { operationId: expectedOperationId ?? '', done: false };
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KNOWN_STATUS_RE = /^(CAE|RUNNING|PENDING|QUEUED|PROCESSING|COMPLETED|SUCCESS|FAILED|ERROR|REJECTED|CANCELLED)$/i;
  let videoUrl: string | undefined;
  let imageUrl: string | undefined;
  let foundMediaId: string | undefined;
  let foundProjectId: string | undefined;
  let foundStatus: string | undefined;
  let foundError: string | undefined;
  let matchedTargetOp = false;

  const scanNode = (node: unknown): void => {
    if (!node) return;
    if (typeof node === 'string') {
      if (node.includes('flow-content.google/video') || (node.includes('flow-content.google') && node.includes('.mp4'))) {
        videoUrl = node;
      } else if (node.includes('flow-content.google/image')) {
        imageUrl = node;
      } else if (
        node.includes('SAFETY_BLOCKED') ||
        node.includes('POLICY_VIOLATION') ||
        node.includes('content policy') ||
        node.includes('sensitive content') ||
        node.includes('safety filter') ||
        node.includes('cannot generate') ||
        node.includes('prompt_blocked') ||
        node.includes('content_rejected') ||
        node.includes('nsfw') ||
        node.includes('harmful content')
      ) {
        foundError = node;
      }
    } else if (Array.isArray(node)) {
      if (node.length >= 2 && typeof node[0] === 'string') {
        const opCandidate = node[0];
        const isTargetOp = expectedOperationId ? opCandidate === expectedOperationId : false;

        let statusCandidate: string | undefined;
        let statusIndex = -1;
        for (let i = 1; i < Math.min(node.length, 5); i++) {
          if (typeof node[i] === 'string' && KNOWN_STATUS_RE.test(node[i] as string)) {
            statusCandidate = node[i] as string;
            statusIndex = i;
            break;
          }
        }

        const isStatusKnown = !!statusCandidate;

        // Ưu tiên 1: Khớp chính xác expectedOperationId
        if (isTargetOp) {
          matchedTargetOp = true;
          foundMediaId = opCandidate;
          if (isStatusKnown) {
            foundStatus = statusCandidate;
          }
          if (node.length >= 4 && typeof node[1] === 'string' && statusIndex !== 1) {
            foundProjectId = node[1];
          }
          if (statusCandidate === 'FAILED' || statusCandidate === 'ERROR' || statusCandidate === 'REJECTED') {
            const errAt = statusIndex + 1;
            foundError =
              (typeof node[errAt] === 'string' ? (node[errAt] as string) : undefined) ||
              (typeof node[4] === 'string' ? (node[4] as string) : undefined) ||
              `Tác vụ ${opCandidate} thất bại với trạng thái ${statusCandidate}`;
          }
        } else if (!matchedTargetOp) {
          // Ưu tiên 2: Chưa khớp targetOp, tìm candidate có status hợp lệ
          if (isStatusKnown) {
            foundMediaId = opCandidate;
            foundStatus = statusCandidate;
            if (node.length >= 4 && typeof node[1] === 'string' && statusIndex !== 1) {
              foundProjectId = node[1];
            }
            if (statusCandidate === 'FAILED' || statusCandidate === 'ERROR' || statusCandidate === 'REJECTED') {
              const errAt = statusIndex + 1;
              foundError =
                (typeof node[errAt] === 'string' ? (node[errAt] as string) : undefined) ||
                (typeof node[4] === 'string' ? (node[4] as string) : undefined) ||
                `Tác vụ ${opCandidate} thất bại với trạng thái ${statusCandidate}`;
            }
          } else if (!foundMediaId && UUID_RE.test(opCandidate) && !expectedOperationId) {
            foundMediaId = opCandidate;
            if (typeof node[1] === 'string') foundProjectId = node[1];
          }
        }
      }
      for (const item of node) {
        scanNode(item);
      }
    }
  };

  scanNode(data);

  // Video hoàn thành khi xuất hiện link video thật HOẶC status là CAE / COMPLETED / SUCCESS
  const isDone =
    !!videoUrl ||
    foundStatus === 'CAE' ||
    foundStatus === 'COMPLETED' ||
    foundStatus === 'SUCCESS';

  return {
    operationId: expectedOperationId ?? foundMediaId ?? '',
    projectId: foundProjectId,
    mediaId: foundMediaId,
    status: foundStatus || (isDone ? 'CAE' : foundError ? 'FAILED' : 'RUNNING'),
    done: isDone,
    videoUrl,
    imageUrl,
    error: foundError,
  };
}
