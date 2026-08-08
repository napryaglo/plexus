import type { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { LibraryRegistry } from '../../library/services/library-registry.js'
import { LibraryClassVisualResolver, LibraryClassVisualResolverKey } from './library-class-visual-resolver.js'
import { ConceptVisualResolver, ConceptVisualResolverKey } from './concept-visual-resolver.js'
import { ArchInstanceDropFactory, ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'

// Idempotently register the Plexus toolbox resolvers + drop factory into the
// service provider. Returns the ConceptVisualResolver so the populator can feed it
// term icons. Safe to call on every reload — existing registrations are left as-is.
export function registerArchToolboxAdapters(services: ServiceProvider): ConceptVisualResolver
{
    if (!services.has(LibraryClassVisualResolverKey))
    {
        const registry = services.get(LibraryRegistry.Key)
        if (registry !== undefined) services.registerInstance(LibraryClassVisualResolverKey, new LibraryClassVisualResolver(registry))
    }
    if (!services.has(ArchInstanceDropFactoryKey))
    {
        services.registerInstance(ArchInstanceDropFactoryKey, new ArchInstanceDropFactory())
    }
    if (!services.has(ConceptVisualResolverKey))
    {
        services.registerInstance(ConceptVisualResolverKey, new ConceptVisualResolver())
    }
    return services.getRequired(ConceptVisualResolverKey) as ConceptVisualResolver
}
