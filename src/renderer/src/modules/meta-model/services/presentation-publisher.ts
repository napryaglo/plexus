import type { TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage, StorageEntry } from '../../../services/storage/storage.js'
import { generatePresentationMu, distinctIcons, ontologyEntities } from './presentation-generator.js'

// The project folder holding author-written override dictionaries; copied
// verbatim into the backend so the generated `merge <Name>` lines resolve.
const OVERRIDES_SRC_DIR = 'presentation'
// The self-contained presentation folder written into the backend base.
const PRESENTATION_DIR = 'presentation'
const GENERATED_FILE = 'presentation.generated.mu'
const OVERRIDES_DEST_DIR = 'overrides'

export interface PresentationPublishStats { templates: number; icons: number }

// Write a published model's presentation payload into `dest` under
// `<base>/presentation/`: the generated dictionary source, the project's
// override tree, and each declared icon SVG (path preserved). Pure I/O over two
// IStorages — no renderer, no compilation. `authorDicts` are the override
// `resources <Name>` identifiers the generated source should `merge`.
export async function publishPresentation(
    project: IStorage, dest: IStorage, base: string,
    doc: TodlDocument, authorDicts: readonly string[],
): Promise<PresentationPublishStats>
{
    const root = `${base}/${PRESENTATION_DIR}`

    // 1. Generated dictionary source (identical to the project-side output).
    const source = generatePresentationMu(doc, authorDicts)
    await dest.WriteText(`${root}/${GENERATED_FILE}`, source)

    // 2. Author overrides tree (verbatim). Missing folder → nothing copied.
    await copyTree(project, OVERRIDES_SRC_DIR, dest, `${root}/${OVERRIDES_DEST_DIR}`)

    // 3. Icons — copy each declared SVG, preserving its project-relative path so
    //    an include-resolver rooted at `<root>` finds it. A missing file is an
    //    authoring gap: skip it (non-fatal) and leave it out of the count.
    let icons = 0
    for (const iconPath of distinctIcons(doc))
    {
        try
        {
            const svg = await project.ReadText(iconPath)
            await dest.WriteText(`${root}/${iconPath}`, svg)
            icons++
        }
        catch { /* missing asset — skip */ }
    }

    return { templates: ontologyEntities(doc).length, icons }
}

// Recursively copy every file under `srcDir` in `from` to `destDir` in `to`,
// preserving structure. A missing `srcDir` (List throws) copies nothing.
// Text copy suffices — presentation assets are .mu / .svg (UTF-8).
async function copyTree(from: IStorage, srcDir: string, to: IStorage, destDir: string): Promise<void>
{
    let entries: readonly StorageEntry[]
    try { entries = await from.List(srcDir) }
    catch { return }
    for (const e of entries)
    {
        const srcPath = srcDir === '' ? e.Name : `${srcDir}/${e.Name}`
        const destPath = `${destDir}/${e.Name}`
        if (e.IsDirectory) await copyTree(from, srcPath, to, destPath)
        else await to.WriteText(destPath, await from.ReadText(srcPath))
    }
}
