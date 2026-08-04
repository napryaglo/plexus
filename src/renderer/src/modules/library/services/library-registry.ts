import { Application, ResourceDictionary, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import { ensureLibrariesBackend } from './libraries-backend.js'
import { discoverLibraries, loadLibraryPresentation, readTemplateSource, readIconSource, type LoadedClass, type LoadedLibrary, type LoadProblem } from './library-loader.js'
import { buildCtx, compileTemplate, buildDefaultTemplate, buildIconTemplate } from './visual-library.js'
import { parseSvgIcon } from '@pragmatic-lab/mural/basic'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'

const OWNER = 'libraries'

// Loads published library bundles and resolves a class id → its visual template.
// Discovery (reading each library.json) is cheap and eager; per-class template
// compilation is LAZY — a class's .mural/icon compiles on first resolve() and is
// cached, so a large library lists instantly and only the visuals actually shown
// (preview pane, canvas nodes) pay to compile. onChanged notifies consumers when a
// class's real template becomes available so they can upgrade from the default.
// Compiled templates merge into Application.Resources (string-keyed by class id)
// so the canvas can resolve them by key. Load/compile failures report to the
// Problems dock, one slice per library (auto-clears on re-discover).
export class LibraryRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<LibraryRegistry>('LibraryRegistry')

    private readonly ctx = buildCtx()
    private readonly libraryVisuals = new ResourceDictionary()
    // Baked per-library presentation templates (class-keyed), aggregated. Rebuilt
    // wholesale on each discover(); the middle resolution tier between an authored
    // .mural (wins) and the shared default box. Merged into the app resources so
    // the canvas resolves every class by key. NOT readonly: discover() builds a
    // fresh detached dictionary and swaps it in via ReplaceMergedDictionary, so
    // populating ~470 class templates fires one merged-notification instead of one
    // per Set (the entry-by-entry storm cost ~4-5s of style re-resolution per
    // panel open). presentationMerged tracks the currently-merged instance so the
    // next discover can swap it out.
    private presentationVisuals = new ResourceDictionary()
    private presentationMerged: ResourceDictionary | undefined
    private readonly defaultTemplate: DataTemplate
    private merged = false

    // Lazy-compile bookkeeping, rebuilt on each discover().
    private readonly classIndex = new Map<string, { lib: LoadedLibrary; cls: LoadedClass }>()
    private readonly slices = new Map<string, { lib: LoadedLibrary; problems: LoadProblem[] }>()
    private readonly inFlight = new Set<string>()
    private readonly attempted = new Set<string>()
    private readonly listeners = new Set<(classId: string) => void>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.defaultTemplate = buildDefaultTemplate(this.ctx)
        // These dictionaries hold string-keyed class templates, never
        // Function-keyed (control-type) styles, so their changes can never
        // affect an implicit/theme style lookup. Opt them out of the style
        // notification channel: populating them wakes DynamicResource / by-key
        // consumers (general channel) but does zero per-element style work.
        this.libraryVisuals.StyleParticipating = false
    }

    // Subscribe to "a class's real template is now available". Returns an
    // unsubscribe. Consumers (preview pane, canvas nodes) re-resolve on the event.
    public onChanged(listener: (classId: string) => void): () => void
    {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }

    // class id → its compiled template if already mounted, else the single shared
    // default (and, on first miss for a known class, schedule its lazy compile).
    // `concept` is accepted for a future per-concept default tier (unused today).
    public resolve(classId: string, _concept: string): DataTemplate
    {
        // Authored .mural (lazy-compiled) wins; schedule its compile on first miss.
        const authored = this.libraryVisuals.Resolve(classId)
        if (authored !== undefined) return authored as DataTemplate
        if (this.classIndex.has(classId) && !this.attempted.has(classId) && !this.inFlight.has(classId)) {
            this.inFlight.add(classId)
            void this.compileClass(classId)
        }
        // Then the baked presentation template (geometry inlined), else the default.
        const pres = this.presentationVisuals.Resolve(classId)
        if (pres !== undefined) return pres as DataTemplate
        return this.defaultTemplate
    }

    // Discover every published library (cheap: reads each library.json). Rebuilds
    // the lazy-compile index + per-library Problems slices and publishes discovery
    // problems. Compiles NO templates. Returns the loaded set for the panel.
    public async discover(): Promise<LoadedLibrary[]>
    {
        this.ensureMerged()
        this.classIndex.clear()
        this.slices.clear()
        this.inFlight.clear()
        this.attempted.clear()
        const backend = ensureLibrariesBackend(this.Provider)
        const libs = await discoverLibraries(backend)
        // Build the presentation aggregate DETACHED — its Set()s notify nobody,
        // since nothing is subscribed to a dictionary that isn't merged yet — then
        // swap it in for the previous one in a single ReplaceMergedDictionary
        // (one notification total). Marked non-participating like libraryVisuals so
        // that one notification does no per-element style work either.
        const nextPresentation = new ResourceDictionary()
        nextPresentation.StyleParticipating = false
        for (const lib of libs) {
            const pid = this.projectIdOf(lib)
            this.slices.set(pid, { lib, problems: [...lib.problems] })
            this.publishSlice(pid)
            for (const cls of lib.classes) this.classIndex.set(cls.id, { lib, cls })
            // Load this library's baked presentation (if any) into the aggregate.
            const pres = await loadLibraryPresentation(backend, lib.id, lib.version)
            if (pres !== undefined) for (const [k, v] of pres.Entries()) nextPresentation.Set(k, v)
        }
        // Swap into the app resources (last-merged, so it stays after libraryVisuals
        // — same precedence as before). resolve() reads presentationVisuals directly,
        // so headless (no Application.current) still works via the owned reference.
        Application.current?.Resources.ReplaceMergedDictionary(this.presentationMerged, nextPresentation)
        this.presentationMerged = nextPresentation
        this.presentationVisuals = nextPresentation
        return libs
    }

    // Compile one class's template (or icon) on demand, cache it, republish that
    // library's Problems slice with any compile failure, then fire onChanged. Runs
    // once per class per discover() (guarded by inFlight during, attempted after).
    private async compileClass(classId: string): Promise<void>
    {
        const entry = this.classIndex.get(classId)
        try {
            if (entry !== undefined) {
                const { lib, cls } = entry
                const pid = this.projectIdOf(lib)
                const backend = ensureLibrariesBackend(this.Provider)
                const source = await readTemplateSource(backend, lib, cls)
                if (source !== undefined) {
                    try {
                        this.libraryVisuals.Set(cls.id, compileTemplate(source, this.ctx))
                    } catch (e) {
                        this.addProblem(pid, { severity: 'error', uri: cls.templatePath ?? null,
                            message: `Template for ${cls.id} failed to compile: ${(e as Error).message}` })
                    }
                } else if (cls.icon !== undefined && !this.presentationVisuals.CanResolve(cls.id)) {
                    // Legacy icon fallback — only when no baked presentation covers
                    // this class (older bundles); otherwise the presentation tier
                    // already supplies the iconful default.
                    const svg = await readIconSource(backend, lib, cls)
                    if (svg === undefined) {
                        this.addProblem(pid, { severity: 'warning', uri: cls.icon, message: `Icon asset is missing: ${cls.icon}` })
                    } else {
                        try {
                            this.libraryVisuals.Set(cls.id, buildIconTemplate(parseSvgIcon(svg), this.ctx))
                        } catch (e) {
                            this.addProblem(pid, { severity: 'warning', uri: cls.icon,
                                message: `Icon ${cls.icon} failed to parse: ${(e as Error).message}` })
                        }
                    }
                }
            }
        } finally {
            this.inFlight.delete(classId)
            this.attempted.add(classId)
            for (const l of [...this.listeners]) l(classId)
        }
    }

    private projectIdOf(lib: LoadedLibrary): string { return `library:${lib.id}@${lib.version}` }

    // Append a compile problem to a library's slice and republish the whole slice
    // (so discovery + compile problems coexist as one coherent per-library entry).
    private addProblem(pid: string, problem: LoadProblem): void
    {
        this.slices.get(pid)?.problems.push(problem)
        this.publishSlice(pid)
    }

    private publishSlice(pid: string): void
    {
        const slice = this.slices.get(pid)
        if (slice !== undefined) this.publish(slice.lib, slice.problems)
    }

    // Uninstall a published library: remove its <id>/<version> folder from the
    // backend and clear its Problems slice (keyed as publish() does). The panel
    // reloads afterwards so the row disappears. Does not touch any authored library
    // *project* on disk — only the installed copy in the local libraries store.
    public async delete(id: string, version: string): Promise<void>
    {
        const backend = ensureLibrariesBackend(this.Provider)
        await backend.Delete(`${id}/${version}`)
        this.Provider.get(DiagnosticsService.Key)?.Publish(OWNER, `library:${id}@${version}`, [])
    }

    // Merge the library-visuals dictionary into the app resources once (guarded:
    // Application.current may be absent in headless tests, where resolve() still
    // works off the owned dictionary).
    private ensureMerged(): void
    {
        if (this.merged) return
        // Merge only libraryVisuals here (once). presentationVisuals is merged —
        // and re-merged on every discover — via ReplaceMergedDictionary, which
        // adds it AFTER libraryVisuals so authored-vs-presentation precedence in
        // the app's by-key lookup is unchanged.
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
