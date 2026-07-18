// ontologies.module.mu — the Ontologies module.
//
// A ShellModule: a capability provider added to the shell via a `.modules:`
// block on the Application. Its capability is one root-nav entry (Name + Icon)
// whose content is service-backed — the `.services:` block registers the
// service, the Capability names it via `ServiceKey`, and a shared
// `DataTemplate [DataType = PlexusPanelService]` (in panels.resources.mu) renders it in the
// left panel. See services/panels/panel-services.ts and diagram.module.mu.

import OntologiesService from "./services/ontologies-service.js"

module OntologiesModule [ Name = "Ontologies" ] {
    .services: {
        OntologiesService
    }

    Capability [ Name = "Ontologies", Icon = @Ontologies, ServiceKey = OntologiesService ]
}
