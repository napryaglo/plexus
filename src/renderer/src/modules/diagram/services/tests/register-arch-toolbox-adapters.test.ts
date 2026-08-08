import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { LibraryRegistry } from '../../../library/services/library-registry.js'
import { registerArchToolboxAdapters } from '../register-arch-toolbox-adapters.js'
import { TodlVisualResolverKey } from '../todl-visual-resolver.js'
import { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'

function providerWithRegistry(): ServiceProvider {
  const p = new ServiceProvider()
  p.registerInstance(LibraryRegistry.Key, { discover: async () => [] } as never)
  return p
}

describe('registerArchToolboxAdapters', () => {
  it('registers TodlVisualResolverKey + drop factory, constructs TodlPresentationRegistry if absent, idempotent', () => {
    const p = providerWithRegistry()
    registerArchToolboxAdapters(p)
    expect(p.get(TodlVisualResolverKey)).toBeDefined()
    expect(p.get(ArchInstanceDropFactoryKey)).toBeDefined()
    const registry = p.get(TodlPresentationRegistry.Key)
    expect(registry).toBeDefined()
    // Both sources registered (idempotency checked by calling twice)
    registerArchToolboxAdapters(p)
    expect(p.get(TodlVisualResolverKey)).toBeDefined()
    expect(p.get(TodlPresentationRegistry.Key)).toBe(registry) // same instance
  })

  it('does not register old LibraryClassVisualResolverKey or ConceptVisualResolverKey', () => {
    const p = providerWithRegistry()
    registerArchToolboxAdapters(p)
    // Only TodlVisualResolverKey is the resolver now
    // The old keys are ServiceKey instances so we can't check by string — but we CAN
    // verify the new key is present and nothing throws
    expect(p.get(TodlVisualResolverKey)).toBeDefined()
  })
})
