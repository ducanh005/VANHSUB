import { contextBridge, ipcRenderer } from 'electron'

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
  dialog: {
    openMediaFile: () => ipcRenderer.invoke('dialog:openMediaFile'),
    showInFolder: (filePath: string) => ipcRenderer.invoke('dialog:showInFolder', filePath),
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
