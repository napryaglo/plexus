import { ServiceBase, ServiceKey } from '@visualisation-sub/mural/runtime'
import type { IServiceProvider } from '@visualisation-sub/mural/runtime'
import type {
  FileEntry,
  IFileSystemApi,
  OpenFileOptions,
  OpenFileResult,
  SaveFileOptions,
} from '../../../../shared/file-system-api.js'

// FileSystemService — the renderer-side, app-facing wrapper over the native
// file-system capability the main process owns. This is the injected seam the
// shell's comments call out: VMs / commands resolve it (FileSystemService.Key)
// and call PascalCase methods; they never touch `window.api`, ipcRenderer, or
// node:fs, so the app stays host-agnostic and portable to a non-Electron host
// (a different bootstrap swaps the bridge, this surface is unchanged).
//
// Registered as a root singleton via app.mu's `.services:` block. It reads the
// preload bridge (`window.api.fs`) once at construction and delegates each
// call; every method is async (an IPC round-trip to the main process), and the
// dialog calls resolve to null when the user cancels.
export class FileSystemService extends ServiceBase
{
    public static readonly Key = new ServiceKey<FileSystemService>('FileSystemService');

    private readonly api: IFileSystemApi;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        const bridge = (globalThis as unknown as { api?: { fs?: IFileSystemApi } }).api;
        if (bridge?.fs === undefined)
        {
            throw new Error(
                'FileSystemService: window.api.fs is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            );
        }
        this.api = bridge.fs;
    }

    // Native open dialog → the picked file's path + UTF-8 text, or null if the
    // user cancelled.
    public OpenFile(options?: OpenFileOptions): Promise<OpenFileResult | null>
    {
        return this.api.openFile(options);
    }

    // Native save-as dialog → writes `content` to the chosen path and returns
    // it, or null if the user cancelled.
    public SaveFileAs(content: string, options?: SaveFileOptions): Promise<string | null>
    {
        return this.api.saveFileAs(content, options);
    }

    public ReadText(path: string): Promise<string>
    {
        return this.api.readText(path);
    }

    public WriteText(path: string, content: string): Promise<void>
    {
        return this.api.writeText(path, content);
    }

    public Exists(path: string): Promise<boolean>
    {
        return this.api.exists(path);
    }

    public Delete(path: string): Promise<void>
    {
        return this.api.delete(path);
    }

    public ListDirectory(path: string): Promise<readonly FileEntry[]>
    {
        return this.api.listDirectory(path);
    }
}
