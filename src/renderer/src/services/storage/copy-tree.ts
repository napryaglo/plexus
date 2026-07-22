import type { IStorage } from './storage.js'

// Recursively copy a file or folder from one storage to another (paths are
// project-relative). A file copies binary-safe (ReadBytes → WriteBytes); a folder
// is created then each child recursed. The caller passes isDirectory (known from
// the ProjectNode kind), so no probing is needed.
export async function copyTree(src: IStorage, srcPath: string, dst: IStorage, dstPath: string, isDirectory: boolean): Promise<void>
{
    if (!isDirectory) {
        await dst.WriteBytes(dstPath, await src.ReadBytes(srcPath))
        return
    }
    await dst.CreateDirectory(dstPath)
    for (const entry of await src.List(srcPath)) {
        const from = srcPath === '' ? entry.Name : `${srcPath}/${entry.Name}`
        const to = dstPath === '' ? entry.Name : `${dstPath}/${entry.Name}`
        await copyTree(src, from, dst, to, entry.IsDirectory)
    }
}
