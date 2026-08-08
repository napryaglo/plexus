import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'
import { parseSvgIcon } from '@pragmatic-lab/mural/basic'

import type { PresentationSource } from '../../diagram/services/todl-presentation-registry.js'
import { ensureLibrariesBackend } from './libraries-backend.js'
import { readTemplateSource, readIconSource, type LoadedLibrary, type LoadProblem } from './library-loader.js'
import { buildCtx, compileTemplate, buildIconTemplate } from './visual-library.js'
import { LibraryClassData } from './library-class-data.js'
import { loadCompiledPresentation } from '../../meta-model/services/compiled-presentation.js'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'

const OWNER = 'libraries'

// A PresentationSource that produces all library visual templates for the
// TodlPresentationRegistry. Logic mirrors LibraryRegistry.discover() /
// compileClassInto() — temporarily duplicated while Task 5 slims LibraryRegistry.
// For each LoadedLibrary: seed the map from the baked presentation, then override
// with any authored .mural or legacy-icon template per class.
export class LibraryPresentationSource implements PresentationSource
{
    readonly id = 'library'

    private readonly ctx = buildCtx()

    constructor(
        private readonly provider: IServiceProvider,
        private readonly libraries: () => Promise<LoadedLibrary[]>,
    ) {}

    public async load(): Promise<Map<string, DataTemplate>>
    {
        const map = new Map<string, DataTemplate>()
        const backend = ensureLibrariesBackend(this.provider)
        const libs = await this.libraries()

        for (const lib of libs) {
            const problems: LoadProblem[] = [...lib.problems]

            // Seed from the baked presentation (base tier). We need a ResourceDictionary
            // for the legacy-icon fallback check (CanResolve), so load it separately.
            const pres = await loadCompiledPresentation(backend, `${lib.id}/${lib.version}`, { LibraryClassData })

            if (pres !== undefined) {
                for (const [k, v] of pres.Entries()) map.set(k as string, v as DataTemplate)
            }

            // Override with authored .mural or legacy icon per class.
            for (const cls of lib.classes) {
                const source = await readTemplateSource(backend, lib, cls)
                if (source !== undefined) {
                    try {
                        map.set(cls.id, compileTemplate(source, this.ctx))
                    } catch (e) {
                        problems.push({
                            severity: 'error',
                            uri: cls.templatePath ?? null,
                            message: `Template for ${cls.id} failed to compile: ${(e as Error).message}`,
                        })
                        map.delete(cls.id)  // ensure not present (presentation seed may have put something there)
                    }
                    continue
                }

                // Legacy icon: only when no baked presentation already covers the class.
                if (cls.icon !== undefined && !map.has(cls.id)) {
                    const svg = await readIconSource(backend, lib, cls)
                    if (svg === undefined) {
                        problems.push({ severity: 'warning', uri: cls.icon, message: `Icon asset is missing: ${cls.icon}` })
                        continue
                    }
                    try {
                        map.set(cls.id, buildIconTemplate(parseSvgIcon(svg), this.ctx))
                    } catch (e) {
                        problems.push({ severity: 'warning', uri: cls.icon,
                            message: `Icon ${cls.icon} failed to parse: ${(e as Error).message}` })
                    }
                }
            }

            // Publish the consolidated Problems slice for this library.
            this.publishSlice(lib, problems)
        }

        return map
    }

    private publishSlice(lib: LoadedLibrary, problems: readonly LoadProblem[]): void
    {
        const diagnostics = this.provider.get(DiagnosticsService.Key)
        if (diagnostics === undefined) return
        const projectId = `library:${lib.id}@${lib.version}`
        const projectName = `${lib.name} (${lib.id}@${lib.version})`
        const diags: Diagnostic[] = problems.map((p) => ({
            owner: OWNER, projectId, projectName, uri: p.uri, message: p.message,
            severity: p.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            span: null,
        }))
        diagnostics.Publish(OWNER, projectId, diags)
    }
}
