import { toast } from 'sonner';

export interface DownloadProgress {
  percent: number;
  speed?: string;
  eta?: string;
  status: 'downloading' | 'processing' | 'completed' | 'error';
  stageDescription?: string;
}

export interface ActiveDownload {
  url: string;
  cleanUrl: string;
  platform: 'youtube' | 'douyin' | 'bilibili' | 'tiktok' | 'other';
  title: string;
  author?: string;
  duration?: number;
  durationFormatted?: string;
  thumbnail?: string;
  quality?: string;
  noWatermarkUrl?: string;
  outputDir?: string;
  customFileName?: string;
  progress: DownloadProgress;
  isDownloading: boolean;
  error?: string | null;
  completedTask?: any;
}

export interface BackgroundDownloadState {
  active: ActiveDownload | null;
}

let state: BackgroundDownloadState = {
  active: null,
};

const listeners = new Set<() => void>();
let isIpcSubscribed = false;

function setState(patch: Partial<BackgroundDownloadState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function ensureIpcSubscription() {
  if (isIpcSubscribed || typeof window === 'undefined' || !window.vanhsub?.downloader?.onProgress) {
    return;
  }
  isIpcSubscribed = true;
  window.vanhsub.downloader.onProgress((p: DownloadProgress) => {
    if (!state.active) return;
    const isError = p.status === 'error';
    const isCompleted = p.status === 'completed' || p.percent >= 100;

    setState({
      active: {
        ...state.active,
        progress: p,
        isDownloading: !isError && !isCompleted,
        error: isError ? p.stageDescription || 'Lỗi khi tải video' : null,
      },
    });
  });
}

export const backgroundDownloadManager = {
  getState(): BackgroundDownloadState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    ensureIpcSubscription();
    return () => listeners.delete(listener);
  },

  async startDownload(params: {
    url: string;
    cleanUrl?: string;
    platform: 'youtube' | 'douyin' | 'bilibili' | 'tiktok' | 'other';
    title: string;
    author?: string;
    duration?: number;
    durationFormatted?: string;
    thumbnail?: string;
    quality?: string;
    noWatermarkUrl?: string;
    outputDir?: string;
    customFileName?: string;
  }): Promise<{ task: any; result: any }> {
    ensureIpcSubscription();

    const activeItem: ActiveDownload = {
      url: params.url,
      cleanUrl: params.cleanUrl || params.url,
      platform: params.platform,
      title: params.title,
      author: params.author,
      duration: params.duration,
      durationFormatted: params.durationFormatted,
      thumbnail: params.thumbnail,
      quality: params.quality,
      noWatermarkUrl: params.noWatermarkUrl,
      outputDir: params.outputDir,
      customFileName: params.customFileName,
      progress: {
        percent: 0,
        status: 'downloading',
        stageDescription: 'Đang chuẩn bị tải video...',
      },
      isDownloading: true,
      error: null,
      completedTask: null,
    };

    setState({ active: activeItem });

    try {
      if (!window.vanhsub?.downloader?.download) {
        throw new Error('Tính năng tải video chưa sẵn sàng');
      }

      const res = await window.vanhsub.downloader.download({
        url: params.cleanUrl || params.url,
        quality: params.quality,
        noWatermarkUrl: params.noWatermarkUrl,
        outputDir: params.outputDir,
        customFileName: params.customFileName,
      });

      if (state.active && state.active.url === params.url) {
        setState({
          active: {
            ...state.active,
            isDownloading: false,
            completedTask: res.task,
            progress: {
              ...state.active.progress,
              percent: 100,
              status: 'completed',
              stageDescription: 'Đã hoàn tất tải video!',
            },
          },
        });
      }

      toast.success(`Tải video thành công: ${params.title}`);
      return res;
    } catch (err: any) {
      const errorMsg = err?.message || 'Tải video thất bại';
      if (state.active && state.active.url === params.url) {
        setState({
          active: {
            ...state.active,
            isDownloading: false,
            error: errorMsg,
            progress: {
              ...state.active.progress,
              status: 'error',
              stageDescription: errorMsg,
            },
          },
        });
      }
      toast.error(errorMsg);
      throw err;
    }
  },

  dismiss() {
    setState({ active: null });
  },
};
