// architecture-projects.module.mu - the Architecture Projects module.
//
// A ShellModule with NO nav Capability (like code-editor/problems/agent-chat):
// it carries only the BACKEND for architecture projects — the `architecture`
// project type (ArchitectureProjectFactory) — with no left-panel entry. Its
// `.todl` files are the architecture model; `.diagram` files inside are edited
// by the diagram module's generic DiagramDocumentFactory (resolved by extension),
// standalone today and model-bound once the ArchitectureModelService lands.

import ArchitectureProjectFactory from "./services/architecture-project-factory.js"

module ArchitectureProjectsModule [ Name = "Architecture Projects" ] {
    .services: {
        ArchitectureProjectFactory
    }

    // The 'architecture' project type — this module owns it (editors own files,
    // modules own project types). ArchitectureProjectFactory owns the project
    // lifecycle; the .diagram files inside are edited by the diagram module's
    // DiagramDocumentFactory, resolved by extension.
    .projectFactories: {
        ProjectFactoryDefinition
            [ Type    = "architecture",
              Title   = "Architecture Project",
              Factory = ArchitectureProjectFactory ]
    }
}
