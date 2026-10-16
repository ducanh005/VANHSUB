import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { detectFormatFromBuffer, fullDecodeMediaWithFfmpeg } from '../../browser-automation/mediaValidator';
import type { VisualGenerationRequest, VisualGenerationResult } from './VisualProviderRouter';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const OFFICIAL_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const OFFICIAL_VIDEO_MODEL = 'veo-3.1-fast-generate-preview';
type Fetch = typeof fetch;

/** Explicit opt-in provider. Never calls web Flow, switches billing routes or retries submission. */
export class OfficialGeminiVisualProvider {
  constructor(private readonly request: Fetch = fetch, private readonly validate: (file: string) => Promise<void> = async file => {
    const result = await fullDecodeMediaWithFfmpeg(file);
    if (!result.fullyDecoded) throw new Error('OFFICIAL_API_MEDIA_DECODE_FAILED');
  }) {}

  async generate(req: VisualGenerationRequest): Promise<VisualGenerationResult> {
    if (!req.apiKey?.trim() || !req.targetPath || !path.isAbsolute(req.targetPath)) throw new Error('OFFICIAL_API_CONFIG_REQUIRED');
    if (fs.existsSync(req.targetPath)) throw new Error('OUTPUT_ALREADY_EXISTS');
    const operationFile = req.targetPath + '.operation.json';
    if (fs.existsSync(operationFile)) throw new Error('OFFICIAL_API_EXISTING_SUBMISSION_REQUIRES_REVIEW');
    if (!['16:9', '9:16'].includes(req.aspectRatio)) throw new Error('UNSUPPORTED_ASPECT_RATIO');
    req.signal?.throwIfAborted();
    const headers = { 'x-goog-api-key': req.apiKey, 'Content-Type': 'application/json' };
    const json = async (url: string, body?: unknown): Promise<any> => {
      const response = await this.request(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw new Error(`OFFICIAL_API_HTTP_${response.status}`); // Do not log response bodies, credentials or signed URLs.
      const data = await response.json();
      if (data.error) throw new Error('OFFICIAL_API_OPERATION_FAILED');
      return data;
    };
    let bytes: Buffer, operationId: string | undefined;
    let reference: { bytesBase64Encoded: string; mimeType: string } | undefined;
    if (req.referenceImage) {
      const ext = path.extname(req.referenceImage).toLowerCase();
      if (!['.png', '.jpg', '.jpeg'].includes(ext) || fs.statSync(req.referenceImage).size > 20 * 1024 * 1024) throw new Error('INVALID_REFERENCE_IMAGE');
      reference = { bytesBase64Encoded: fs.readFileSync(req.referenceImage).toString('base64'), mimeType: ext === '.png' ? 'image/png' : 'image/jpeg' };
    }
    if (req.mediaType === 'video' && ![4,6,8].includes(req.durationSeconds ?? 8)) throw new Error('UNSUPPORTED_VIDEO_DURATION');
    fs.mkdirSync(path.dirname(operationFile), { recursive: true });
    // Reserve before the chargeable POST. A timeout is ambiguous, so a later run must
    // inspect this receipt rather than automatically submit the same job again.
    fs.writeFileSync(operationFile, JSON.stringify({ provider: 'official_gemini_api', requestKey: req.idempotencyKey, state: 'SUBMITTING' }), { flag: 'wx' });
    if (req.mediaType === 'image') {
      const parts: any[] = [{ text: req.prompt }];
      if (reference) parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.bytesBase64Encoded } });
      const response = await json(`${BASE}/models/${OFFICIAL_IMAGE_MODEL}:generateContent`, { contents: [{ parts }], generationConfig: { responseModalities: ['TEXT','IMAGE'], imageConfig: { aspectRatio: req.aspectRatio } } });
      const image = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith('image/') && p.inlineData.data)?.inlineData;
      if (!image) throw new Error('OFFICIAL_API_IMAGE_MISSING');
      bytes = Buffer.from(image.data, 'base64');
    } else {
      const durationSeconds = req.durationSeconds ?? 8;
      const instance: any = { prompt: req.motionPrompt || req.prompt };
      if (reference) instance.image = reference;
      const submission = await json(`${BASE}/models/${OFFICIAL_VIDEO_MODEL}:predictLongRunning`, { instances: [instance], parameters: { aspectRatio: req.aspectRatio, durationSeconds, sampleCount: 1, resolution: '720p' } });
      operationId = submission.name;
      if (typeof operationId !== 'string' || !/^(?:models\/[\w.-]+\/)?operations\/[\w.-]+$/.test(operationId)) throw new Error('OFFICIAL_API_INVALID_OPERATION');
      // Persist immediately: restart can inspect/poll, never silently resubmit an uncertain job.
      // Append a durable operation receipt; an interrupted write still leaves the
      // initial reservation, which prevents an accidental paid resubmission.
      fs.appendFileSync(operationFile, '\n' + JSON.stringify({ operationId, state: 'SUBMITTED' }));
      let operation: any = submission;
      const deadline = Date.now() + 6 * 60_000;
      while (!operation.done) {
        if (Date.now() >= deadline) throw new Error('OFFICIAL_API_TIMEOUT_POLL_EXISTING_OPERATION');
        await new Promise<void>((resolve, reject) => { const onAbort = () => { clearTimeout(timer); req.signal?.removeEventListener('abort', onAbort); reject(new Error('CANCELLED')); }; const timer = setTimeout(() => { req.signal?.removeEventListener('abort', onAbort); resolve(); }, 5000); req.signal?.addEventListener('abort', onAbort, { once:true }); if (req.signal?.aborted) onAbort(); });
        operation = await json(`${BASE}/${operationId}`);
      }
      const uri = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      const url = new URL(uri);
      if (url.protocol !== 'https:' || url.hostname !== 'generativelanguage.googleapis.com' || url.username || url.password) throw new Error('OFFICIAL_API_UNTRUSTED_MEDIA_URI');
      const response = await this.request(url, { headers: { 'x-goog-api-key': req.apiKey }, redirect: 'error', signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`OFFICIAL_API_DOWNLOAD_HTTP_${response.status}`);
      if (!response.body) throw new Error('OFFICIAL_API_EMPTY_DOWNLOAD');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response.body as any) {
        size += chunk.length;
        if (size > 256 * 1024 * 1024) throw new Error('OFFICIAL_API_INVALID_MEDIA_SIZE');
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks);
    }
    if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('OFFICIAL_API_INVALID_MEDIA_SIZE');
    const format = detectFormatFromBuffer(bytes).format;
    if (req.mediaType === 'image' ? !['png','jpeg','webp'].includes(format) : !['mp4','webm'].includes(format)) throw new Error('OFFICIAL_API_WRONG_MEDIA_TYPE');
    fs.mkdirSync(path.dirname(req.targetPath), { recursive:true });
    const candidate = path.join(path.dirname(req.targetPath), `.${crypto.randomUUID()}${path.extname(req.targetPath)}`);
    try {
      fs.writeFileSync(candidate, bytes, { flag:'wx' }); await this.validate(candidate); req.signal?.throwIfAborted();
      // link is exclusive, preserving any completed output created during validation.
      fs.linkSync(candidate, req.targetPath);
    } finally { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); }
    fs.appendFileSync(operationFile, '\n' + JSON.stringify({ state: 'COMPLETED' }));
    return { provider:'official_gemini_api', mediaType:req.mediaType, localPath:req.targetPath, operationId, state:'COMPLETED' };
  }
}
