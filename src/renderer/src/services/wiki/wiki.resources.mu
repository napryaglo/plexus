// wiki.resources.mu — the shared "Open Wiki" context menu, attached by four
// surfaces (canvas node, toolbox tile, meta-model entity, library class) via a
// `when ($HasWiki = true)` trigger. The MenuItem's DataContext is the row VM, so
// $Concept resolves against it; $service(WikiService) resolves the app service.

import WikiService from "./wiki-service.js"

resources WikiResources {
    ContextMenu x:key="OpenWikiMenu" {
        MenuItem [ Header           = "Open Wiki",
                   Command          = $service(WikiService).OpenWikiCommand,
                   CommandParameter = $Concept ]
    }
}
