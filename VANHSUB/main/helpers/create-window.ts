import path from 'path'
import { BrowserWindow } from 'electron'

export function createWindow(name: string, options: Electron.BrowserWindowConstructorOptions) {
  const window = new BrowserWindow({
    ...options,
    webPreferences: {
      ...options.webPreferences,
      preload: path.join(import.meta.dirname, '../preload.js'),
    },
  })

  window.setMenuBarVisibility(false)
  return window
}