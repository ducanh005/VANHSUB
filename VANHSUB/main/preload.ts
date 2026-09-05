import { contextBridge, ipcRenderer, webUtils } from 'electron'

const vanhsub = {
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll'),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (input: any) => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, updates: any) => ipcRenderer.invoke('tasks:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    start: (id: string) => ipcRenderer.invoke('tasks:start', id),
    readSrt: (srtPath: string) => ipcRenderer.invoke('tasks:readSrt', srtPath),
    writeSrt: (srtPath: string, content: string) => ipcRenderer.invoke('tasks:writeSrt', srtPath, content),
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
  },
  translate: {
    start: (id: string, targetLanguage?: string) =>
      ipcRenderer.invoke('translate:start', id, targetLanguage),
  },
  export: {
    start: (id: string, mode: 'hardsub' | 'softsub', mask?: unknown) =>
      ipcRenderer.invoke('export:start', id, mode, mask ?? null),
  },
  tts: {
    start: (id: string, voice?: string, speed?: number, voiceOverrides?: Record<string, string>) =>
      ipcRenderer.invoke('tts:start', id, voice, speed, voiceOverrides),
    voices: () => ipcRenderer.invoke('tts:voices'),
    checkConnection: () => ipcRenderer.invoke('tts:check-connection'),
    preview: (text: string, voice?: string, speed?: number) =>
      ipcRenderer.invoke('tts:preview', text, voice, speed),
    voiceSamples: () => ipcRenderer.invoke('tts:voice-samples'),
    addVoiceSample: (name: string) => ipcRenderer.invoke('tts:add-voice-sample', name),
    removeVoiceSample: (name: string) => ipcRenderer.invoke('tts:remove-voice-sample', name),
  },
  dubbing: {
    start: (id: string, replaceAudio: boolean = true) =>
      ipcRenderer.invoke('dubbing:start', id, replaceAudio),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    delete: (modelName: string) => ipcRenderer.invoke('models:delete', modelName),
    getSystemInfo: () => ipcRenderer.invoke('system:info'),
  },
  dialog: {
    openMediaFile: () => ipcRenderer.invoke('dialog:openMediaFile'),
    openSrtFile: () => ipcRenderer.invoke('dialog:openSrtFile'),
    showInFolder: (filePath: string) => ipcRenderer.invoke('dialog:showInFolder', filePath),
    chooseDirectory: () => ipcRenderer.invoke('dialog:chooseDirectory'),
  },
  files: {
    // Electron >=32 đã bỏ File.path — phải lấy đường dẫn qua webUtils ở phía renderer
    getPath: (file: File) => webUtils.getPathForFile(file),
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
