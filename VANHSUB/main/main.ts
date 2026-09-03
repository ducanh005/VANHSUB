import fs from 'fs'
import path from 'path'
import url from 'url'
import { Readable } from 'stream'
import { app, ipcMain, dialog, BrowserWindow, protocol, net, shell } from 'electron'
import si from 'systeminformation'

import { createWindow } from './helpers/create-window'
import { TaskStore, type CreateTaskInput, type Task } from './store/taskStore'
import { SettingsStore, type AppSettings } from './store/settingsStore'
import { polishSubtitleLine } from './ai/geminiClient'
import { TaskRunner } from './asr/taskRunner'
import { TranslateRunner } from './translate/translateRunner'
import { ExportRunner } from './render/exportRunner'
import type { MaskRegion } from './render/videoRenderer'
import { TTSRunner } from './render/ttsRunner'
import { DubbingRunner } from './render/dubbingRunner'
import { checkVietTtsConnection, getAvailableVoices, previewTts } from './render/ttsEngine'

const isProd = process.env.NODE_ENV === 'production'

// Phải đăng ký scheme trước khi app ready — 'app' dùng cho render output ở prod,
// 'vanhmedia' dùng để stream file media local vào <video> (cả dev lẫn prod).
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
    {
      scheme: 'vanhmedia',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
} catch (e) {}

if (isProd) {
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

// =========================================================================
// VANHMEDIA PROTOCOL — stream file media local cho trình xem trước
// Xử lý header Range để <video> seek được (206 Partial Content).
// URL dạng: vanhmedia://local/<encodeURIComponent(đường_dẫn_file)>
// =========================================================================

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
}

app.whenReady().then(() => {
  protocol.handle('vanhmedia', async (request) => {
    try {
      const requestUrl = new URL(request.url)
      const filePath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ''))

      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response(`Không tìm thấy file media: ${filePath}`, { status: 404 })
      }

      const stat = fs.statSync(filePath)
      const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
      const rangeHeader = request.headers.get('Range')

      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
        if (match) {
          let start = match[1] ? parseInt(match[1], 10) : 0
          let end = match[2] ? parseInt(match[2], 10) : stat.size - 1
          if (Number.isNaN(start) || start < 0) start = 0
          if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1

          if (start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }

          const stream = Readable.toWeb(
            fs.createReadStream(filePath, { start, end })
          ) as unknown as BodyInit

          return new Response(stream, {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
            },
          })
        }
      }

      const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as BodyInit
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch (err: any) {
      return new Response(`Lỗi stream media: ${err?.message || err}`, { status: 500 })
    }
  })
})

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

ipcMain.handle('tasks:writeSrt', async (_event, srtPath: string, content: string) => {
  fs.writeFileSync(srtPath, content, 'utf-8')
  return true
})

// =========================================================================
// SETTINGS & AI IPC HANDLERS
// =========================================================================

const SETTING_KEYS: Array<keyof AppSettings> = [
  'geminiApiKey',
  'geminiModel',
  'targetLanguage',
  'asrModel',
  'exportDir',
  'translateBatchSize',
  'translateConcurrency',
  'autoTranslateAfterAsr',
  'vietTtsEndpoint',
  'ttsVoice',
  'ttsSpeed'
]

ipcMain.handle('settings:get', async (_event, key: keyof AppSettings) => {
  if (!SETTING_KEYS.includes(key)) {
    throw new Error(`Setting key không hợp lệ: ${key}`)
  }
  return SettingsStore.get(key)
})

ipcMain.handle('settings:set', async (_event, key: keyof AppSettings, value: any) => {
  if (!SETTING_KEYS.includes(key)) {
    throw new Error(`Setting key không hợp lệ: ${key}`)
  }
  SettingsStore.set(key, value)
  return true
})

// "Sửa câu bằng AI": hiệu đính 1 câu phụ đề bằng Gemini, kèm ngữ cảnh câu trước/sau
ipcMain.handle('ai:polishLine', async (_event, payload: { text: string; prev?: string; next?: string }) => {
  return polishSubtitleLine(payload)
})

// Dịch thuật AI qua TranslateRunner
ipcMain.handle('translate:start', async (_event, id: string, targetLanguage?: string) => {
  TranslateRunner.runTranslate(id, targetLanguage, () => {
    broadcastTasksUpdate()
  })
  return true
})

