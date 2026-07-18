import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'

import { EnvironmentService } from '../environment/environment-service.js'
import { FileSystemService } from '../file-system/file-system-service.js'

// OpenProjectsStore — persists the set of currently-open project folders to a
// plain JSON array at <UserDataDirectory>/open-projects.json (through the
// existing FileSystemService, no new IPC). The explorer updates it on
// open/create/close and reads it at launch to restore the workspace. Kept off
// the settings store on purpose (same reason as RecentProjectsService).
export class OpenProjectsStore extends ServiceBase
{
    public static readonly Key = new ServiceKey<OpenProjectsStore>('OpenProjectsStore')
    private static readonly FileName = 'open-projects.json'

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get env(): EnvironmentService { return this.Provider.getRequired(EnvironmentService.Key) }

    private get filePath(): string
    {
        return join(this.env.UserDataDirectory, OpenProjectsStore.FileName)
    }

    // The stored open-project folders. Tolerates a missing/corrupt file → [].
    public async List(): Promise<readonly string[]>
    {
        try {
            if (!(await this.fs.Exists(this.filePath))) return []
            const parsed = JSON.parse(await this.fs.ReadText(this.filePath))
            return Array.isArray(parsed) ? (parsed as string[]) : []
        } catch {
            return []
        }
    }

    // Append a folder if it isn't already present (dedupe by exact path).
    public async Add(folder: string): Promise<void>
    {
        const list = await this.List()
        if (list.includes(folder)) return
        await this.write([...list, folder])
    }

    public async Remove(folder: string): Promise<void>
    {
        await this.write((await this.List()).filter((f) => f !== folder))
    }

    private write(list: readonly string[]): Promise<void>
    {
        return this.fs.WriteText(this.filePath, JSON.stringify(list, null, 2))
    }
}

// Join a directory and a file name using the directory's own separator (no
// node:path in the renderer).
function join(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}
