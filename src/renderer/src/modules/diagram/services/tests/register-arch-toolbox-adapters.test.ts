import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { LibraryRegistry } from '../../../library/services/library-registry.js'
import { registerArchToolboxAdapters } from '../register-arch-toolbox-adapters.js'
import { LibraryClassVisualResolverKey } from '../library-class-visual-resolver.js'
import { ConceptVisualResolverKey } from '../concept-visual-resolver.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'

function providerWithRegistry(): ServiceProvider {
  const p = new ServiceProvider()
  p.registerInstance(LibraryRegistry.Key, { resolve: () => undefined, onChanged: () => () => {} } as never)
  return p
}

describe('registerArchToolboxAdapters', () => {
  it('registers both resolvers + the factory, idempotently', () => {
    const p = providerWithRegistry()
    const concept1 = registerArchToolboxAdapters(p)
    expect(p.get(LibraryClassVisualResolverKey)).toBeDefined()
    expect(p.get(ConceptVisualResolverKey)).toBe(concept1)
    expect(p.get(ArchInstanceDropFactoryKey)).toBeDefined()
    const libFirst = p.get(LibraryClassVisualResolverKey)
    const concept2 = registerArchToolboxAdapters(p)
    expect(concept2).toBe(concept1)
    expect(p.get(LibraryClassVisualResolverKey)).toBe(libFirst)
  })
})
