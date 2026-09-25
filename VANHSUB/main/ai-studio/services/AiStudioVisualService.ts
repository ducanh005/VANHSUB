import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { GoogleVeoSessionManager } from '../../veo/GoogleVeoSessionManager';
import { GoogleFlowBrowserMutex } from '../../workflow/dispatcher/GoogleFlowBrowserMutex';
import { FlowBridgeServer } from '../../workflow/flow-engine/rpc/FlowBridgeServer';
import {
  getGoogleFlowRpcClient,
  GoogleFlowRpcClient,
  GoogleFlowRpcError,
  classifyFlowRpcError,
} from '../../workflow/flow-engine/rpc/GoogleFlowRpcClient';
import type {
  AiStudioFlowEngineConfig,
  FlowAspectRatio,
  RenderingResolution,
  StoryboardScene,
  RegenerateSceneAssetPayload,
  RegenerateSceneAssetResult,
} from '../types';

// Setup FFmpeg & FFprobe binary paths
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';

if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}
if (rawFfprobePath) {
  ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
}

export interface VisualDispatchResult {
  scenes: StoryboardScene[];
  generatedCount: number;
  modeUsed: 'google_flow' | 'synthetic_fallback';
}

export class AiStudioVisualService {
  private static instance: AiStudioVisualService | null = null;
  private rpcClient: GoogleFlowRpcClient | null = null;

  public static getInstance(): AiStudioVisualService {
    if (!AiStudioVisualService.instance) {
      AiStudioVisualService.instance = new AiStudioVisualService();
    }
    return AiStudioVisualService.instance;
  }

  /**
   * Cung cấp hoặc ghi đè GoogleFlowRpcClient (hỗ trợ kiểm thử và custom session).
   */
  public setRpcClient(client: GoogleFlowRpcClient | null): void {
    this.rpcClient = client;
  }

  /**
   * Lấy GoogleFlowRpcClient hiện hành (singleton hoặc custom instance đã tiêm).
   */
  public getRpcClient(): GoogleFlowRpcClient {
    if (this.rpcClient) {
      return this.rpcClient;
    }
    return getGoogleFlowRpcClient();
  }

  // ==========================================================================
  // Dimensions Resolution Helper
  // ==========================================================================
  public resolveDimensions(
    aspectRatio: FlowAspectRatio | string = '16:9',
    resolution?: RenderingResolution
  ): { width: number; height: number } {
    const is1080p = resolution === '1080p';
    const norm = String(aspectRatio || '16:9').trim().toLowerCase();

    if (norm === '9:16' || norm === 'portrait') {
      return is1080p ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
    }
    if (norm === '1:1' || norm === 'square') {
      return is1080p ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
    }
    if (norm === '3:4') {
      return is1080p ? { width: 810, height: 1080 } : { width: 540, height: 720 };
    }
    if (norm === '4:3') {
      return is1080p ? { width: 1440, height: 1080 } : { width: 960, height: 720 };
    }
    // Default 16:9 / landscape
    return is1080p ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  }

