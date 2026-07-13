// architecture-meta-models.module.mu â€” the Architecture Meta-models module.
//
// A ShellModule: a capability provider added to the shell via a `.modules:`
// block on the Application. Its capability is one root-nav entry (Name + Icon)
// whose content is service-backed â€” the `.services:` block registers the
// service, the Capability names it via `ServiceKey`, and a shared
// `DataTemplate [DataType = PlexusPanelService]` (in panels.resources.mu) renders it in the
// left panel. See services/panels/panel-services.ts and diagram.module.mu.

import ArchitectureMetaModelsService from "./services/architecture-meta-models-service.js"

module ArchitectureMetaModelsModule [ Name = "Architecture Meta-models" ] {
    .services: {
        ArchitectureMetaModelsService
    }

    Capability [ Name = "Architecture Meta-models", Icon = @ArchitectureMetaModels, ServiceKey = ArchitectureMetaModelsService ]
}
