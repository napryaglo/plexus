// app.mu — the Plexus application root.
//
// An `Application` block compiles to `export const app` (an initialized
// Application whose `x:root` element is the mounted root visual). The
// renderer bootstrap (main.js) hands `app` an HtmlTarget to paint into.
//
// The root is an EditorShell — the framework's app-frame control. Its
// default template lays out six regions: Header (top), Commands (top),
// Navigation (left), Content (fill), Inspector (right), Status (bottom).
// Each body child picks its region via the `Shell.Region` attached
// property; an unpopulated region collapses. This is the same shell the
// demo platform uses, mapped to a diagram editor's frame:
//
//   Header      brand bar
//   Commands    editing toolbar
//   Navigation  shape toolbox (left)
//   Content     the canvas surface
//   Inspector   format / properties pane (right)
//   Status      status bar (bottom)
//
// Regions are populated with a real-but-minimal skeleton; each grows into
// its full control (a data-driven toolbox, DiagramDocument-backed canvas,
// live ShapeFormatControl, etc.) as the editor fills in.

// Theme / Scheme are real class references (the no-string-proxies rule);
// Shell owns the `Region` attached property. All other controls resolve
// through the compiler's default symbol table.
import Material from "@pragmatic-lab/mural/resources/material"
import MaterialDark from "@pragmatic-lab/mural/resources/material"
import Shell from "@pragmatic-lab/mural/framework/shell/shell.js"

// The app's modules — each a `module NAME { … }` const from its own file.
// Listed in the `.modules:` block below, they compose onto the shell:
// every capability's Name (and, later, Icon) becomes a root-nav entry, and
// the NavigationService surfaces the active capability's Panel.
import DiagramModule from "./modules/diagram/diagram.module.mu.js"
import ArchitectureRepositoryModule from "./modules/architecture-repository/architecture-repository.module.mu.js"
import TechnologyLibraryModule from "./modules/technology-library/technology-library.module.mu.js"
import ProjectExplorerModule from "./modules/project-explorer/project-explorer.module.mu.js"
import OntologiesModule from "./modules/ontologies/ontologies.module.mu.js"
import MetaModelModule from "./modules/meta-model/meta-model.module.mu.js"
import LibraryModule from "./modules/library/library.module.mu.js"
import AgentChatModule from "./modules/agent-chat/agent-chat.module.mu.js"

// Shared icon dictionary — one Geometry per capability, merged into the app's
// Resources (via `merge` below) so each module's `Icon = @<Key>` resolves.
import PlexusIcons from "./plexus-icons.mu.js"

// Services live under ./services/<service>/, each folder carrying the service
// (and, where it has view resources, a *.resources.mu dictionary merged below).
// app.mu only COMPOSES: it registers services in `.services:` and merges each
// service's resource dictionary — the templates themselves live with the service.

// Native file-system capability (open/save dialogs, read/write, directory
// listing). Resolved via FileSystemService.Key; no view resources.
import FileSystemService from "./services/file-system/file-system-service.js"

// Static host environment (dirs, platform, versions, flags). No view resources.
import EnvironmentService from "./services/environment/environment-service.js"

// Storage-provider seam: maps a backend id → a rooted IStorage factory (seeded
// with the local-FS backend over FileSystemService). The Project Explorer builds
// a project's storage through this; remote backends (cloud/REST) register here.
import StorageProviderRegistry from "./services/storage/storage-provider-registry.js"

// Recent-projects MRU — persists opened/created projects to a JSON file under
// userData (via FileSystemService), surfaced by the Open Project dialog.
import RecentProjectsService from "./services/projects/recent-projects-service.js"

// Open-projects set — persists which projects are open to a JSON file under
// userData, so the workspace restores on launch (ProjectExplorer.RestoreSession).
import OpenProjectsStore from "./services/projects/open-projects-store.js"

// Capability content services + their side-pane templates.
import PanelsResources from "./services/panels/panels.resources.mu.js"

