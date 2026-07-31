import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFileSystemHandlers } from './filesystem.js'
import { registerFileWatchHandlers } from './file-watcher.js'
import { registerEnvironmentHandlers } from './environment.js'
import { registerSettingsHandlers } from './settings.js'
import { registerAgentHandlers } from './agent.js'
import { registerTodlServerHandlers } from './todl/register.js'

// Dev only: disable the renderer's HTTP cache. mural is served LIVE by Vite as
// a pre-bundle-excluded dep (see electron.vite.config.ts), but Chromium caches
// those dep modules by their immutable `?v=<hash>` URL — and that hash is tied
// to the OTHER optimized deps, so it stays constant across restarts. The net
// effect is a rebuilt framework dist getting silently masked by stale cached
// modules. Turning the HTTP cache off makes every reload re-fetch the live dist.
// Must run before app 'ready' — hence module top-level, not inside whenReady.
if (is.dev) app.commandLine.appendSwitch('disable-http-cache')

// Main process — owns the window and (later) the native capabilities Plexus
// reaches for as a desktop app: file open/save for diagram documents, the
// app menu, recent files. Those land as typed IPC handlers here and are
// consumed in the renderer through an INJECTED mural service (the same seam
// the demo's DiagramStorageKey uses), so no view / view-model code ever
// imports electron directly.
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Open target=_blank / external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite serves the renderer over HTTP in dev (HMR) and emits a
  // static index.html for the packaged build.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.plexus.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // Native file-system capability (open/save dialogs, read/write, listing),
  // consumed in the renderer through the injected FileSystemService.
  registerFileSystemHandlers()
  registerFileWatchHandlers()
  // Static host environment snapshot (dirs, platform, versions, flags),
  // consumed in the renderer through the injected EnvironmentService.
  registerEnvironmentHandlers()
  // Settings persistence (userData/settings.json), backing the framework's
  // ApplicationSettings via the renderer's ElectronSettingsStore.
  registerSettingsHandlers()
  // Agent runtime — owns the claude CLI child + session + the in-process
  // ask-user-question MCP tool, exposed to the renderer as command handlers plus a
  // pushed event stream (AgentChannel.Event). Awaited so the tool server is
  // listening before the first turn.
  await registerAgentHandlers()
  // TODL language server: fork the vendored stdio server and relay LSP JSON-RPC
  // to the renderer. Registered before the window so the ToServer channel is
  // listening when the renderer builds its connection on load.
  registerTodlServerHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
