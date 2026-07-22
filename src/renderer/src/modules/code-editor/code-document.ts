import { Model, MetaData, ObservableCollection, type PropertyDescriptor } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { ICodeFile } from './code-file.js'
import type { EditorDiagnostic } from './editor-diagnostic.js'
import type { IStorage } from '../../services/storage/storage.js'

function fileName(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

// Minimal file-extension → Monaco language id. Unknown extensions fall back to
// plaintext. `todl` maps to the meta-model module's registered language.
const LANGUAGE_BY_EXT: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', xml: 'xml',
    py: 'python', yaml: 'yaml', yml: 'yaml', todl: 'todl',
}

function languageForPath(path: string): string
{
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    return LANGUAGE_BY_EXT[ext] ?? 'plaintext'
}

// A file opened in the editor, modeled as an IDocument so it shows as a tab in
// the shell's content host alongside diagrams and settings. It is the VM: it
// OWNS the text (Content) and the load/save/dirty lifecycle — exactly as a
// DiagramDocument owns its Nodes. The view is a CodeEditor declared in
// DataTemplate[CodeDocument] that binds $Content (TwoWay), $Language, and
// $Diagnostics; the document never touches the editor.
//
// Persistence flows through an injected ICodeFile, so the document is agnostic
// to whether its bytes live on the raw file system (FileSystemCodeFile) or in a
// project's rooted IStorage (StorageCodeFile). Id / Title / IsDirty / Content /
// Language / Diagnostics are DP-backed: the tab strip binds Id / Title, the
// editor binds Content / Language / Diagnostics. Id is the file's identity, so
// re-opening dedupes to one tab.
export class CodeDocument extends Model implements IDocument
{
    public static readonly IdKey = Model.RegisterProperty<string>(
        CodeDocument, 'Id', '', MetaData.None)

    public static readonly TitleKey = Model.RegisterProperty<string>(
        CodeDocument, 'Title', '', MetaData.None)

    public static readonly IsDirtyKey = Model.RegisterProperty<boolean>(
        CodeDocument, 'IsDirty', false, MetaData.None)

    // The text — the source of truth. The editor two-way binds this, so its
    // edits land here; Save() persists it and load() seeds it from the file.
    public static readonly ContentKey = Model.RegisterProperty<string>(
        CodeDocument, 'Content', '', MetaData.None)

    // Monaco language id, derived from the extension; the editor binds it.
    public static readonly LanguageKey = Model.RegisterProperty<string>(
        CodeDocument, 'Language', 'plaintext', MetaData.None)

    // Diagnostics against the current text — a generic channel a validation
    // producer (e.g. the meta-model validator) fills; the editor binds it and
    // renders the entries as Monaco markers. Empty ⇒ no squiggles. Nothing in
    // the generic code path writes here; a producer replaces the collection's
    // contents on each pass.
    public static readonly DiagnosticsKey = Model.RegisterProperty<ObservableCollection<EditorDiagnostic>>(
        CodeDocument, 'Diagnostics', undefined as unknown as ObservableCollection<EditorDiagnostic>, MetaData.None)

    private readonly file: ICodeFile
    // Last value written to / read from the file. IsDirty = Content !== this.
    private savedContent = ''

    constructor(file: ICodeFile)
    {
        super()
        this.file = file
        this.set_property_value(CodeDocument.IdKey, file.id)
        this.set_property_value(CodeDocument.TitleKey, fileName(file.id))
        this.set_property_value(CodeDocument.LanguageKey, languageForPath(file.id))
        this.set_property_value(CodeDocument.DiagnosticsKey, new ObservableCollection<EditorDiagnostic>())
        void this.load()
    }

    public get Id(): string { return this.get_property_value(CodeDocument.IdKey) }

    public get Title(): string { return this.get_property_value(CodeDocument.TitleKey) }

    public get IsDirty(): boolean { return this.get_property_value(CodeDocument.IsDirtyKey) }

    public get Content(): string { return this.get_property_value(CodeDocument.ContentKey) }
    public set Content(v: string) { this.set_property_value(CodeDocument.ContentKey, v) }

    public get Language(): string { return this.get_property_value(CodeDocument.LanguageKey) }

    public get Diagnostics(): ObservableCollection<EditorDiagnostic> { return this.get_property_value(CodeDocument.DiagnosticsKey) }

    // Re-point this document at a new path after an in-place rename (same
    // storage): re-target the underlying file (so saves go to the new location)
    // and refresh the identity DPs. The in-memory Content/dirty state is preserved.
    public Relocate(newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: unknown): void }>).Retarget?.(newPath)
        this.refreshIdentity(newPath)
    }

    // Re-point at a new STORAGE + path after a cross-project move; the tab stays
    // open (Content/dirty preserved) and now saves to the new project's storage.
    public RelocateTo(storage: IStorage, newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: IStorage): void }>).Retarget?.(newPath, storage)
        this.refreshIdentity(newPath)
    }

    // Refresh the identity DPs: Id dedupes tabs, Title labels the tab, Language
    // re-infers from the new extension.
    private refreshIdentity(newPath: string): void
    {
        this.set_property_value(CodeDocument.IdKey, newPath)
        this.set_property_value(CodeDocument.TitleKey, fileName(newPath))
        this.set_property_value(CodeDocument.LanguageKey, languageForPath(newPath))
    }

    public async Save(): Promise<void>
    {
        const text = this.Content
        await this.file.write(text)
        this.savedContent = text
        this.set_property_value(CodeDocument.IsDirtyKey, false)
    }

    // Seed Content from the file (empty on miss / error). The write goes through
    // the DP so a bound editor picks it up; savedContent is set so this initial
    // fill reads as clean, not a user edit.
    private async load(): Promise<void>
    {
        const text = await this.file.read().catch(() => '')
        this.savedContent = text
        this.set_property_value(CodeDocument.ContentKey, text)
        this.set_property_value(CodeDocument.IsDirtyKey, false)
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        // Any Content change (a user edit arriving through the two-way binding)
        // updates dirty by comparing against what's on the file.
        if (descriptor.Name === 'Content')
        {
            this.set_property_value(
                CodeDocument.IsDirtyKey, (newValue as string) !== this.savedContent)
        }
    }
}
