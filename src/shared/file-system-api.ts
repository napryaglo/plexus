// Shared contract between Plexus's three Electron layers:
//   • main     — owns node:fs + native dialogs behind ipcMain handlers
//   • preload  — exposes them on window.api.fs across the context bridge
//   • renderer — FileSystemService (a mural service) wraps window.api.fs
//
// Types are erased at build; both the node (main/preload) and web (renderer)
// tsconfig projects include this file, so all three layers share one shape.

// One IPC channel per operation. Namespaced (`fs:`) so the channel ids stay
// clear of any future api surface. An enum, not bare literals, per the repo's
// enums-over-string-unions rule — main + preload key their handlers/invokes
// off these members.
export enum FileSystemChannel
{
    OpenFile      = 'fs:open-file',
    SaveFileAs    = 'fs:save-file-as',
    ReadText      = 'fs:read-text',
    WriteText     = 'fs:write-text',
    Exists        = 'fs:exists',
    Delete        = 'fs:delete',
    ListDirectory = 'fs:list-directory',
}

// A name/extensions pair for the native open/save dialog filter list.
// Extensions carry NO leading dot ("plexus", not ".plexus").
export interface FileFilter
{
    Name:       string;
    Extensions: readonly string[];
}

export interface OpenFileOptions
{
    Title?:   string;
    Filters?: readonly FileFilter[];
}

export interface SaveFileOptions
{
    Title?:       string;
    DefaultPath?: string;
    Filters?:     readonly FileFilter[];
}

// A file opened through the dialog: its absolute path plus UTF-8 text.
export interface OpenFileResult
{
    Path:    string;
    Content: string;
}

// One entry in a directory listing.
export interface FileEntry
{
    Name:        string;
    IsDirectory: boolean;
}

// The low-level bridge exposed on `window.api.fs`. camelCase verbs mark this
// as the raw IPC surface; the renderer's FileSystemService is the PascalCase,
// app-facing wrapper. Every call is async (an IPC round-trip); the dialog
// calls resolve to null when the user cancels.
export interface IFileSystemApi
{
    openFile(options?: OpenFileOptions): Promise<OpenFileResult | null>;
    saveFileAs(content: string, options?: SaveFileOptions): Promise<string | null>;
    readText(path: string): Promise<string>;
    writeText(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    delete(path: string): Promise<void>;
    listDirectory(path: string): Promise<readonly FileEntry[]>;
}
