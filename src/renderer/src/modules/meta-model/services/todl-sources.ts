import type { SourceFile } from '@pragmatic-lab/todl'
import type { IStorage } from '../../../services/storage/storage.js'

// Shared TODL source-collection + project-relative path helpers, used by both
// the project factory (publish) and the validation service. Kept separate so
// neither has to import the other (the factory notifies the service on open;
// the service reads sources) — no import cycle.

export function joinRel(dir: string, name: string): string
{
    return dir === '' ? name : dir + '/' + name
}

export function extname(name: string): string
{
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i).toLowerCase() : ''
}

// Recursively collect every `.todl` file in the project as a TODL SourceFile
// (uri = project-relative POSIX path). This is what check() and publish consume.
export async function collectTodlSources(storage: IStorage): Promise<SourceFile[]>
{
    const out: SourceFile[] = []
    async function walk(dir: string): Promise<void>
    {
        for (const e of await storage.List(dir)) {
            const path = joinRel(dir, e.Name)
            if (e.IsDirectory) await walk(path)
            else if (extname(e.Name) === '.todl') out.push({ uri: path, text: await storage.ReadText(path) })
        }
    }
    await walk('')
    return out
}
