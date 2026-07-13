import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  FileSystemChannel,
  type FileEntry,
  type IFileSystemApi,
  type OpenFileOptions,
  type OpenFileResult,
  type SaveFileOptions,
} from '../shared/file-system-api.js'
import { EnvironmentChannel, type EnvironmentInfo } from '../shared/environment-api.js'
import { SettingsChannel, type ISettingsBridge } from '../shared/settings-api.js'

// Preload — the ONLY place renderer and main meet, across the context bridge.
// Exposes Plexus's native surface as a small typed `api`. The renderer wraps
// `api.fs` in an injected mural service (FileSystemService) so app/view/VM
// code stays host-agnostic. Each method is a thin ipcRenderer.invoke to the
// matching main-process handler (registered in main/filesystem.ts).
const fs: IFileSystemApi = {
  openFile: (options?: OpenFileOptions): Promise<OpenFileResult | null> =>
    ipcRenderer.invoke(FileSystemChannel.OpenFile, options),
  saveFileAs: (content: string, options?: SaveFileOptions): Promise<string | null> =>
    ipcRenderer.invoke(FileSystemChannel.SaveFileAs, content, options),
  readText: (path: string): Promise<string> =>
    ipcRenderer.invoke(FileSystemChannel.ReadText, path),
  writeText: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.WriteText, path, content),
  exists: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(FileSystemChannel.Exists, path),
  delete: (path: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.Delete, path),
  listDirectory: (path: string): Promise<readonly FileEntry[]> =>
    ipcRenderer.invoke(FileSystemChannel.ListDirectory, path),
}

// Environment snapshot — read ONCE, synchronously, at preload load time. The
// facts are static, so a single blocking round-trip here is simpler than async
// plumbing and lets the renderer's EnvironmentService expose plain getters.
// Frozen so renderer code can't mutate the shared object.
const environment: EnvironmentInfo = Object.freeze(
  ipcRenderer.sendSync(EnvironmentChannel.GetSnapshot) as EnvironmentInfo,
)

// Settings bridge — the persisted values are read ONCE, synchronously, at load
// (so ApplicationSettings has real values at construction); saves are async and
// fire-and-forget. Backs the renderer's ElectronSettingsStore.
const settings: ISettingsBridge = {
  snapshot: Object.freeze(
    ipcRenderer.sendSync(SettingsChannel.GetSnapshot) as Record<string, unknown>,
  ),
  save: (values: Record<string, unknown>): void => {
    void ipcRenderer.invoke(SettingsChannel.Save, values)
  },
}

const api = { fs, environment, settings }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (contextIsolation disabled)
  window.electron = electronAPI
  // @ts-ignore (contextIsolation disabled)
  window.api = api
}
