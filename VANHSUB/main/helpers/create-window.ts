import path from 'path'
import { BrowserWindow } from 'electron/main'

export function createWindow(name: string, options: any) {
  const window = new BrowserWindow({
    ...options,
    webPreferences: {
      ...options.webPreferences,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  window.setMenuBarVisibility(false)
  return window
}