// Diagram editor (ported from the Diagrammer demo, distributed across the shell
// regions). DiagramWorkspaceService owns the seeded DiagramDocument + the live
// Diagram control and presents the canvas in the Content region; DiagramResources
// carries the icons, toolbar/tile templates, and the ToolBox shapes panel.
import DiagramWorkspaceService from "./modules/diagram/services/diagram-workspace-service.js"
import DiagramResources from "./modules/diagram/diagram.resources.mu.js"

// Layout pipeline inspector: composes a Fresco layout pipeline and runs it on
// the active diagram. Root-registered so the shell Inspector region reaches
// the same instance the canvas menu opens.
import LayoutPipelineService from "./modules/diagram/layout/layout-pipeline-service.js"
import LayoutInspectorResources from "./modules/diagram/layout/layout-inspector.resources.mu.js"

// Project Explorer view — the generic project tree + command bar
// (DataTemplate[ProjectExplorerService] + recursive DataTemplate[ProjectNode]).
import ProjectExplorerResources from "./modules/project-explorer/project-explorer.resources.mu.js"

// Agent chat panel (DataTemplate[AgentService] + transcript item templates).
import AgentChatResources from "./modules/agent-chat/agent-chat.resources.mu.js"

// Code editor: opens files as Monaco-backed CodeDocuments (a DomHost carries
// Monaco's DOM into the SVG surface via <foreignObject>). CodeEditorService
// opens/dedupes tabs; CodeEditorResources carries DataTemplate[CodeDocument].
import CodeEditorService from "./modules/code-editor/code-editor-service.js"

// Document tab strip — overrides the framework's DataTemplate[DocumentsContentHostService]
// with an ExtendedTabControl that adds a top-right overflow dropdown (Close All +
// the open-tabs list). No service; view resources only.
import DocumentTabsResources from "./services/document-tabs/document-tabs.resources.mu.js"

// Shared TODL live-validation service (base-aware): validates any authoring
// project's .todl files against its declared bases via checkAgainst. Root-scoped
// like ProjectFactoryRegistry so every module's editor can attach documents.
import TodlValidationService from "./services/todl/todl-validation-service.js"
import DiagnosticsService from "./services/diagnostics/diagnostics-service.js"
import CodeEditorResources from "./modules/code-editor/code-editor.resources.mu.js"


// Settings: persistence store, the footer-gear launcher, and the settings-page
// view resources. ApplicationSettings (framework, auto-provided by EditorShell)
// + the store under SettingsStoreKey turn on persistence to userData/settings.json.
import ElectronSettingsStore from "./services/settings/settings-store.js"
import PlexusSettingsContribution from "./services/settings/settings-contribution.js"
import SettingsResources from "./services/settings/settings.resources.mu.js"
// Framework tokens registered at the app ROOT below (see `.services:`).
import SettingsStoreKey from "@pragmatic-lab/mural/framework"
import ApplicationSettings from "@pragmatic-lab/mural/framework"
import SettingsContributionKey from "@pragmatic-lab/mural/framework"

