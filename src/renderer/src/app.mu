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
import Material from "@visualisation-sub/mural/resources/material"
import MaterialDark from "@visualisation-sub/mural/resources/material"
import Shell from "@visualisation-sub/mural/framework/shell/shell.js"

// The app's modules — each a `module NAME { … }` const from its own file.
// Listed in the `.modules:` block below, they compose onto the shell:
// every capability's Name (and, later, Icon) becomes a root-nav entry, and
// the NavigationService surfaces the active capability's Panel.
import DiagramModule from "./modules/diagram/diagram.module.mu.js"
import ArchitectureRepositoryModule from "./modules/architecture-repository/architecture-repository.module.mu.js"
import TechnologyLibraryModule from "./modules/technology-library/technology-library.module.mu.js"
import ProjectExplorerModule from "./modules/project-explorer/project-explorer.module.mu.js"
import ArchitectureMetaModelsModule from "./modules/architecture-meta-models/architecture-meta-models.module.mu.js"

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

// Capability content services + their side-pane templates.
import PanelsResources from "./services/panels/panels.resources.mu.js"

// Diagram editor (ported from the Diagrammer demo, distributed across the shell
// regions). DiagramWorkspaceService owns the seeded DiagramDocument + the live
// Diagram control and presents the canvas in the Content region; DiagramResources
// carries the icons, toolbar/tile templates, and the ToolBox shapes panel.
import DiagramWorkspaceService from "./modules/diagram/services/diagram-workspace-service.js"
import DiagramResources from "./modules/diagram/diagram.resources.mu.js"


// Settings: persistence store, the footer-gear launcher, and the settings-page
// view resources. ApplicationSettings (framework, auto-provided by EditorShell)
// + the store under SettingsStoreKey turn on persistence to userData/settings.json.
import ElectronSettingsStore from "./services/settings/settings-store.js"
import PlexusSettingsContribution from "./services/settings/settings-contribution.js"
import SettingsResources from "./services/settings/settings.resources.mu.js"
// Framework tokens registered at the app ROOT below (see `.services:`).
import SettingsStoreKey from "@visualisation-sub/mural/framework"
import ApplicationSettings from "@visualisation-sub/mural/framework"
import SettingsContributionKey from "@visualisation-sub/mural/framework"

// The Navigation region's service is provided by EditorShell itself: a base
// NavigationService whose destinations flatten from the modules listed below.
// No app-level `.services:` registration is needed — the shell supplies the
// default (an app wanting custom navigation would register its own against
// NavigationService.Key to override it).
Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        FileSystemService
        EnvironmentService
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
        // Content region host — a DocumentsContentHostService (TDI: open-set +
        // ActiveDocument + Close) bound to the framework's ContentHostService.Key.
        // The shell's content region, the tab strip, the settings launcher, and
        // main.js all resolve THIS instance through that key. Root-registered so
        // the root-scoped launcher reaches the same instance the shell uses
        // (otherwise EditorShell registers it shell-scoped, unreachable from root).
        DocumentsContentHostService -> ContentHostService
        ApplicationSettings
    }

    .modules: {
        DiagramModule
        ArchitectureRepositoryModule
        TechnologyLibraryModule
        ProjectExplorerModule
        ArchitectureMetaModelsModule
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

        // The app root — the framework's default EditorShell. All regions are
        // data-driven (services + the active document), so the app declares no
        // shell chrome.
        EditorShell x:root { }
    }
}
