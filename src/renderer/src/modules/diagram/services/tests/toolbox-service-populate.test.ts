import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ToolboxRepository, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import type { ToolboxTaxonomy } from '../../../meta-model/services/toolbox-projection.js'
import { ToolboxService, contributeTaxonomy } from '../diagram-panel-services.js'
import { ConceptVisualResolver, ConceptVisualResolverKey } from '../concept-visual-resolver.js'
import { LibraryClassVisualResolverKey } from '../library-class-visual-resolver.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'

const libTax: ToolboxTaxonomy = { id: 'Stack', label: 'Stack', terms: [{ id: 'Stack.AzureOpenAI', label: 'Azure OpenAI', concept: 'service' }] }
const conceptTax: ToolboxTaxonomy = { id: 'actors', label: 'Actors', terms: [{ id: 'actors.internal', label: 'Internal', icon: '<svg/>', concept: 'actor' }] }

describe('contributeTaxonomy', () => {
  it('stamps library terms with the library resolver, meta-model terms with the concept resolver', () => {
    const repo = new ToolboxRepository()
    const concept = new ConceptVisualResolver()
    const seen = new Set<string>()
    contributeTaxonomy(repo, concept, libTax, true, seen)
    contributeTaxonomy(repo, concept, conceptTax, false, seen)
    const stack = repo.Pages.ToArray().find((p) => p.Id === 'Stack')!
    const actors = repo.Pages.ToArray().find((p) => p.Id === 'actors')!
    const libItem = stack.Items.ToArray()[0]
    const conceptItem = actors.Items.ToArray()[0]
    expect(libItem.Id).toBe('term:Stack.AzureOpenAI')
    expect((libItem.Descriptor as ToolboxVisualDescriptor).ResolverKey).toBe(LibraryClassVisualResolverKey)
    expect((libItem.Descriptor as ToolboxVisualDescriptor).Key).toBe('Stack.AzureOpenAI')
    expect((conceptItem.Descriptor as ToolboxVisualDescriptor).ResolverKey).toBe(ConceptVisualResolverKey)
    expect(libItem.FactoryKey).toBe(ArchInstanceDropFactoryKey)
  })

  it('dedupes a term seen across sources', () => {
    const repo = new ToolboxRepository()
    const seen = new Set<string>()
    contributeTaxonomy(repo, new ConceptVisualResolver(), libTax, true, seen)
    contributeTaxonomy(repo, new ConceptVisualResolver(), libTax, true, seen)
    expect(repo.Pages.ToArray().find((p) => p.Id === 'Stack')!.Items.Count).toBe(1)
  })
})

class TestToolboxService extends ToolboxService {
  public data: Array<{ tax: ToolboxTaxonomy; isLibrary: boolean }> = []
  protected async collectTaxonomies(): Promise<Array<{ tax: ToolboxTaxonomy; isLibrary: boolean }>> { return this.data }
}

describe('ToolboxService.reload', () => {
  it('populates the repository, exposes .Repository, and replaces on re-reload without disturbing Shapes', async () => {
    const svc = new TestToolboxService(new ServiceProvider())
    svc.data = [{ tax: libTax, isLibrary: true }, { tax: conceptTax, isLibrary: false }]
    await svc.reload()

    const repo = svc.Repository
    expect(repo).toBeInstanceOf(ToolboxRepository)
    expect(svc.Pages).toBe(repo.Pages)
    expect(repo.Pages.ToArray().some((p) => p.Id === 'Stack')).toBe(true)
    expect(repo.Pages.ToArray().some((p) => p.Id === 'actors')).toBe(true)
    const shapesBefore = repo.Pages.ToArray().filter((p) => p.Id !== 'Stack' && p.Id !== 'actors').length

    svc.data = [{ tax: libTax, isLibrary: true }]
    await svc.reload()
    expect(repo.Pages.ToArray().filter((p) => p.Id === 'Stack').length).toBe(1)
    expect(repo.Pages.ToArray().some((p) => p.Id === 'actors')).toBe(false)
    expect(repo.Pages.ToArray().filter((p) => p.Id !== 'Stack').length).toBe(shapesBefore)
  })
})
