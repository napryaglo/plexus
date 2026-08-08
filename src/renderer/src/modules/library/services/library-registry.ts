import { Application, ResourceDictionary, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import { ensureLibrariesBackend } from './libraries-backend.js'
import { discoverLibraries, loadLibraryPresentation, readTemplateSource, readIconSource, type LoadedClass, type LoadedLibrary, type LoadProblem } from './library-loader.js'
import { buildCtx, compileTemplate, buildDefaultTemplate, buildIconTemplate } from './visual-library.js'
import { parseSvgIcon } from '@pragmatic-lab/mural/basic'
import type { IStorage } from '../../../services/storage/storage.js'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'

const OWNER = 'libraries'

// Loads published library bundles and resolves a class id → its visual template.
// Both discovery (reading each library.json) AND per-class visual compilation are
// EAGER: discover() compiles every class's authored .mural / legacy icon up front,
// so resolve() is fully synchronous and returns the final visual with no async
// "default box → real visual" upgrade. Compiled templates merge into
// Application.Resources (string-keyed by class id) so the canvas resolves them by
// key. onChanged still notifies consumers (a re-discover refreshes open canvases).
// Load/compile failures report to the Problems dock, one slice per library
// (auto-clears on re-discover).
export class LibraryRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<LibraryRegistry>('LibraryRegistry')

    private readonly ctx = buildCtx()
    // Class-keyed authored/icon templates, compiled eagerly in discover() and
    // swapped into the app resources like presentationVisuals below. Rebuilt
    // wholesale each discover; libraryMerged tracks the currently-merged instance.
    private libraryVisuals = new ResourceDictionary()
    private libraryMerged: ResourceDictionary | undefined
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

    // Per-library Problems slices, rebuilt on each discover().
    private readonly slices = new Map<string, { lib: LoadedLibrary; problems: LoadProblem[] }>()
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

    // class id → its compiled visual. Fully synchronous: everything was compiled in
    // discover(). Authored .mural wins, then the baked presentation template
    // (geometry inlined), else the single shared default box. `concept` is accepted
    // for a future per-concept default tier (unused today).
    public resolve(classId: string, _concept: string): DataTemplate
    {
        const authored = this.libraryVisuals.Resolve(classId)
        if (authored !== undefined) return authored as DataTemplate
        const pres = this.presentationVisuals.Resolve(classId)
        if (pres !== undefined) return pres as DataTemplate
        return this.defaultTemplate
    }

    // Discover every published library (reads each library.json) and EAGERLY compile
    // every class's visual. Rebuilds the per-library Problems slices, compiles all
    // authored .mural / legacy icons, swaps the two class-keyed dictionaries into the
    // app resources, and notifies consumers. Returns the loaded set for the panel.
    public async discover(): Promise<LoadedLibrary[]>
    {
        this.slices.clear()
        const backend = ensureLibrariesBackend(this.Provider)
        const libs = await discoverLibraries(backend)
        // Build both aggregates DETACHED — their Set()s notify nobody until the
        // single ReplaceMergedDictionary swap — and marked non-participating so that
        // swap does no per-element style work. Presentation must be built before a
        // library's classes so the legacy-icon fallback can see what it covers.
        const nextLibrary = new ResourceDictionary()
        nextLibrary.StyleParticipating = false
        const nextPresentation = new ResourceDictionary()
        nextPresentation.StyleParticipating = false
        let libraryCount = 0
        for (const lib of libs) {
            const pid = this.projectIdOf(lib)
            this.slices.set(pid, { lib, problems: [...lib.problems] })
            this.publishSlice(pid)
            const pres = await loadLibraryPresentation(backend, lib.id, lib.version)
            if (pres !== undefined) for (const [k, v] of pres.Entries()) nextPresentation.Set(k, v)
            for (const cls of lib.classes) {
                if (await this.compileClassInto(nextLibrary, nextPresentation, backend, lib, cls)) libraryCount++
            }
        }
        // Swap into the app resources, library BEFORE presentation so authored wins
        // over presentation in the app's by-key lookup. Skip an empty library swap
        // that was never merged, so the no-authored-template case stays at zero
        // library notifications. resolve() reads the owned references, so headless
        // (no Application.current) still works.
        if (libraryCount > 0 || this.libraryMerged !== undefined) {
            Application.current?.Resources.ReplaceMergedDictionary(this.libraryMerged, nextLibrary)
            this.libraryMerged = nextLibrary
        }
        this.libraryVisuals = nextLibrary
        Application.current?.Resources.ReplaceMergedDictionary(this.presentationMerged, nextPresentation)
        this.presentationMerged = nextPresentation
        this.presentationVisuals = nextPresentation
        // Notify consumers so open canvas presenters re-resolve to the freshly
        // compiled visuals (first load has no subscribers yet, so it's a no-op there).
        for (const lib of libs) for (const cls of lib.classes) for (const l of [...this.listeners]) l(cls.id)
        return libs
    }

    // Eagerly compile one class's visual into `into`. Authored .mural wins; else the
    // legacy loose-SVG icon, but only when no baked presentation already covers the
    // class. Compile/parse failures publish a per-library Problem. Returns whether an
    // entry was added (so discover() knows if the library dictionary is non-empty).
    private async compileClassInto(
        into: ResourceDictionary,
        presentation: ResourceDictionary,
        backend: IStorage,
        lib: LoadedLibrary,
        cls: LoadedClass,
    ): Promise<boolean>
    {
        const pid = this.projectIdOf(lib)
        const source = await readTemplateSource(backend, lib, cls)
        if (source !== undefined) {
            try {
                into.Set(cls.id, compileTemplate(source, this.ctx))
                return true
            } catch (e) {
                this.addProblem(pid, { severity: 'error', uri: cls.templatePath ?? null,
                    message: `Template for ${cls.id} failed to compile: ${(e as Error).message}` })
                return false
            }
        }
        if (cls.icon !== undefined && !presentation.CanResolve(cls.id)) {
            const svg = await readIconSource(backend, lib, cls)
            if (svg === undefined) {
                this.addProblem(pid, { severity: 'warning', uri: cls.icon, message: `Icon asset is missing: ${cls.icon}` })
                return false
            }
            try {
                into.Set(cls.id, buildIconTemplate(parseSvgIcon(svg), this.ctx))
                return true
            } catch (e) {
                this.addProblem(pid, { severity: 'warning', uri: cls.icon,
                    message: `Icon ${cls.icon} failed to parse: ${(e as Error).message}` })
                return false
            }
        }
        return false
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