  // ==========================================================================
  // Stage 6: Dual-Mode Visual Generation Dispatcher
  // ==========================================================================
  public async dispatchVisualAssets(
    scenes: StoryboardScene[],
    flowConfig: Partial<AiStudioFlowEngineConfig> = {},
    assetsDir: string,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal,
    onSceneComplete?: (scene: StoryboardScene, index: number) => void | Promise<void>
  ): Promise<VisualDispatchResult> {
    fs.mkdirSync(assetsDir, { recursive: true });

    // Mặc định luôn ưu tiên Pure Web RPC trừ khi chọn engine dom hoặc synthetic
    const isLegacyDom = flowConfig.engine === 'dom' || flowConfig.engine === 'legacy_dom';
    const bridge = FlowBridgeServer.getInstance();
    const isBridgeConnected = bridge.isConnected();
    let useGoogleFlow = Boolean(this.rpcClient || (!isLegacyDom && flowConfig.engine !== 'synthetic'));
    if (!this.rpcClient && useGoogleFlow && !isBridgeConnected) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const status = await sessionMgr.validateSession();
        if (!status || !status.valid) {
          const hasExplicitFallback = Boolean(
            flowConfig.allowSyntheticFallback === true ||
            flowConfig.fallbackToSynthetic === true ||
            (flowConfig as any).explicitFallback === true
          );
          if (!hasExplicitFallback) {
            throw new GoogleFlowRpcError(
              `Chưa đăng nhập Google Flow hoặc phiên làm việc đã hết hạn (${status?.detail || 'Chưa xác thực'}). Vui lòng mở Sảnh Google Flow trên giao diện để đăng nhập tài khoản.`,
              { code: 'SESSION_EXPIRED', retryable: false, suggestedAction: 'REAUTH_REQUIRED' }
            );
          } else {
            console.warn('[AiStudioVisualService] Phiên Google Flow chưa xác thực, chuyển sang fallback bản mẫu thiết kế.');
            useGoogleFlow = false;
          }
        }
      } catch (e: any) {
        if (e instanceof GoogleFlowRpcError) throw e;
        console.warn('[AiStudioVisualService] Lỗi khi kiểm tra validateSession:', e);
      }
    }

    let lobbyWin: any = null;
    try {
      const sessionMgr = GoogleVeoSessionManager.getInstance();
      lobbyWin = sessionMgr.getLobbyWindow();
      if (lobbyWin && lobbyWin.isDestroyed()) lobbyWin = null;
    } catch {
      lobbyWin = null;
    }

    let googleFlowSuccessCount = 0;

    for (let i = 0; i < scenes.length; i++) {
      if (signal?.aborted) {
        throw new Error('Quá trình tạo hình ảnh đã bị hủy bởi người dùng.');
      }

      const scene = scenes[i];
      const isSceneVideo = (scene.motionType === 'video' && flowConfig.outputMode !== 'image') || flowConfig.outputMode === 'video';
      const ext = isSceneVideo && useGoogleFlow ? 'mp4' : 'png';
      const assetPath = path.join(assetsDir, `scene_${String(i + 1).padStart(2, '0')}.${ext}`);

      const sceneBasePct = Math.round((i / scenes.length) * 100);
      const sceneWeight = Math.round(100 / scenes.length);

      const sceneProgressCallback = (pct: number, msg: string) => {
        const overallPct = Math.min(99, sceneBasePct + Math.round((pct / 100) * sceneWeight));
        onProgress?.(overallPct, `[Cảnh ${i + 1}/${scenes.length}] ${msg}`);
      };

      onProgress?.(
        sceneBasePct,
        `Đang tạo hình ảnh phân cảnh ${i + 1}/${scenes.length} (${useGoogleFlow ? 'Google Flow AI' : 'Bản mẫu độ phân giải cao'})...`
      );

      // Attempt live Google Flow session if authenticated
      if (useGoogleFlow) {
        try {
          const finalPath = await this.generateViaGoogleFlow(
            scene,
            assetPath,
            flowConfig,
            sceneProgressCallback,
            signal
          );
          scene.assetPath = finalPath;
          if (isSceneVideo) {
            scene.videoPath = finalPath;
          } else {
            scene.imagePath = finalPath;
            delete scene.videoPath;
          }
          scene.status = 'ready';
          googleFlowSuccessCount++;
          await onSceneComplete?.(scene, i);
          continue;
        } catch (rawFlowErr: any) {
          const flowErr = classifyFlowRpcError(rawFlowErr);
          const errorCode = flowErr.code;

          console.warn(
            `[AiStudioVisualService] Sinh media Google Flow thất bại ở cảnh ${i + 1} [Mã lỗi: ${errorCode}]: ${flowErr.message}`
          );

          // Bóc tách mã lỗi rõ ràng: chỉ fallback sang synthetic card khi có cấu hình explicit fallback, tránh âm thầm nuốt lỗi sinh ảnh/video thật
          const hasExplicitFallback = Boolean(
            flowConfig.allowSyntheticFallback === true ||
            flowConfig.fallbackToSynthetic === true ||
            (flowConfig as any).explicitFallback === true
          );

          const isRpcEngine = Boolean(
            this.rpcClient ||
            !isLegacyDom ||
            flowConfig.engine === 'rpc' ||
            flowConfig.engine === 'flow_rpc' ||
            (flowConfig as any)?.useRpc === true
          );

          const isTerminalRpcError =
            errorCode === 'SESSION_EXPIRED' ||
            errorCode === 'RATE_LIMITED' ||
            errorCode === 'CONTENT_POLICY_VIOLATION' ||
            errorCode === 'CONTENT_REJECTED';

          if (!hasExplicitFallback) {
            if (isRpcEngine) {
              throw flowErr;
            } else if (flowConfig.allowSyntheticFallback === false) {
              throw flowErr;
            } else if (isTerminalRpcError && lobbyWin) {
              throw flowErr;
            }
          }

          console.info(
            `[AiStudioVisualService] Kích hoạt synthetic scene card fallback cho cảnh ${i + 1}.`
          );
        }
      }

      // Procedural synthetic high-res scene card fallback
      const fallbackPath = assetPath.endsWith('.mp4') ? assetPath.replace(/\.mp4$/, '.png') : assetPath;
      await this.generateSyntheticSceneCard(scene, fallbackPath, flowConfig.aspectRatio || '16:9', '720p');
      scene.assetPath = fallbackPath;
      scene.imagePath = fallbackPath;
      delete scene.videoPath;
      scene.status = 'ready';
      await onSceneComplete?.(scene, i);
    }

    const modeUsed: 'google_flow' | 'synthetic_fallback' =
      useGoogleFlow && googleFlowSuccessCount > 0 && googleFlowSuccessCount === scenes.length
        ? 'google_flow'
        : 'synthetic_fallback';

    return {
      scenes,
      generatedCount: scenes.filter((s) => s.assetPath && fs.existsSync(s.assetPath)).length,
      modeUsed,
    };
  }

  // ==========================================================================
  // Google Flow Generation Bridge (Pure Web RPC)
  // ==========================================================================
  public async generateViaGoogleFlow(
    scene: StoryboardScene,
    outputPath: string,
    flowConfig: Partial<AiStudioFlowEngineConfig> = {},
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const rpcClient = this.getRpcClient();

    const bridge = FlowBridgeServer.getInstance();
    const isBridgeConnected = bridge.isConnected();

    let lobbyWin: any = null;
    let effectiveProjectId: string | undefined = flowConfig.projectId;

    if (isBridgeConnected) {
      // Khi đã có Chrome Extension kết nối:
      // BỎ QUA HOÀN TOÀN việc mở hay tương tác với cửa sổ Electron lobby,
      // toàn bộ yêu cầu Web RPC và CAPTCHA sẽ được chuyển sang Google Chrome thật!
      if (!effectiveProjectId) {
        try {
          const tabInfo = await bridge.getFlowTabInfo(3000);
          if (tabInfo && tabInfo.projectId) {
            effectiveProjectId = tabInfo.projectId;
          }
        } catch {}
      }
    } else {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        lobbyWin = sessionMgr.getLobbyWindow();
        if (!lobbyWin || lobbyWin.isDestroyed()) {
          await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });
          lobbyWin = sessionMgr.getLobbyWindow();
        }
        if (lobbyWin && !lobbyWin.isDestroyed()) {
          await sessionMgr.ensureProjectContext(lobbyWin, flowConfig.projectId);
          effectiveProjectId = sessionMgr.getCurrentProjectId() || flowConfig.projectId;
        }
      } catch {
        lobbyWin = null;
      }
    }

    if (signal?.aborted) {
      throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
    }

    const isVideo = flowConfig.outputMode === 'video' || (scene.motionType === 'video' && flowConfig.outputMode !== 'image');

    // Normalize output path extension safely without destroying directory names containing dots
    const desiredExt = isVideo ? '.mp4' : '.png';
    const currentExt = path.extname(outputPath);
    let targetPath = outputPath;
    if (currentExt.toLowerCase() !== desiredExt) {
      if (currentExt) {
        targetPath = outputPath.slice(0, -currentExt.length) + desiredExt;
      } else {
        targetPath = outputPath + desiredExt;
      }
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    const mutex = GoogleFlowBrowserMutex.getInstance();
    return await mutex.runExclusive(async () => {
      if (signal?.aborted) {
        throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
      }

      const refAssets = (scene as any).referenceAssets ||
        (scene.referenceImagePath ? [scene.referenceImagePath] : undefined) ||
        (flowConfig.referenceImagePath ? [flowConfig.referenceImagePath] : undefined);

      let effectivePrompt = (scene.visualPrompt || scene.lineText || '').trim();
      if (!effectivePrompt) {
        throw new GoogleFlowRpcError('Prompt tạo media không được để trống.', {
          code: 'INVALID_ARGUMENT',
          retryable: false,
        });
      }

      if (isVideo) {
        onProgress?.(10, 'Đang gửi yêu cầu tạo video (Veo RPC)...');

        const inputImageAsset = (scene as any).inputImageAsset || (scene as any).input_image_asset;

        const genResult = await rpcClient.generateVideo({
          prompt: effectivePrompt,
          aspectRatio: flowConfig.aspectRatio || '16:9',
          referenceAssets: refAssets,
          inputImageAsset,
          projectId: effectiveProjectId,
          win: lobbyWin,
        });

        let finalVideoUrl = genResult.videoUrl;

        if (!finalVideoUrl) {
          if (!genResult.operationId) {
            throw new GoogleFlowRpcError('Không nhận được operationId từ Google Flow RPC video generation.', {
              code: 'UPSTREAM_ERROR',
              retryable: true,
            });
          }

          onProgress?.(15, 'Đang theo dõi tiến trình tạo video (Veo RPC Poller)...');

          const pollResult = await rpcClient.pollGeneration({
            operationId: genResult.operationId,
            projectId: genResult.projectId,
            win: lobbyWin,
            signal,
            onProgress: (pInfo) => {
              // Scale polling progress (0-100%) into 15%-85% range so subsequent download never jumps backwards
              const scaledPct = 15 + Math.round((Math.min(100, Math.max(0, pInfo.percentage)) / 100) * 70);
              onProgress?.(
                scaledPct,
                `[Veo ${pInfo.state}] ${pInfo.message || 'Đang tạo video...'}`
              );
            },
          });

          finalVideoUrl = pollResult.videoUrl;
        }

        if (!finalVideoUrl) {
          throw new GoogleFlowRpcError('Google Flow RPC hoàn tất nhưng không có videoUrl trong kết quả.', {
            code: 'UPSTREAM_ERROR',
            retryable: true,
          });
        }

        onProgress?.(88, 'Đang tải tệp video từ CDN về thư mục dự án...');
        await this.downloadMediaAsset(finalVideoUrl, targetPath, {
          signal,
          win: lobbyWin,
          partition: rpcClient.partition,
        });

        try {
          this.validateMediaFile(targetPath, 'video');
        } catch (vErr) {
          try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch {}
          throw vErr;
        }

        scene.videoPath = targetPath;
        scene.assetPath = targetPath;
        scene.status = 'ready';
        onProgress?.(100, 'Đã tải hoàn tất video phân cảnh.');
        return targetPath;
      } else {
        // Image generation
        onProgress?.(15, 'Đang gửi yêu cầu tạo ảnh (Imagen/Nano RPC)...');

        const genResult = await rpcClient.generateImage({
          prompt: effectivePrompt,
          aspectRatio: flowConfig.aspectRatio || '16:9',
          referenceAssets: refAssets,
          projectId: effectiveProjectId,
          win: lobbyWin,
        });

        const imageUrl = genResult.firstImageUrl || genResult.images?.[0]?.url;
        if (!imageUrl) {
          throw new GoogleFlowRpcError('Google Flow RPC hoàn tất nhưng không tìm thấy ảnh trong phản hồi.', {
            code: 'UPSTREAM_ERROR',
            retryable: true,
          });
        }

        onProgress?.(80, 'Đang tải tệp ảnh từ CDN về thư mục dự án...');
        await this.downloadMediaAsset(imageUrl, targetPath, {
          signal,
          win: lobbyWin,
          partition: rpcClient.partition,
        });

        try {
          this.validateMediaFile(targetPath, 'image');
        } catch (iErr) {
          try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch {}
          throw iErr;
        }

        scene.imagePath = targetPath;
        scene.assetPath = targetPath;
        delete scene.videoPath;
        scene.status = 'ready';
        onProgress?.(100, 'Đã tải hoàn tất ảnh phân cảnh.');
        return targetPath;
      }
    }, `ai_studio_visual_service_${scene.id}`);
  }

  // ==========================================================================
  // Media Asset Downloader & Storage Guard
  // ==========================================================================
  public async downloadMediaAsset(
    urlOrData: string,
    destinationPath: string,
    options?: {
      timeoutMs?: number;
      signal?: AbortSignal;
      win?: any;
      partition?: string;
      cookie?: string;
      headers?: Record<string, string>;
    }
  ): Promise<string> {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    if (!urlOrData || typeof urlOrData !== 'string') {
      throw new Error('Dữ liệu hoặc URL tệp media không hợp lệ');
    }

    if (options?.signal?.aborted) {
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    let targetUrl = urlOrData.trim();

    // 0. Local filesystem path that exists (check before URL normalization)
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('data:') && fs.existsSync(targetUrl)) {
      if (path.resolve(targetUrl) !== path.resolve(destinationPath)) {
        fs.copyFileSync(targetUrl, destinationPath);
      }
      return destinationPath;
    }

    // Chuẩn hoá URL không chứa scheme từ CDN (ví dụ //lh3.googleusercontent.com/...)
    if (targetUrl.startsWith('//')) {
      targetUrl = 'https:' + targetUrl;
    }

    // 1. Data URI (Base64)
    if (targetUrl.startsWith('data:')) {
      const commaIdx = targetUrl.indexOf(',');
      const cleanBase64 = commaIdx >= 0 ? targetUrl.slice(commaIdx + 1) : targetUrl;
      const buf = Buffer.from(cleanBase64, 'base64');
      if (buf.length === 0) {
        throw new Error('Dữ liệu Base64 rỗng, không thể lưu tệp media.');
      }
      fs.writeFileSync(destinationPath, buf);
      return destinationPath;
    }

    // 2. File URI (file://)
    if (targetUrl.startsWith('file://')) {
      let localPath = targetUrl.replace(/^file:\/\//, '');
      if (/^\/[a-zA-Z]:/.test(localPath)) {
        localPath = localPath.slice(1);
      }
      if (!fs.existsSync(localPath)) {
        throw new Error(`Tệp nguồn cục bộ không tồn tại: ${localPath}`);
      }
      if (path.resolve(localPath) !== path.resolve(destinationPath)) {
        fs.copyFileSync(localPath, destinationPath);
      }
      return destinationPath;
    }

    // Lấy cookie xác thực cho Google CDN nếu cần
    let cookieStr = options?.cookie || '';
    if (!cookieStr) {
      try {
        const rpcClient = this.getRpcClient();
        cookieStr = await rpcClient.getCookieString().catch(() => '');
      } catch {}
    }
    if (!cookieStr) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        cookieStr = await sessionMgr.getEffectiveCookieString().catch(() => '');
      } catch {}
    }

    // 4. HTTP / HTTPS URL from CDN
    // Priority A: BrowserWindow execution (if window has webContents and is active)
    // Only use for images, avoid for videos to prevent IPC payload limit and memory exhaustion
    const isVideoTarget = destinationPath.endsWith('.mp4') || destinationPath.endsWith('.webm');
    if (!isVideoTarget && options?.win && !options.win.isDestroyed() && options.win.webContents) {
      try {
        const base64Data = await options.win.webContents.executeJavaScript(`
          (async function() {
            const res = await fetch(${JSON.stringify(targetUrl)});
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          })()
        `);
        if (base64Data && typeof base64Data === 'string') {
          const pure = base64Data.replace(/^data:[^;]+;base64,/, '');
          const buf = Buffer.from(pure, 'base64');
          if (buf.length > 0) {
            fs.writeFileSync(destinationPath, buf);
            return destinationPath;
          }
        }
      } catch {
        // Fallback to next download methods
      }
    }

    if (options?.signal?.aborted) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    // Priority B: Electron session net.fetch (inherits Google cookies from partition)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      const ses = electron.session?.fromPartition?.(options?.partition || 'persist:google_veo');
      if (ses && typeof ses.fetch === 'function') {
        const fetchHeaders: Record<string, string> = { ...(options?.headers || {}) };
        if (cookieStr && !fetchHeaders['Cookie'] && !fetchHeaders['cookie']) {
          fetchHeaders['Cookie'] = cookieStr;
        }
        const res = await ses.fetch(targetUrl, { signal: options?.signal, headers: fetchHeaders });
        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          if (buf.length > 0) {
            fs.writeFileSync(destinationPath, buf);
            return destinationPath;
          }
        } else if (res.status === 401 || res.status === 403) {
          throw new GoogleFlowRpcError(
            `Phiên đăng nhập hoặc quyền truy cập CDN đã hết hạn (HTTP ${res.status})`,
            { code: 'SESSION_EXPIRED', status: res.status }
          );
        } else if (res.status === 429) {
          throw new GoogleFlowRpcError(
            `Tải tệp từ CDN bị giới hạn tần suất (HTTP ${res.status})`,
            { code: 'RATE_LIMITED', status: 429, retryable: true }
          );
        }
      }
    } catch (err: any) {
      if (options?.signal?.aborted || err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.code === 20) {
        try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
        throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
      }
      if (err?.code === 'SESSION_EXPIRED' || err?.code === 'RATE_LIMITED') {
        throw err;
      }
      if (err?.code === 'ENOSPC' || err?.code === 'EACCES' || err?.code === 'EPERM') {
        throw err;
      }
    }

    if (options?.signal?.aborted) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    // Priority C: Global fetch
    try {
      if (typeof fetch === 'function') {
        const fetchHeaders: Record<string, string> = { ...(options?.headers || {}) };
        if (cookieStr && !fetchHeaders['Cookie'] && !fetchHeaders['cookie']) {
          fetchHeaders['Cookie'] = cookieStr;
        }
        const res = await fetch(targetUrl, { signal: options?.signal, headers: fetchHeaders });
        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          if (buf.length > 0) {
            fs.writeFileSync(destinationPath, buf);
            return destinationPath;
          }
        } else if (res.status === 401 || res.status === 403) {
          throw new GoogleFlowRpcError(
            `Phiên đăng nhập hoặc quyền truy cập CDN đã hết hạn (HTTP ${res.status})`,
            { code: 'SESSION_EXPIRED', status: res.status }
          );
        } else if (res.status === 429) {
          throw new GoogleFlowRpcError(
            `Tải tệp từ CDN bị giới hạn tần suất (HTTP ${res.status})`,
            { code: 'RATE_LIMITED', status: 429, retryable: true }
          );
        }
      }
    } catch (err: any) {
      if (options?.signal?.aborted || err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.code === 20) {
        try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
        throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
      }
      if (err?.code === 'SESSION_EXPIRED' || err?.code === 'RATE_LIMITED') {
        throw err;
      }
      if (err?.code === 'ENOSPC' || err?.code === 'EACCES' || err?.code === 'EPERM') {
        throw err;
      }
    }

    if (options?.signal?.aborted) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    // Priority D: Node http / https streaming download
    const reqHeaders: Record<string, string> = { ...(options?.headers || {}) };
    if (cookieStr && !reqHeaders['Cookie'] && !reqHeaders['cookie']) {
      reqHeaders['Cookie'] = cookieStr;
    }
    await this.downloadViaHttp(
      targetUrl,
      destinationPath,
      options?.timeoutMs || 45000,
      5,
      options?.signal,
      reqHeaders
    );

    if (!fs.existsSync(destinationPath) || fs.statSync(destinationPath).size === 0) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new Error(`Tải tệp media thất bại hoặc tệp rỗng: ${destinationPath}`);
    }

    return destinationPath;
  }

  private async downloadViaHttp(
    url: string,
    dest: string,
    timeoutMs: number = 30000,
    maxRedirects: number = 5,
    signal?: AbortSignal,
    customHeaders?: Record<string, string>
  ): Promise<void> {
    if (signal?.aborted) {
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }
    if (maxRedirects <= 0) {
      throw new Error('Quá nhiều lần chuyển hướng khi tải file từ CDN.');
    }

    return new Promise<void>((resolve, reject) => {
      let isFinished = false;
      let activeFileStream: fs.WriteStream | null = null;
      let activeResStream: http.IncomingMessage | null = null;
      const getter = url.startsWith('https:') ? https : http;

      const reqHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        Accept: '*/*',
        ...(customHeaders || {}),
      };

      const cleanup = () => {
        try {
          if (activeFileStream && !activeFileStream.destroyed) {
            activeFileStream.destroy();
          }
        } catch {}
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch {}
      };

      const abortHandler = () => {
        if (isFinished) return;
        isFinished = true;
        try { req.destroy(); } catch {}
        try { activeResStream?.destroy(); } catch {}
        try { activeFileStream?.destroy(); } catch {}
        cleanup();
        reject(new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false }));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      const finishAndCleanListener = () => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
      };

      const req = getter.get(
        url,
        { headers: reqHeaders },
        (res) => {
          activeResStream = res;

          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            finishAndCleanListener();
            const nextUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).toString();
            this.downloadViaHttp(nextUrl, dest, timeoutMs, maxRedirects - 1, signal, customHeaders)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (res.statusCode === 401 || res.statusCode === 403) {
            res.resume();
            finishAndCleanListener();
            cleanup();
            reject(
              new GoogleFlowRpcError(
                `Phiên đăng nhập hoặc quyền truy cập CDN đã hết hạn (HTTP ${res.statusCode})`,
                { code: 'SESSION_EXPIRED', status: res.statusCode }
              )
            );
            return;
          }

          if (res.statusCode === 429) {
            res.resume();
            finishAndCleanListener();
            cleanup();
            reject(
              new GoogleFlowRpcError(
                'Tải tệp từ CDN bị giới hạn tần suất (HTTP 429)',
                { code: 'RATE_LIMITED', status: 429, retryable: true }
              )
            );
            return;
          }

          // Chấp nhận HTTP 200 (OK) và HTTP 206 (Partial Content)
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume();
            finishAndCleanListener();
            cleanup();
            reject(new Error(`Tải tệp từ CDN thất bại với mã HTTP ${res.statusCode}`));
            return;
          }

          let expectedBytes = -1;
          const cl = res.headers['content-length'];
          if (cl) {
            const parsed = parseInt(cl, 10);
            if (!isNaN(parsed) && parsed > 0) {
              expectedBytes = parsed;
            }
          }

          let downloadedBytes = 0;
          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
          });

          res.on('error', (err) => {
            if (isFinished) return;
            isFinished = true;
            finishAndCleanListener();
            try { file.destroy(); } catch {}
            cleanup();
            reject(new Error(`Lỗi luồng mạng tải CDN: ${err.message}`));
          });

          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const file = fs.createWriteStream(dest);
          activeFileStream = file;
          res.pipe(file);

          file.on('finish', () => {
            if (isFinished) return;
            isFinished = true;
            finishAndCleanListener();
            file.close((closeErr) => {
              if (closeErr) {
                cleanup();
                reject(closeErr);
                return;
              }
              if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
                cleanup();
                reject(
                  new Error(
                    `Tải tệp không hoàn chỉnh: nhận được ${downloadedBytes}/${expectedBytes} bytes`
                  )
                );
                return;
              }
              if (downloadedBytes === 0) {
                cleanup();
                reject(new Error(`Tải tệp thất bại: dữ liệu nhận được 0 bytes: ${dest}`));
                return;
              }
              resolve();
            });
          });

          file.on('error', (err) => {
            if (isFinished) return;
            isFinished = true;
            finishAndCleanListener();
            try { file.destroy(); } catch {}
            cleanup();
            reject(err);
          });
        }
      );

      req.setTimeout(timeoutMs, () => {
        if (!isFinished) {
          isFinished = true;
          finishAndCleanListener();
          try { req.destroy(); } catch {}
          try { activeResStream?.destroy(); } catch {}
          try { activeFileStream?.destroy(); } catch {}
          cleanup();
          reject(new Error(`Tải tệp từ CDN quá hạn (${Math.round(timeoutMs / 1000)}s)`));
        }
      });

      req.on('error', (err) => {
        if (!isFinished) {
          isFinished = true;
          finishAndCleanListener();
          try { activeFileStream?.destroy(); } catch {}
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Xác minh tính hợp lệ và định dạng của tệp media tải về.
   */
  public validateMediaFile(filePath: string, type: 'image' | 'video'): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Tệp media không tồn tại: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size <= 0) {
      throw new Error(`Tệp media rỗng (0 bytes): ${filePath}`);
    }

    const header = Buffer.alloc(256);
    const fd = fs.openSync(filePath, 'r');
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, header, 0, Math.min(256, stat.size), 0);
    } finally {
      fs.closeSync(fd);
    }

    if (bytesRead < 4) {
      throw new Error(`Tệp media quá nhỏ (${bytesRead} bytes): ${filePath}`);
    }

    if (type === 'image') {
      const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
      const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
      const isRiff = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;
      const isWebp = isRiff && bytesRead >= 12 &&
        header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50; // 'WEBP'
      const isGif = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
      if (!isPng && !isJpeg && !isWebp && !isGif) {
        throw new Error(`Tệp không phải định dạng ảnh hợp lệ (PNG/JPEG/WebP): ${filePath}`);
      }
    } else if (type === 'video') {
      if (stat.size < 24) {
        throw new Error(`Tệp video quá nhỏ (${stat.size} bytes): ${filePath}`);
      }
      const slice = header.subarray(0, bytesRead);
      const isFtyp = slice.indexOf(Buffer.from('ftyp')) >= 0;
      const isMoov = slice.indexOf(Buffer.from('moov')) >= 0;
      const isMdat = slice.indexOf(Buffer.from('mdat')) >= 0;
      const isWebm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
      if (!isFtyp && !isMoov && !isMdat && !isWebm) {
        throw new Error(`Tệp không phải định dạng video hợp lệ (MP4/WebM): ${filePath}`);
      }
    }
  }

  // ==========================================================================
  // High-Resolution Procedural Synthetic Card Generator
  // ==========================================================================
  public async generateSyntheticSceneCard(
    scene: StoryboardScene,
    outputPath: string,
    aspectRatio: FlowAspectRatio = '16:9',
    resolution: RenderingResolution = '720p'
  ): Promise<string> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const { width, height } = this.resolveDimensions(aspectRatio, resolution);
    const palette = ['navy', 'darkslategray', 'midnightblue', 'darkslateblue'];
    const color = palette[Math.abs(scene.lineIndex) % palette.length];

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`color=c=${color}:s=${width}x${height}:d=1`)
        .inputFormat('lavfi')
        .outputOptions('-vframes 1')
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err, _stdout, stderr) => {
          reject(new Error(`FFmpeg synthetic image generation failed: ${err.message} (${stderr})`));
        })
        .run();
    });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
      throw new Error(`Synthetic image file generation failed at: ${outputPath}`);
    }

    // Verify PNG magic bytes [0x89, 0x50, 0x4E, 0x47]
    const headerBuf = Buffer.alloc(4);
    const fd = fs.openSync(outputPath, 'r');
    try {
      fs.readSync(fd, headerBuf, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }

    if (
      headerBuf[0] !== 0x89 ||
      headerBuf[1] !== 0x50 ||
      headerBuf[2] !== 0x4e ||
      headerBuf[3] !== 0x47
    ) {
      throw new Error(`Generated asset is not a valid PNG image: ${outputPath}`);
    }

    return outputPath;
  }

  // ==========================================================================
  // Granular Step: Single-Scene Regeneration (F28)
  // ==========================================================================
  public async regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload,
    assetsDir?: string,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<RegenerateSceneAssetResult> {
    const targetDir = assetsDir || path.join(os.tmpdir(), 'vanhsub-single-scenes');
    fs.mkdirSync(targetDir, { recursive: true });

    const isVideo = payload.mode === 'video' || payload.flowConfig?.outputMode === 'video';
    const ext = isVideo ? 'mp4' : 'png';
    const outPath = path.join(targetDir, `scene_${payload.sceneId}_${Date.now()}.${ext}`);

    const mockScene: StoryboardScene = {
      id: payload.sceneId,
      lineIndex: 0,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: '',
      visualPrompt: payload.visualPrompt,
      motionType: isVideo ? 'video' : 'ken_burns',
      status: 'pending',
    };

    const flowConfig: AiStudioFlowEngineConfig = {
      aspectRatio: payload.flowConfig?.aspectRatio || '16:9',
      outputMode: isVideo ? 'video' : 'image',
      engine: payload.flowConfig?.engine,
      stylePromptPrefix: payload.flowConfig?.stylePromptPrefix || '',
      negativePrompt: payload.flowConfig?.negativePrompt || '',
      outputsPerScene: 1,
      downloadDir: targetDir,
      concurrency: 1,
      allowSyntheticFallback: payload.flowConfig?.allowSyntheticFallback,
    };

    const isLegacyDom = payload.flowConfig?.engine === 'dom' || payload.flowConfig?.engine === 'legacy_dom';
    const bridge = FlowBridgeServer.getInstance();
    const isBridgeConnected = bridge.isConnected();
    let useGoogleFlow = Boolean(this.rpcClient || (!isLegacyDom && payload.flowConfig?.engine !== 'synthetic'));
    if (!this.rpcClient && useGoogleFlow && !isBridgeConnected) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const status = await sessionMgr.validateSession();
        if (!status || !status.valid) {
          const hasExplicitFallback = Boolean(
            flowConfig.allowSyntheticFallback === true ||
            (payload.flowConfig as any)?.fallbackToSynthetic === true ||
            (payload.flowConfig as any)?.explicitFallback === true
          );
          if (!hasExplicitFallback) {
            throw new GoogleFlowRpcError(
              `Chưa đăng nhập Google Flow hoặc phiên làm việc đã hết hạn (${status?.detail || 'Chưa xác thực'}). Vui lòng mở Sảnh Google Flow trên giao diện để đăng nhập tài khoản.`,
              { code: 'SESSION_EXPIRED', retryable: false, suggestedAction: 'REAUTH_REQUIRED' }
            );
          } else {
            console.warn('[AiStudioVisualService] Phiên Google Flow chưa xác thực, chuyển sang fallback bản mẫu thiết kế.');
            useGoogleFlow = false;
          }
        }
      } catch (e: any) {
        if (e instanceof GoogleFlowRpcError) throw e;
        console.warn('[AiStudioVisualService] Lỗi khi kiểm tra validateSession:', e);
      }
    }

    let lobbyWin: any = null;
    if (!isBridgeConnected) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        lobbyWin = sessionMgr.getLobbyWindow();
        if (!lobbyWin || lobbyWin.isDestroyed()) {
          await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });
          lobbyWin = sessionMgr.getLobbyWindow();
        }
      } catch {
        lobbyWin = null;
      }
    }

    if (useGoogleFlow) {
      try {
        await this.generateViaGoogleFlow(mockScene, outPath, flowConfig, onProgress, signal);
        return {
          assetPath: outPath,
          videoPath: isVideo ? outPath : undefined,
          imagePath: !isVideo ? outPath : undefined,
        };
      } catch (err: any) {
        const classified = classifyFlowRpcError(err);
        console.warn(`[AiStudioVisualService] regenerateSceneAsset RPC thất bại [Mã lỗi: ${classified.code}]:`, classified.message);

        const hasExplicitFallback = Boolean(
          flowConfig.allowSyntheticFallback === true ||
          (flowConfig as any).fallbackToSynthetic === true ||
          (flowConfig as any).explicitFallback === true
        );

        const isRpcEngine = Boolean(
          this.rpcClient ||
          !isLegacyDom ||
          payload.flowConfig?.engine === 'rpc' ||
          payload.flowConfig?.engine === 'flow_rpc' ||
          (payload.flowConfig as any)?.useRpc === true
        );

        const isTerminal =
          classified.code === 'SESSION_EXPIRED' ||
          classified.code === 'RATE_LIMITED' ||
          classified.code === 'CONTENT_POLICY_VIOLATION' ||
          classified.code === 'CONTENT_REJECTED';

        if (!hasExplicitFallback) {
          if (isRpcEngine) {
            throw classified;
          } else if (flowConfig.allowSyntheticFallback === false) {
            throw classified;
          } else if (isTerminal && lobbyWin) {
            throw classified;
          }
        }
      }
    }

    const fallbackPath = outPath.endsWith('.mp4') ? outPath.replace(/\.mp4$/, '.png') : outPath;
    await this.generateSyntheticSceneCard(mockScene, fallbackPath, flowConfig.aspectRatio, '720p');
    return { assetPath: fallbackPath, imagePath: fallbackPath };
  }
}

export const aiStudioVisualService = AiStudioVisualService.getInstance();
