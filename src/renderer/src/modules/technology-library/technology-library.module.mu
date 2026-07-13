// technology-library.module.mu â€” the Technology Library module.
//
// A ShellModule: a capability provider added to the shell via a `.modules:`
// block on the Application. Its capability is one root-nav entry (Name + Icon)
// whose content is service-backed â€” the `.services:` block registers the
// service, the Capability names it via `ServiceKey`, and a shared
// `DataTemplate [DataType = PlexusPanelService]` (in panels.resources.mu) renders it in the
// left panel. See services/panels/panel-services.ts and diagram.module.mu.

import TechnologyLibraryService from "./services/technology-library-service.js"

module TechnologyLibraryModule [ Name = "Technology Library" ] {
    .services: {
        TechnologyLibraryService
    }

    Capability [ Name = "Technology Library", Icon = @TechnologyLibrary, ServiceKey = TechnologyLibraryService ]
}
