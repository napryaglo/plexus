// architecture-repository.module.mu â€” the Architecture Repository module.
//
// A ShellModule: a capability provider added to the shell via a `.modules:`
// block on the Application. Its capability is one root-nav entry (Name + Icon)
// whose content is service-backed â€” the `.services:` block registers the
// service, the Capability names it via `ServiceKey`, and a shared
// `DataTemplate [DataType = PlexusPanelService]` (in panels.resources.mu) renders it in the
// left panel. See services/panels/panel-services.ts and diagram.module.mu.

import ArchitectureRepositoryService from "./services/architecture-repository-service.js"

module ArchitectureRepositoryModule [ Name = "Architecture Repository" ] {
    .services: {
        ArchitectureRepositoryService
    }

    Capability [ Name = "Architecture Repository", Icon = @ArchitectureRepository, ServiceKey = ArchitectureRepositoryService ]
}
