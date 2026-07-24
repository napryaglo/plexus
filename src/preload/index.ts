import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  FileSystemChannel,
  type FileEntry,
  type IFileSystemApi,
  type ImportedFile,
  type OpenFileOptions,
  type OpenFileResult,
  type OpenFolderOptions,
  type SaveFileOptions,
} from '../shared/file-system-api.js'
import { EnvironmentChannel, type EnvironmentInfo } from '../shared/environment-api.js'
import { SettingsChannel, type ISettingsBridge } from '../shared/settings-api.js'
import { AgentChannel, type AgentEvent, type IAgentApi } from '../shared/agent-api.js'

// Preload — the ONLY place renderer and main meet, across the context bridge.
// Exposes Plexus's native surface as a small typed `api`. The renderer wraps
// `api.fs` in an injected mural service (FileSystemService) so app/view/VM
// code stays host-agnostic. Each method is a thin ipcRenderer.invoke to the
// matching main-process handler (registered in main/filesystem.ts).
const fs: IFileSystemApi = {
  openFile: (options?: OpenFileOptions): Promise<OpenFileResult | null> =>
    ipcRenderer.invoke(FileSystemChannel.OpenFile, options),
  openFiles: (options?: OpenFileOptions): Promise<ImportedFile[] | null> =>
    ipcRenderer.invoke(FileSystemChannel.OpenFiles, options),
  openFolder: (options?: OpenFolderOptions): Promise<string | null> =>
    ipcRenderer.invoke(FileSystemChannel.OpenFolder, options),
  saveFileAs: (content: string, options?: SaveFileOptions): Promise<string | null> =>
    ipcRenderer.invoke(FileSystemChannel.SaveFileAs, content, options),
  readText: (path: string): Promise<string> =>
    ipcRenderer.invoke(FileSystemChannel.ReadText, path),
  readBytes: (path: string): Promise<Uint8Array> =>
    ipcRenderer.invoke(FileSystemChannel.ReadBytes, path),
  writeText: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.WriteText, path, content),
  writeBytes: (path: string, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.WriteBytes, path, bytes),
  exists: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(FileSystemChannel.Exists, path),
  delete: (path: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.Delete, path),
  createDirectory: (path: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.CreateDirectory, path),
  rename: (from: string, to: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.Rename, from, to),
  listDirectory: (path: string): Promise<readonly FileEntry[]> =>
    ipcRenderer.invoke(FileSystemChannel.ListDirectory, path),
  openExternal: (path: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.OpenExternal, path),
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

// Agent runtime bridge. Commands are ipcRenderer.invoke round-trips; onEvent
// subscribes to the pushed AgentChannel.Event stream and returns an unsubscribe.
// sendTurn forwards the working directory + extra dirs + text (matching the
// SendTurn handler).
const agent: IAgentApi = {
  startSession: (workingDirectory: string, addDirs: readonly string[]): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.StartSession, workingDirectory, addDirs),
  sendTurn: (workingDirectory: string, addDirs: readonly string[], text: string): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.SendTurn, workingDirectory, addDirs, text),
  abort: (): Promise<void> => ipcRenderer.invoke(AgentChannel.Abort),
  answerQuestion: (answer): Promise<void> => ipcRenderer.invoke(AgentChannel.AnswerQuestion, answer),
  refreshProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.RefreshProjectResult, result),
  createProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.CreateProjectResult, result),
  onEvent: (handler: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AgentEvent): void => handler(event)
    ipcRenderer.on(AgentChannel.Event, listener)
    return () => {
      ipcRenderer.removeListener(AgentChannel.Event, listener)
    }
  },
}

const api = { fs, environment, settings, agent }

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
