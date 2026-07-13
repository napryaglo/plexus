import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import {
  FileSystemChannel,
  type FileEntry,
  type FileFilter,
  type OpenFileOptions,
  type OpenFileResult,
  type SaveFileOptions,
} from '../shared/file-system-api.js'

// Main-process file-system capability. Owns node:fs and the native open/save
// dialogs, exposed to the renderer as ipcMain handlers keyed by
// FileSystemChannel. The renderer never touches fs directly — the path is
// preload bridge → these handlers → disk. Register once from app.whenReady().

// The window to parent dialogs on — the focused one, falling back to the
// first (there's a single window today, but this stays correct if more open).
function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

// Map our PascalCase FileFilter to Electron's dialog filter shape.
function toDialogFilters(filters?: readonly FileFilter[]): Electron.FileFilter[] | undefined {
  return filters?.map((f) => ({ name: f.Name, extensions: [...f.Extensions] }))
}

export function registerFileSystemHandlers(): void {
  ipcMain.handle(
    FileSystemChannel.OpenFile,
    async (_e, options?: OpenFileOptions): Promise<OpenFileResult | null> => {
      const win = focusedWindow()
      const dialogOptions: OpenDialogOptions = {
        title: options?.Title,
        filters: toDialogFilters(options?.Filters),
        properties: ['openFile'],
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return null
      const path = result.filePaths[0]
      const content = await readFile(path, 'utf8')
      return { Path: path, Content: content }
    },
  )

  ipcMain.handle(
    FileSystemChannel.SaveFileAs,
    async (_e, content: string, options?: SaveFileOptions): Promise<string | null> => {
      const win = focusedWindow()
      const dialogOptions: SaveDialogOptions = {
        title: options?.Title,
        defaultPath: options?.DefaultPath,
        filters: toDialogFilters(options?.Filters),
      }
      const result = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, content, 'utf8')
      return result.filePath
    },
  )

  ipcMain.handle(
    FileSystemChannel.ReadText,
    (_e, path: string): Promise<string> => readFile(path, 'utf8'),
  )

  ipcMain.handle(
    FileSystemChannel.WriteText,
    async (_e, path: string, content: string): Promise<void> => {
      await writeFile(path, content, 'utf8')
    },
  )

  ipcMain.handle(FileSystemChannel.Exists, async (_e, path: string): Promise<boolean> => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(FileSystemChannel.Delete, async (_e, path: string): Promise<void> => {
    await rm(path, { force: true })
  })

  ipcMain.handle(
    FileSystemChannel.ListDirectory,
    async (_e, path: string): Promise<FileEntry[]> => {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map((d) => ({ Name: d.name, IsDirectory: d.isDirectory() }))
    },
  )
}
