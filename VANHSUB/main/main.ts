import fs from 'fs'
import path from 'path'
import url from 'url'
import { app, ipcMain, dialog, BrowserWindow, protocol, net, shell } from 'electron'

import { createWindow } from './helpers/create-window'
import { TaskStore, type CreateTaskInput, type Task } from './store/taskStore'
import { TaskRunner } from './asr/taskRunner'

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  try {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'app',
        privileges: {
          standard: true,
          secure: true,
          allowServiceWorkers: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ])
  } catch (e) {}

  app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
      const requestUrl = new URL(request.url)
      let pathname = decodeURIComponent(requestUrl.pathname)
      if (pathname.startsWith('/')) pathname = pathname.slice(1)

      const appDir = path.resolve(app.getAppPath(), 'app')
      let filePath = path.join(appDir, pathname)

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html')
      } else if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) {
        filePath = `${filePath}.html`
      }

      if (!fs.existsSync(filePath)) {
        filePath = path.join(appDir, '404.html')
      }

      return net.fetch(url.pathToFileURL(filePath).toString())
    })
  })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

let mainWindow: any = null

function broadcastTasksUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tasks:updated', TaskStore.getAll())
  }
}

;(async () => {
  await app.whenReady()

  mainWindow = createWindow('main', {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2] || '8888'
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }
})()

app.on('window-all-closed', () => {
  app.quit()
})

// =========================================================================
// TASK MANAGEMENT IPC HANDLERS
// =========================================================================

ipcMain.handle('tasks:getAll', async () => {
  return TaskStore.getAll()
})

ipcMain.handle('tasks:get', async (_event, id: string) => {
  return TaskStore.getById(id)
})

ipcMain.handle('tasks:create', async (_event, input: CreateTaskInput) => {
  const task = TaskStore.create(input)
  broadcastTasksUpdate()
  return task
})

ipcMain.handle('tasks:update', async (_event, id: string, updates: Partial<Task>) => {
  const task = TaskStore.update(id, updates)
  broadcastTasksUpdate()
  return task
})

ipcMain.handle('tasks:delete', async (_event, id: string) => {
  const result = TaskStore.delete(id)
  broadcastTasksUpdate()
  return result
})

ipcMain.handle('tasks:start', async (_event, id: string) => {
  TaskRunner.runTask(id, () => {
    broadcastTasksUpdate()
  })
  return true
})

ipcMain.handle('tasks:readSrt', async (_event, srtPath: string) => {
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File SRT không tồn tại: ${srtPath}`)
  }
  return fs.readFileSync(srtPath, 'utf-8')
})

// =========================================================================
// NATIVE DIALOG & SHELL IPC HANDLERS
// =========================================================================

ipcMain.handle('dialog:openMediaFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file Video hoặc Audio',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Video & Audio',
        extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'mp3', 'wav', 'm4a', 'flac', 'aac'],
      },
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
      { name: 'Tất cả file', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths
})

ipcMain.handle('dialog:showInFolder', async (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
