// architecture-projects.module.mu - the Architecture Projects module.
//
// A ShellModule with NO nav Capability (like code-editor/problems/agent-chat):
// it carries only the BACKEND for architecture projects — the `architecture`
// project type (ArchitectureProjectFactory) and the `.archdiagram` concept-aware
// editor (ArchDiagramDocumentFactory) — with no left-panel entry. The editor's
// view resources are merged app-global from architecture-projects.resources.mu.

import ArchitectureProjectFactory from "./services/architecture-project-factory.js"
import ArchDiagramDocumentFactory from "./services/arch-diagram-document-factory.js"

module ArchitectureProjectsModule [ Name = "Architecture Projects" ] {
    .services: {
        ArchitectureProjectFactory
        ArchDiagramDocumentFactory
    }

    // The `.archdiagram` editor — a concept-aware canvas that drops library terms
    // as meta-model concept instances and emits a sibling `.todl`. Resolved by the
    // ProjectExplorerService for open/save/new of any `.archdiagram` file.
    .documents: {
        DocumentDefinition
            [ Type           = "architecture-diagram",
              Title          = "Architecture Diagram",
              Description    = "A concept-aware architecture canvas backed by TODL.",
              FileExtensions = [".archdiagram"],
              Factory        = ArchDiagramDocumentFactory ]
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
