// meta-model.module.mu — the Meta-model module.
//
// A ShellModule that contributes the "meta-model" PROJECT TYPE (not a nav
// capability). A user creates a Meta-model project from New Project, authors
// .todl definitions inside it (validated live by MetaModelValidationService),
// and publishes the compiled model + sources into the meta-models storage
// backend. A pure contributor — services + a project factory, no Capability —
// so it declares no rail entry; the project type is reached via New Project.
//
// Mirrors the diagram module's contribution shape (see diagram.module.mu):
// `.services:` registers the factory + validator, and `.projectFactories:`
// routes a folder whose manifest type is "meta-model" to the factory via the
// ProjectFactoryRegistry.

import MetaModelProjectFactory from "./services/meta-model-project-factory.js"
import TodlDocumentFactory from "./services/todl-document-factory.js"

module MetaModelModule [ Name = "Meta-model" ] {
    .services: {
        MetaModelProjectFactory
        TodlDocumentFactory
    }

    .projectFactories: {
        ProjectFactoryDefinition
            [ Type        = "meta-model",
              Title       = "Meta-model Project",
              Description = "Author and validate TODL meta-model definitions.",
              Factory     = MetaModelProjectFactory ]
    }

    // The `.todl` editor — resolved by the ProjectExplorerService for open/save/
    // new of any `.todl` file (in any project). Factory is TodlDocumentFactory.
    .documents: {
        DocumentDefinition
            [ Type           = "todl",
              Title          = "TODL",
              Description    = "A TODL definition source file.",
              FileExtensions = [".todl"],
              Factory        = TodlDocumentFactory ]
    }
}
