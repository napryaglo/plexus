// architecture-meta-models-service.ts — the Architecture Meta-models module's
// left-panel content service. Module-local: registered by the module's
// `.services:` block and named by its Capability's `ServiceKey`. Extends the
// SHARED PlexusPanelService base (root services/panels/) and renders through the
// shared `DataTemplate [DataType = PlexusPanelService]`.
import {
    PlexusPanelService,
} from '../../../services/panels/panel-services.js';
import { ServiceKey, type IServiceProvider } from '@visualisation-sub/mural/runtime';

export class ArchitectureMetaModelsService extends PlexusPanelService
{
    public static readonly Key = new ServiceKey<ArchitectureMetaModelsService>('ArchitectureMetaModelsService');
    constructor(provider: IServiceProvider) { super(provider, ['Business', 'Application', 'Technology']); }
}
