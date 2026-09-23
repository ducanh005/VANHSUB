/**
 * FlowOperationPoller.ts
 *
 * Tiện ích poll async video operation đến khi hoàn tất (STATUS_DONE = "CAE").
 * Không cần BrowserWindow — poll qua net.fetch thuần túy.
 *
 * Wrapper mỏng trên FlowRpcClient.pollOperation() với progress callback
 * tích hợp vào FlowStateContext.onProgress format của app.
 */

import type { OperationStatus } from './FlowBatchBuilder';
import type { MediaUrls } from './FlowBatchBuilder';
import { getFlowRpcClient } from './FlowRpcClient';
import { OPERATION_POLL_TIMEOUT_MS } from './FlowBatchConstants';

export interface PollResult {
  operation: OperationStatus;
  /** URL video cuối cùng nếu lấy được từ project media list */
  videoUrl?: string;
  /** URL ảnh thumbnail nếu có */
  imageUrl?: string;
  /** Tất cả media trong project sau khi hoàn tất */
  allMedia: MediaUrls[];
}

/**
 * Poll operation cho đến khi done, sau đó lấy URL video từ project media.
 *
 * @param operationId Operation ID từ generateVideo() / generateVideoFirstLast() / ...
 * @param projectId UUID project
 * @param targetMediaId media_id cần lấy URL (nếu biết trước)
 * @param onProgress Callback (percent 0–100, message)
 * @param isCancelled Callback
 */
export async function pollAndGetMediaUrl(
  operationId: string,
  projectId: string,
  targetMediaId?: string,
  onProgress?: (pct: number, msg: string) => void,
  isCancelled?: () => boolean
): Promise<PollResult> {
  const client = getFlowRpcClient();

  // Poll đến khi done
  const operation = await client.pollOperation(
    operationId,
    projectId,
    onProgress,
    isCancelled
  );

  onProgress?.(95, 'Đang trích xuất URL video...');

  let videoUrl: string | undefined = operation.videoUrl;
  let imageUrl: string | undefined = operation.imageUrl;
  const targetId = targetMediaId || operation.mediaId;

  // Nếu đã có targetId nhưng chưa có URL hoặc muốn lấy link tươi từ as29s (chuẩn 100% Google Flow)
  if (targetId && !videoUrl) {
    try {
      const directUrl = await client.getMediaUrl(targetId, projectId);
      if (directUrl) {
        videoUrl = directUrl;
        console.log(`[FlowOperationPoller] 🎯 Lấy video URL trực tiếp từ as29s: ${videoUrl.slice(0, 60)}`);
      }
    } catch (err: any) {
      console.warn('[FlowOperationPoller] Gọi as29s thất bại, chuyển sang listProjectMedia:', err.message);
    }
  }

  // Lấy danh sách media trong project làm fallback
  let allMedia: MediaUrls[] = [];
  if (!videoUrl) {
    try {
      allMedia = await client.listProjectMedia(projectId);
      console.log(`[FlowOperationPoller] 📋 Project media sau khi done: ${allMedia.length} items`);
    } catch (err: any) {
      console.warn('[FlowOperationPoller] Không lấy được project media list:', err.message);
    }

    if (targetId) {
      const target = allMedia.find((m) => m.mediaId === targetId);
      videoUrl = target?.videoUrl;
      imageUrl = target?.imageUrl;
    }

    if (!videoUrl && allMedia.length > 0) {
      const withVideo = allMedia.filter((m) => m.videoUrl);
      if (withVideo.length > 0) {
        videoUrl = withVideo[withVideo.length - 1].videoUrl;
        console.log(`[FlowOperationPoller] ℹ️ Dùng video URL mới nhất trong project: ${videoUrl?.slice(0, 60)}`);
      }
    }
  }

  onProgress?.(100, 'Video đã sẵn sàng!');

  return { operation, videoUrl, imageUrl, allMedia };
}
