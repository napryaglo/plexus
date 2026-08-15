import type { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { LibraryRegistry } from '../../library/services/library-registry.js'
import { ArchInstanceDropFactory, ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'
import { ArchModelInstanceDropFactory, ArchModelInstanceDropFactoryKey } from '../../architecture-projects/services/arch-model-instance-drop-factory.js'
import { TodlPresentationRegistry } from './todl-presentation-registry.js'
import { TodlVisualResolver, TodlVisualResolverKey } from './todl-visual-resolver.js'
import { LibraryPresentationSource } from '../../library/services/library-presentation-source.js'
import { MetaModelPresentationSource } from '../../meta-model/services/meta-model-presentation-source.js'

// Idempotently register the Plexus toolbox resolver + drop factory into the
// service provider. Safe to call on every reload — existing registrations are
// left as-is; registerSource is idempotent by id so re-registering the same
// sources is harmless.
export function registerArchToolboxAdapters(services: ServiceProvider): void
{
    let registry = services.get(TodlPresentationRegistry.Key)
    if (registry === undefined)
    {
        registry = new TodlPresentationRegistry(services)
        services.registerInstance(TodlPresentationRegistry.Key, registry)
    }
    registry.registerSource(new LibraryPresentationSource(services, () => services.get(LibraryRegistry.Key)?.discover() ?? Promise.resolve([])))
    registry.registerSource(new MetaModelPresentationSource(services))

    if (!services.has(ArchInstanceDropFactoryKey))
    {
        services.registerInstance(ArchInstanceDropFactoryKey, new ArchInstanceDropFactory(services))
    }
    if (!services.has(ArchModelInstanceDropFactoryKey))
    {
        services.registerInstance(ArchModelInstanceDropFactoryKey, new ArchModelInstanceDropFactory(services))
    }
    if (!services.has(TodlVisualResolverKey))
    {
        services.registerInstance(TodlVisualResolverKey, new TodlVisualResolver(registry))
    }
}