// Xuất video qua ExportRunner (mask: tùy chọn che vùng phụ đề cũ khi hardsub)
ipcMain.handle(
  'export:start',
  async (_event, id: string, mode: 'hardsub' | 'softsub', mask?: MaskRegion | null) => {
    ExportRunner.runExport(id, mode, mask, () => {
      broadcastTasksUpdate()
    })
    return true
  }
)

// Tạo lồng tiếng bằng VietTTS
ipcMain.handle('tts:start', async (_event, id: string, voice?: string, speed?: number) => {
  TTSRunner.runTTS(id, voice, speed, () => {
    broadcastTasksUpdate()
  })
  return true
})

// Lấy danh sách giọng nói có sẵn
ipcMain.handle('tts:voices', async () => {
  return getAvailableVoices()
})

// Kiểm tra kết nối VietTTS
ipcMain.handle('tts:check-connection', async () => {
  return checkVietTtsConnection()
})

// Nghe thử giọng đọc TTS (1 câu ngắn) — trả base64 mp3 cho renderer phát trực tiếp
ipcMain.handle('tts:preview', async (_event, text: string, voice?: string, speed?: number) => {
  const sampleText = (text || '').trim().slice(0, 300) || 'Xin chào! Đây là giọng đọc thử nghiệm của VANHSUB.'
  return previewTts(sampleText, voice, speed)
})

// Dubbing video (mux audio vào video)
ipcMain.handle('dubbing:start', async (_event, id: string, replaceAudio: boolean = true) => {
  DubbingRunner.runDubbing(id, replaceAudio, () => {
    broadcastTasksUpdate()
  })
  return true
})

// Quản lý model Whisper
function getModelsDirectory() {
  const devPath = path.resolve(__dirname, '..', 'node_modules/nodejs-whisper/cpp/whisper.cpp/models');
  if (fs.existsSync(devPath)) return devPath;

  const appPath = path.resolve(app.getAppPath(), 'node_modules/nodejs-whisper/cpp/whisper.cpp/models');
  if (fs.existsSync(appPath)) return appPath;

  const prodPath = path.resolve(process.resourcesPath, 'app.asar.unpacked/node_modules/nodejs-whisper/cpp/whisper.cpp/models');
  if (fs.existsSync(prodPath)) return prodPath;

  return devPath;
}

// Lấy thông tin hệ thống (RAM, CPU cores, etc.)
ipcMain.handle('system:info', async () => {
  try {
    const memory = await si.mem();
    const cpu = await si.cpu();
    const osInfo = await si.osInfo();

    return {
      totalMemory: Math.round(memory.total / (1024 * 1024)), // Convert to MB
      freeMemory: Math.round(memory.available / (1024 * 1024)), // Convert to MB
      cpuCores: cpu.cores || 1,
      cpuModel: cpu.brand + ' ' + cpu.model,
      platform: osInfo.platform,
    };
  } catch (err) {
    console.error('Error getting system info:', err);
    return {
      totalMemory: 0,
      freeMemory: 0,
      cpuCores: 1,
      cpuModel: 'Unknown',
      platform: 'unknown',
    };
  }
});

ipcMain.handle('models:list', async () => {
  const dir = getModelsDirectory();
  if (!fs.existsSync(dir)) {
    return [];
  }
  try {
    const files = fs.readdirSync(dir);
    const models = files
      .filter((file) => file.startsWith('ggml-') && file.endsWith('.bin'))
      .map((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const sizeMb = (stat.size / (1024 * 1024)).toFixed(1) + ' MB';
        const name = file.substring(5, file.length - 4);
        return { name, fileName: file, size: sizeMb };
      });
    return models;
  } catch (err) {
    console.error('Lỗi khi đọc danh sách model:', err);
    return [];
  }
})

ipcMain.handle('models:delete', async (_event, modelName: string) => {
  const dir = getModelsDirectory();
  const file = `ggml-${modelName}.bin`;
  const filePath = path.join(dir, file);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      console.error(`Lỗi khi xoá model ${modelName}:`, err);
      throw err;
    }
  }
  return false;
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

// Chọn thư mục (dùng cho cài đặt thư mục xuất mặc định ở trang Settings)
ipcMain.handle('dialog:chooseDirectory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục lưu file xuất',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