// The Navigation region's service is provided by EditorShell itself: a base
// NavigationService whose destinations flatten from the modules listed below.
// No app-level `.services:` registration is needed — the shell supplies the
// default (an app wanting custom navigation would register its own against
// NavigationService.Key to override it).
Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        FileSystemService
        EnvironmentService
        // Storage backends, keyed by id; the Project Explorer resolves this to
        // build a project's rooted IStorage. Root singleton so every consumer
        // shares the same registration set.
        StorageProviderRegistry
        // Recent-projects MRU (persisted under userData) — the Open Project
        // dialog lists it; open/create push to it.
        RecentProjectsService
        // Open-projects set (persisted under userData) — the explorer updates it
        // on open/close and restores it at launch.
        OpenProjectsStore
        // Persistence backend for ApplicationSettings, bound to the framework's
        // SettingsStoreKey (a different token than the impl class itself).
        ElectronSettingsStore -> SettingsStoreKey
        // Settings contribution: supplies the framework's settings seam with the
        // rail gear icon (@Settings) + the settings view (SettingsPage). EditorShell
        // pins a footer RailAction wired to the framework SettingsLauncherService,
        // which presents CreateView() in the content region. Bound to the framework
        // token so the shell resolves it.
        PlexusSettingsContribution -> SettingsContributionKey
        // Diagram editor hub: owns the seeded diagram DOCUMENT (an IDocument).
        // Root-registered so the ToolBox panel and the startup opener (main.js)
        // resolve the SAME instance. It no longer holds a control — the canvas is
        // materialized by DataTemplate[DiagramDocument] in the content region.
        DiagramWorkspaceService
        // Layout pipeline inspector service — reachable shell-wide (the Inspector
        // region template and the canvas "Layout" menu resolve this instance).
        LayoutPipelineService
        // Content region host — a DocumentsContentHostService (TDI: open-set +
        // ActiveDocument + Close) bound to the framework's ContentHostService.Key.
        // The shell's content region, the tab strip, the settings launcher, and
        // main.js all resolve THIS instance through that key. Root-registered so
        // the root-scoped launcher reaches the same instance the shell uses
        // (otherwise EditorShell registers it shell-scoped, unreachable from root).
        DocumentsContentHostService -> ContentHostService
        // Project-type registry (module .projectFactories → factories). Same
        // root-scope reason as the content host: the generic ProjectExplorerService
        // is a module (root-scoped) service, so it must reach the registry from
        // root. EditorShell otherwise registers it shell-scoped — unreachable from
        // root — which silently breaks New/Open Project (getRequired throws before
        // any dialog shows). Registering here makes EditorShell's `has()` guard
        // skip its shell registration and share this one.
        ProjectFactoryRegistry
        // Document-type registry (module .documents → editors). Root-registered
        // for the same reason as ProjectFactoryRegistry: the root-scoped
        // ProjectExplorerService resolves a file's editor (by extension) through
        // it. Its constructor populates from module .documents: blocks.
        DocumentTypeRegistry
        ApplicationSettings
        // Code editor: opens files as Monaco-backed document tabs. Resolves the
        // content host + FileSystemService lazily, so registration order is free.
        CodeEditorService
        // Source-agnostic diagnostics store — the single sink the TODL validator
        // publishes to and the Problems dock + editor consume from.
        DiagnosticsService
        // Shared base-aware TODL validator (meta-model / library / architecture).
        TodlValidationService
    }

    .modules: {
        DiagramModule
        ArchitectureRepositoryModule
        TechnologyLibraryModule
        ProjectExplorerModule
        OntologiesModule
        MetaModelModule
        LibraryModule
        AgentChatModule
    }

    resources: {
        merge PlexusIcons

        // A vertical-stack items panel. A bare ItemsControl has no default
        // ItemsPanel in mural (unlike WPF), so without one it renders nothing —
        // the merged service dictionaries reference this as their ItemsPanel. Kept
        // here (not in a service folder) as a genuinely app-level shared helper.
        ItemsPanelTemplate x:key="VerticalStackPanel" {
            StackPanel [ Orientation = Vertical ]
        }

        // Each service's view resources live with the service, merged app-global
        // here (see ./services/<service>/*.resources.mu).
        merge PanelsResources
        merge SettingsResources

        // Diagram editor: icons + canvas/toolbar-tile/shapes templates. The shell
        // chrome (command toolbar, document tabs, Format-Shape inspector) is now
        // the framework EditorShell default, data-driven from the app's declared
        // commands + the active document — so no per-app shell template override.
        merge DiagramResources

        // Layout pipeline builder view (DataTemplate[LayoutInspector]).
        merge LayoutInspectorResources

        // Project Explorer tree + command bar (DataTemplate[ProjectExplorerService]).
        merge ProjectExplorerResources

        // Agent chat panel (DataTemplate[AgentService] + transcript item templates).
        merge AgentChatResources

        // Code editor (DataTemplate[CodeDocument] declares a CodeEditor — a
        // DomHost subclass hosting Monaco, self-bound to the document's Content).
        merge CodeEditorResources

        // Document tab strip override: ExtendedTabControl with a top-right
        // overflow dropdown (Close All + open-tabs list). Shadows the framework's
        // DocumentsContentHostService template from Application.Resources.
        merge DocumentTabsResources

        // The app root — the framework's default EditorShell. All regions are
        // data-driven (services + the active document), so the app declares no
        // shell chrome.
        EditorShell x:root { }
    }
}
