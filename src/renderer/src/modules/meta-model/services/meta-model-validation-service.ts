import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, type IDocument, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { check, Severity, type Diagnostic, type SourceFile } from '@pragmatic-lab/todl'

import type { IStorage } from '../../../services/storage/storage.js'
import { CodeDocument } from '../../code-editor/code-document.js'
import { EditorSeverity, type EditorDiagnostic } from '../../code-editor/editor-diagnostic.js'
import { collectTodlSources } from './todl-sources.js'

// Whole-project live validation for a meta-model project. It watches the shell's
// open documents; whenever an open `.todl` document's text changes it debounces,
// then validates ALL the project's `.todl` files together (open buffers overlaid
// on the on-disk snapshot, so cross-file references resolve) and distributes the
// diagnostics back to each open document's Diagnostics channel — which the
// CodeEditor renders as Monaco squiggles. Diagnostics for files that aren't open
// are dropped in v1 (that is the deferred Problems panel's job).

const DEBOUNCE_MS = 250

const SEVERITY_MAP: Record<string, EditorSeverity> = {
    [Severity.Error]:   EditorSeverity.Error,
    [Severity.Warning]: EditorSeverity.Warning,
}

// Map a spanned TODL diagnostic to an editor diagnostic. Both use 1-based
// positions with an exclusive end, so the range is a straight copy; a null span
// (genuine whole-model diagnostic) collapses to the document start.
export function diagnosticToEditor(d: Diagnostic): EditorDiagnostic
{
    const start = d.span?.start ?? { line: 1, column: 1 }
    const end = d.span?.end ?? { line: 1, column: 2 }
    return {
        severity:    SEVERITY_MAP[d.severity] ?? EditorSeverity.Error,
        message:     d.message,
        startLine:   start.line,
        startColumn: start.column,
        endLine:     end.line,
        endColumn:   end.column,
    }
}

// Overlay open documents' live text over the on-disk snapshot (open buffers may
// be unsaved). Keyed by uri = project-relative path = a document's Id.
export function overlaySources(
    stored: readonly SourceFile[],
    open: readonly { id: string; text: string }[],
): SourceFile[]
{
    const byUri = new Map<string, string>()
    for (const s of stored) byUri.set(s.uri, s.text)
    for (const o of open) byUri.set(o.id, o.text)
    return [...byUri].map(([uri, text]) => ({ uri, text }))
}

// A synthetic whole-file Error at the document start — used when validation
// can't attribute a location.
function wholeFileError(message: string): EditorDiagnostic
{
    return { severity: EditorSeverity.Error, message, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }
}

// Validate all sources together and group diagnostics by source uri. Every input
// uri gets an entry (empty when clean) so a fixed file's squiggles clear.
export function validateSources(sources: SourceFile[]): Map<string, EditorDiagnostic[]>
{
    const byUri = new Map<string, EditorDiagnostic[]>()
    for (const s of sources) byUri.set(s.uri, [])

    let diagnostics: readonly Diagnostic[]
    try {
        diagnostics = check(sources).diagnostics
    } catch (e) {
        // TODL throws on some hard structural errors (e.g. a duplicate
        // definition) rather than reporting them as diagnostics. Surface a
        // project-level error on every file so the problem is visible, instead
        // of crashing the validation pass.
        const message = `Validation failed: ${(e as Error).message}`
        for (const uri of byUri.keys()) byUri.set(uri, [wholeFileError(message)])
        return byUri
    }

    for (const d of diagnostics) {
        const uri = d.span?.uri
        if (uri === undefined || uri === null) continue   // unattributed — dropped in v1
        let list = byUri.get(uri)
        if (list === undefined) { list = []; byUri.set(uri, list) }
        list.push(diagnosticToEditor(d))
    }
    return byUri
}

export class MetaModelValidationService extends ServiceBase
{
    public static readonly Key = new ServiceKey<MetaModelValidationService>('MetaModelValidationService')

    private storage: IStorage | undefined
    private hostUnsub: (() => void) | undefined
    // Each tracked (open, .todl) document → the thunk that unhooks its listener.
    private readonly hooked = new Map<CodeDocument, () => void>()
    private timer: ReturnType<typeof setTimeout> | undefined

    constructor(provider: IServiceProvider) { super(provider) }

    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // Bind validation to a project's storage (called by the factory on open /
    // create). Subscribes to the open-set on first bind and schedules a pass.
    public SetProject(storage: IStorage): void
    {
        this.storage = storage
        this.subscribeToHost()
        this.scheduleRevalidate()
    }

    // Stop watching and clear pending work — call when the project closes.
    public Dispose(): void
    {
        if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
        this.hostUnsub?.()
        this.hostUnsub = undefined
        for (const unhook of this.hooked.values()) unhook()
        this.hooked.clear()
        this.storage = undefined
    }

    private subscribeToHost(): void
    {
        if (this.hostUnsub !== undefined) return
        const docs = this.host.OpenDocuments
        for (const d of docs) this.track(d)
        this.hostUnsub = docs.Subscribe((change) => {
            if (change.kind === 'inserted') for (const d of change.items) this.track(d)
            else if (change.kind === 'removed') for (const d of change.items) this.untrack(d)
            else if (change.kind === 'cleared') { for (const u of this.hooked.values()) u(); this.hooked.clear() }
        })
    }

    private track(doc: IDocument): void
    {
        if (!(doc instanceof CodeDocument) || doc.Language !== 'todl' || this.hooked.has(doc)) return
        const listener = (): void => this.scheduleRevalidate()
        doc.AddPropertyChangedListener(CodeDocument.ContentKey, listener)
        this.hooked.set(doc, () => doc.RemovePropertyChangedListener(CodeDocument.ContentKey, listener))
        this.scheduleRevalidate()
    }

    private untrack(doc: IDocument): void
    {
        const unhook = this.hooked.get(doc as CodeDocument)
        if (unhook !== undefined) { unhook(); this.hooked.delete(doc as CodeDocument) }
    }

    private scheduleRevalidate(): void
    {
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.timer = undefined; void this.Revalidate() }, DEBOUNCE_MS)
    }

    // Run one whole-project validation pass and distribute diagnostics to the
    // open `.todl` documents. Public + awaitable so it's directly testable.
    public async Revalidate(): Promise<void>
    {
        if (this.storage === undefined) return
        const stored = await collectTodlSources(this.storage)
        const open = [...this.hooked.keys()].map((d) => ({ id: d.Id, text: d.Content }))
        const byUri = validateSources(overlaySources(stored, open))
        for (const doc of this.hooked.keys()) {
            const target = doc.Diagnostics
            target.Clear()
            for (const dg of byUri.get(doc.Id) ?? []) target.Add(dg)
        }
    }
}
