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

  onProgress?.(92, 'Đang lấy URL media...');

  // Lấy danh sách media trong project
  let allMedia: MediaUrls[] = [];
  try {
    allMedia = await client.listProjectMedia(projectId);
    console.log(`[FlowOperationPoller] 📋 Project media sau khi done: ${allMedia.length} items`);
  } catch (err: any) {
    console.warn('[FlowOperationPoller] Không lấy được project media list:', err.message);
  }

  // Tìm media khớp với targetMediaId nếu có
  let videoUrl: string | undefined;
  let imageUrl: string | undefined;

  if (targetMediaId) {
    const target = allMedia.find((m) => m.mediaId === targetMediaId);
    videoUrl = target?.videoUrl;
    imageUrl = target?.imageUrl;
  }

  // Fallback: lấy media mới nhất có video URL
  if (!videoUrl && allMedia.length > 0) {
    const withVideo = allMedia.filter((m) => m.videoUrl);
    if (withVideo.length > 0) {
      videoUrl = withVideo[withVideo.length - 1].videoUrl;
      console.log(`[FlowOperationPoller] ℹ️ Dùng video URL mới nhất trong project: ${videoUrl?.slice(0, 60)}`);
    }
  }

  onProgress?.(100, 'Video đã sẵn sàng!');

  return { operation, videoUrl, imageUrl, allMedia };
}
