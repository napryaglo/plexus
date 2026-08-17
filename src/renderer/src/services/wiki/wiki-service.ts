import {
    MetaData, Model, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'

import { FileSystemService } from '../file-system/file-system-service.js'
import { CodeEditorService } from '../../modules/code-editor/code-editor-service.js'
import { WikiLocator } from './wiki-locator.js'

// Opens a concept's wiki page. Visibility (hasWiki) and open both go through
// WikiLocator, so "Open Wiki" shows exactly when the page is openable (its
// declaring project is open). Approach A: a closed declaring project or a
// missing file sets Status and no tab is opened.
export class WikiService extends ServiceBase
{
    public static readonly Key = new ServiceKey<WikiService>('WikiService')

    public static readonly StatusKey = Model.RegisterProperty<string>(
        WikiService, 'Status', '', MetaData.None)
    public static readonly OpenWikiCommandKey = Model.RegisterProperty<ICommand>(
        WikiService, 'OpenWikiCommand', undefined as unknown as ICommand, MetaData.None)

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(WikiService.OpenWikiCommandKey,
            new RelayCommand((p) => { void this.openWiki(String(p ?? '')) }))
    }

    public get Status(): string { return this.get_property_value(WikiService.StatusKey) }
    private set Status(v: string) { this.set_property_value(WikiService.StatusKey, v) }
    public get OpenWikiCommand(): ICommand { return this.get_property_value(WikiService.OpenWikiCommandKey) }

    private get locator(): WikiLocator { return this.Provider.getRequired(WikiLocator.Key) }

    // True when the concept has an openable wiki page (its declaring project is
    // open). Drives each surface's "Open Wiki" menu-item visibility.
    public async hasWiki(concept: string): Promise<boolean>
    {
        if (concept.length === 0) return false
        return (await this.locator.resolveWiki(concept)) !== undefined
    }

    // Resolve + open the concept's wiki .md as a Monaco tab, or set Status.
    public async openWiki(concept: string): Promise<void>
    {
        const hit = concept.length > 0 ? await this.locator.resolveWiki(concept) : undefined
        if (hit === undefined) {
            this.Status = `Open the project that declares "${concept}" to view its wiki.`
            return
        }
        const abs = join(hit.root, hit.relPath)
        const fs = this.Provider.getRequired(FileSystemService.Key)
        if (!(await fs.Exists(abs))) {
            this.Status = `Wiki file not found: ${hit.relPath}`
            return
        }
        this.Provider.getRequired(CodeEditorService.Key).OpenFile(abs)
        this.Status = ''
    }
}

// Join a directory and a relative child using the directory's own separator
// (no node:path in the renderer). Mirrors open-projects-store.join.
function join(dir: string, rel: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    const d = dir.endsWith(sep) ? dir.slice(0, -1) : dir
    return d + sep + rel.replace(/[\\/]+/g, sep)
}
