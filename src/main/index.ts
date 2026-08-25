import { app, BrowserWindow, Menu, Tray, nativeImage, shell, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import { DB } from './db'
import { Services } from './services'
import { registerIpc, type WindowCtl } from './ipc'

app.setName('灵伴')
app.setPath('userData', path.join(app.getPath('appData'), '灵伴'))

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let db: DB | null = null
let services: Services | null = null
let panelOpen = false
let savePositionTimer: NodeJS.Timeout | null = null

const WINDOW_SIZE = { w: 360, h: 460 }
const PANEL_SIZE = { w: 800, h: 600 }

function isDev(): boolean {
  return !!process.env['ELECTRON_RENDERER_URL']
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_SIZE.w,
    height: WINDOW_SIZE.h,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  win.setResizable(false)
  win.setMaximizable(false)
  win.setMinimizable(false)
  win.setFullScreenable(false)
  win.setMovable(false)
  win.setMinimumSize(WINDOW_SIZE.w, WINDOW_SIZE.h)
  win.setMaximumSize(WINDOW_SIZE.w, WINDOW_SIZE.h)
  win.once('ready-to-show', () => win.show())
  win.on('move', savePositionSoon)
  win.on('closed', () => { mainWindow = null })
  win.webContents.on('render-process-gone', () => {
    mainWindow = null
    setTimeout(() => { if (!mainWindow) mainWindow = createWindow() }, 1000)
  })
  win.webContents.on('did-finish-load', () => console.log('[main] renderer loaded'))
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log('[main] renderer load FAILED', code, desc, url))
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log('[renderer:' + level + ']', message, 'at', sourceId + ':' + line)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev() && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

function savePosition(): void {
  if (!mainWindow || !db) return
  const [x, y] = mainWindow.getPosition()
  db.setSetting('window_pos', { x, y })
}

function savePositionSoon(): void {
  if (savePositionTimer) clearTimeout(savePositionTimer)
  savePositionTimer = setTimeout(() => { savePositionTimer = null; savePosition() }, 400)
}

function restorePosition(win: BrowserWindow): void {
  if (!db) return
  const pos = db.getSetting<{ x: number; y: number } | null>('window_pos', null)
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    win.setPosition(pos.x, pos.y)
  } else {
    const wa = screen.getPrimaryDisplay().workArea
    win.setPosition(wa.x + wa.width - WINDOW_SIZE.w - 30, wa.y + wa.height - WINDOW_SIZE.h - 40)
  }
}

const windowCtl: WindowCtl = {
  setPanelOpen(open: boolean): void {
    if (!mainWindow) return
    panelOpen = open
    const [x, y] = mainWindow.getPosition()
    const size = open ? PANEL_SIZE : WINDOW_SIZE
    mainWindow.setMinimumSize(size.w, size.h)
    mainWindow.setMaximumSize(size.w, size.h)
    mainWindow.setBounds({ x, y, width: size.w, height: size.h })
  },
  setInteractive(interactive: boolean): void {
    if (!mainWindow) return
    if (interactive) mainWindow.setIgnoreMouseEvents(false)
    else mainWindow.setIgnoreMouseEvents(true, { forward: true })
  },
  getPosition(): { x: number; y: number } {
    if (!mainWindow) return { x: 100, y: 100 }
    const [x, y] = mainWindow.getPosition()
    return { x, y }
  },
  moveBy(dx: number, dy: number): void {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + dx, y + dy)
    savePositionSoon()
  },
  resetPosition(): void {
    if (!mainWindow) return
    const wa = screen.getPrimaryDisplay().workArea
    mainWindow.setPosition(wa.x + wa.width - WINDOW_SIZE.w - 30, wa.y + wa.height - WINDOW_SIZE.h - 40)
    savePosition()
  }
}

function createTray(): void {
  if (tray) return
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'resources', 'icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
  tray = new Tray(icon)
  tray.setToolTip('灵伴 Spirit Mate')
  const menu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏桌宠',
      click: () => {
        if (!mainWindow) return
        if (mainWindow.isVisible()) mainWindow.hide()
        else mainWindow.show()
      }
    },
    { label: '今日计划', click: () => services?.openPanel('calendar') },
    { label: '设置', click: () => services?.openPanel('settings') },
    { type: 'separator' },
    {
      label: '重置软件（保留数据）',
      click: () => {
        services?.reset()
        mainWindow?.webContents.reload()
      }
    },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    db = new DB()
    mainWindow = createWindow()
    services = new Services(db, mainWindow)
    services.setWindow(mainWindow)
    registerIpc(services, windowCtl)
    restorePosition(mainWindow)
    mainWindow.setIgnoreMouseEvents(true, { forward: true })
    createTray()
    services.start()
    const autostart = db.getSetting<boolean>('autostart', true)
    app.setLoginItemSettings({ openAtLogin: autostart })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        services?.setWindow(mainWindow)
        restorePosition(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    services?.stop()
  })
}