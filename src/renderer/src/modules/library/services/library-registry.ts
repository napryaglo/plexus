import { Application, ResourceDictionary, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import { ensureLibrariesBackend } from './libraries-backend.js'
import { discoverLibraries, readTemplateSource, type LoadedLibrary, type LoadProblem } from './library-loader.js'
import { buildCtx, compileTemplate, buildDefaultTemplate } from './visual-library.js'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'

const OWNER = 'libraries'

// Loads published library bundles, compiles each class's .mural template into a
// live DataTemplate, and resolves a class id → its template (or the default).
// The compiled templates also merge into Application.Resources (string-keyed by
// class id) so Phase 3's canvas can resolve them by key. Load/compile failures
// report to the Problems dock, one slice per library (auto-clears on re-publish).
export class LibraryRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<LibraryRegistry>('LibraryRegistry')

    private readonly ctx = buildCtx()
    private readonly libraryVisuals = new ResourceDictionary()
    private readonly defaultTemplate: DataTemplate
    private merged = false

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.defaultTemplate = buildDefaultTemplate(this.ctx)
    }

    // class id → its template if mounted, else the single shared default. `concept`
    // is accepted for a future per-concept default tier (unused today).
    public resolve(classId: string, _concept: string): DataTemplate
    {
        const t = this.libraryVisuals.Resolve(classId)
        return (t as DataTemplate | undefined) ?? this.defaultTemplate
    }

    // Discover + (re)mount every published library; republish diagnostics. Returns
    // the loaded set for the panel.
    public async refresh(): Promise<LoadedLibrary[]>
    {
        this.ensureMerged()
        const backend = ensureLibrariesBackend(this.Provider)
        const libs = await discoverLibraries(backend)
        for (const lib of libs) {
            const problems: LoadProblem[] = [...lib.problems]
            for (const cls of lib.classes) {
                const source = await readTemplateSource(backend, lib, cls)
                if (source === undefined) continue
                try {
                    this.libraryVisuals.Set(cls.id, compileTemplate(source, this.ctx))
                } catch (e) {
                    problems.push({ severity: 'error', uri: cls.templatePath ?? null,
                                    message: `Template for ${cls.id} failed to compile: ${(e as Error).message}` })
                }
            }
            this.publish(lib, problems)
        }
        return libs
    }

    // Merge the library-visuals dictionary into the app resources once (guarded:
    // Application.current may be absent in headless tests, where resolve() still
    // works off the owned dictionary).
    private ensureMerged(): void
    {
        if (this.merged) return
        Application.current?.Resources.AddMergedDictionary(this.libraryVisuals)
        this.merged = true
    }

    private publish(lib: LoadedLibrary, problems: readonly LoadProblem[]): void
    {
        const diagnostics = this.Provider.get(DiagnosticsService.Key)
        if (diagnostics === undefined) return
        const projectId = `library:${lib.id}@${lib.version}`
        const projectName = `${lib.name} (${lib.id}@${lib.version})`
        const diags: Diagnostic[] = problems.map((p) => ({
            owner: OWNER, projectId, projectName, uri: p.uri, message: p.message,
            severity: p.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning, span: null,
        }))
        diagnostics.Publish(OWNER, projectId, diags)   // empty array clears the slice
    }
}
