import { contextBridge, ipcRenderer, webUtils } from 'electron'

const vanhsub = {
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll'),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (input: any) => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, updates: any) => ipcRenderer.invoke('tasks:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    start: (id: string) => ipcRenderer.invoke('tasks:start', id),
    cancel: (id: string) => ipcRenderer.invoke('tasks:cancel', id),
    readSrt: (srtPath: string) => ipcRenderer.invoke('tasks:readSrt', srtPath),
    writeSrt: (srtPath: string, content: string) => ipcRenderer.invoke('tasks:writeSrt', srtPath, content),
    addFromUrl: (url: string) => ipcRenderer.invoke('tasks:addFromUrl', url),
    runPipeline: (id: string, opts?: { replaceAudio?: boolean }) =>
      ipcRenderer.invoke('tasks:runPipeline', id, opts ?? null),
    runPipelineBatch: (ids: string[]) => ipcRenderer.invoke('tasks:runPipelineBatch', ids),
    importSrt: (id: string, sourceSrtPath: string) =>
      ipcRenderer.invoke('tasks:importSrt', id, sourceSrtPath),

    onUpdate: (callback: (tasks: any[]) => void) => {
      const subscription = (_event: any, tasks: any[]) => callback(tasks)
      ipcRenderer.on('tasks:updated', subscription)
      return () => {
        ipcRenderer.removeListener('tasks:updated', subscription)
      }
    },
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  },
  ai: {
    polishLine: (payload: { text: string; prev?: string; next?: string }) =>
      ipcRenderer.invoke('ai:polishLine', payload),
    translateLine: (payload: { text: string; targetLanguage?: string; prev?: string; next?: string }) =>
      ipcRenderer.invoke('ai:translateLine', payload),
    cleanSubtitles: (items: Array<{ startMs: number; endMs: number; text: string }>) =>
      ipcRenderer.invoke('ai:cleanSubtitles', items),
  },
  translate: {
    start: (id: string, targetLanguage?: string) =>
      ipcRenderer.invoke('translate:start', id, targetLanguage),
    cancel: (id: string) => ipcRenderer.invoke('translate:cancel', id),
  },
  export: {
    start: (id: string, mode: 'hardsub' | 'softsub', mask?: unknown, style?: unknown, advancedOptions?: unknown) =>
      ipcRenderer.invoke('export:start', id, mode, mask ?? null, style ?? null, advancedOptions ?? null),
    // Tách nhạc nền / giọng ra 2 file mp3 bằng Demucs AI
    separateStems: (id: string) => ipcRenderer.invoke('export:separateStems', id),
  },
  ocr: {
    // Quét phụ đề cứng trong video bằng OCR → tạo file .srt cho tác vụ
    start: (id: string, options?: any) => ipcRenderer.invoke('ocr:start', id, options),
    cancel: (id: string) => ipcRenderer.invoke('ocr:cancel', id),
  },
  tts: {
    start: (
      id: string,
      voice?: string,
      speed?: number,
      voiceOverrides?: Record<string, string>,
      engine?: 'viettts' | 'tiktok'
    ) => ipcRenderer.invoke('tts:start', id, voice, speed, voiceOverrides, engine),
    cancel: (id: string) => ipcRenderer.invoke('tts:cancel', id),
    regenerateLine: (id: string, lineIndex: number) =>
      ipcRenderer.invoke('tts:regenerateLine', id, lineIndex),
    voices: () => ipcRenderer.invoke('tts:voices'),
    checkConnection: () => ipcRenderer.invoke('tts:check-connection'),
    preview: (text: string, voice?: string, speed?: number, engine?: 'viettts' | 'tiktok') =>
      ipcRenderer.invoke('tts:preview', text, voice, speed, engine),
    voiceSamples: () => ipcRenderer.invoke('tts:voice-samples'),
    addVoiceSample: (name: string) => ipcRenderer.invoke('tts:add-voice-sample', name),
    addVoiceSampleFromUrl: (name: string, url: string) =>
      ipcRenderer.invoke('tts:add-voice-sample-from-url', name, url),
    removeVoiceSample: (name: string) => ipcRenderer.invoke('tts:remove-voice-sample', name),
  },
  dubbing: {
    start: (
      id: string,
      replaceAudio: boolean = true,
      options?: { syncMode?: 'strict' | 'flexible' | 'video-stretch'; mixOriginalAudio?: boolean; vocalSeparation?: boolean }
    ) => ipcRenderer.invoke('dubbing:start', id, replaceAudio, options ?? null),
  },
  tiktokTts: {
    // TikTok TTS thử nghiệm — sessionid chỉ đi LÊN main process, không bao giờ
    // có method nào đọc lại giá trị session
    status: () => ipcRenderer.invoke('tiktok-tts:status'),
    saveSession: (sessionId: string) => ipcRenderer.invoke('tiktok-tts:save-session', sessionId),
    removeSession: () => ipcRenderer.invoke('tiktok-tts:remove-session'),
    validate: () => ipcRenderer.invoke('tiktok-tts:validate'),
    voices: () => ipcRenderer.invoke('tiktok-tts:voices'),
    synthesize: (text: string, voice: string) => ipcRenderer.invoke('tiktok-tts:synthesize', text, voice),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    delete: (modelName: string) => ipcRenderer.invoke('models:delete', modelName),
    // Thư mục lưu model Whisper trên đĩa — hiển thị vị trí ở trang Cài đặt
    directory: () => ipcRenderer.invoke('models:directory'),
    getSystemInfo: () => ipcRenderer.invoke('system:info'),
  },
  dialog: {
    openMediaFile: () => ipcRenderer.invoke('dialog:openMediaFile'),
    openSrtFile: () => ipcRenderer.invoke('dialog:openSrtFile'),
    openImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),
    showInFolder: (filePath: string) => ipcRenderer.invoke('dialog:showInFolder', filePath),
    chooseDirectory: () => ipcRenderer.invoke('dialog:chooseDirectory'),
  },
  files: {
    // Electron >=32 đã bỏ File.path — phải lấy đường dẫn qua webUtils ở phía renderer
    getPath: (file: File) => webUtils.getPathForFile(file),
  },
  logs: {
    // Đăng ký nhận log từ main process; trả về hàm huỷ đăng ký
    onLog: (callback: (entry: { level: string; text: string; ts: number }) => void) => {
      const handler = (_event: unknown, entry: { level: string; text: string; ts: number }) =>
        callback(entry);
      ipcRenderer.on('app:log', handler);
      return () => ipcRenderer.removeListener('app:log', handler);
    },
  },
}

const handler = {
  send(channel: string, value: string) {
    ipcRenderer.send(channel, value)
  },
  on(channel: string, callback: (...args: unknown[]) => void) {
    const subscription = (_event: any, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
}

contextBridge.exposeInMainWorld('vanhsub', vanhsub)
contextBridge.exposeInMainWorld('ipc', handler)
