// Renderer bootstrap — a thin plain-JS entry (mural convention: bootstraps
// stay plain JS). Vite bundles this and everything it pulls in, resolving
// `mural/*` to the built dist (see electron.vite.config).
//
// `app` is the initialized Application compiled from app.mu; handing it an
// HtmlTarget mounts the mural UI into #app. In the Electron renderer this is
// Chromium, so mural's SVG pipeline runs exactly as it does in a browser.
// Self-hosted icon font (@font-face). Imported before anything else so the face
// is registered by the time `document.fonts.load` runs below — resolves from
// local disk instead of the Google CDN, so the shell isn't gated on two network
// round-trips (was a multi-second white window). See fonts.css.
import './fonts.css'
import { app } from './app.mu.js'
import { HtmlTarget } from '@pragmatic-tech-ai/mural/visual-engine'
import { ThemeManager, Density, RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, PanelDockService, DialogService, ApplicationSettings } from '@pragmatic-tech-ai/mural/framework'
import { confirmCloseDocs } from './services/documents/confirm-close-docs.js'
import { ChatSessionsService } from './modules/agent-chat/services/chat-sessions-service.js'
import { ProjectAgentCatalog } from './modules/agent-chat/services/project-agent-catalog.js'
import { TemplateGalleryService } from './modules/agent-chat/services/template-gallery-service.js'
import { attachAutoOpenInspector } from './modules/diagram/behaviors/auto-open-inspector-behavior.js'
import { attachSaveShortcuts } from './services/documents/save-shortcuts.js'
import { attachZoomShortcuts } from './modules/diagram/behaviors/zoom-shortcuts.js'
import { registerThemeSchemePicker } from './theme/register-scheme-picker.js'
import { attachTitleBar } from './window/title-bar.js'
import { removeSplash } from './window/splash.js'
import { TitleService } from './window/title-service.js'
import { BackgroundWorkService } from './modules/background-work/services/background-work-service.js'
import { ProjectExplorerService } from './modules/project-explorer/services/project-explorer-service.js'
import { WorkspaceRefreshService } from './services/workspace/workspace-refresh-service.js'
import { FileWatchService } from './services/file-watch/file-watch-service.js'
import { EditorReloadService } from './services/file-watch/editor-reload-service.js'
import { ProjectRescanService } from './services/file-watch/project-rescan-service.js'
import { WorkspaceBaseResolver } from './services/projects/workspace-base-resolver.js'
import { ArchDiagramBindingService } from './modules/architecture-projects/services/arch-diagram-binding-service.js'
import { ArchModelToolboxContributor } from './modules/architecture-projects/services/arch-model-toolbox-contributor.js'
import { DiagramCameraService } from './modules/diagram/services/diagram-camera-service.js'
import { DiagramGuidesService } from './modules/diagram/services/diagram-guides-service.js'
import { DiagramCanvasService } from './modules/diagram/services/diagram-canvas-service.js'
import { AutosaveService } from './services/autosave/autosave-service.js'
import { DocumentCloseGuard } from './services/documents/document-close-guard.js'
import { ArchNewDiagramParticipant } from './modules/architecture-projects/services/arch-new-diagram-participant.js'
import { NewFileParticipantKey } from './services/documents/new-file-participant.js'
import { ArchEditViewpointsCommand } from './modules/architecture-projects/services/arch-edit-viewpoints-command.js'
import { DiagramCommandExtensionKey } from './modules/diagram/services/diagram-command-extension.js'
import { ArchNodeCommandContributor } from './modules/architecture-projects/services/arch-node-command-contributor.js'
import { NodeCommandContributorKey } from './services/documents/node-command-contributor.js'
import { registerTodlLanguage } from './modules/meta-model/todl-language.js'
import { registerMuralLanguage } from './modules/code-editor/mural-language.js'
import { TodlLanguageClient } from './services/todl/todl-language-client.js'
import { createTodlLspConnection } from './services/todl/todl-lsp-connection.js'
import { registerTodlProviders } from './modules/meta-model/todl-lsp/register-providers.js'
import { setCrossFileOpener } from './modules/code-editor/cross-file-open.js'

// Register the 'todl' Monaco language once, before any editor mounts, so .todl
// documents get syntax colouring. (Diagnostics/squiggles are independent of it.)
registerTodlLanguage()
// Register the 'mural' Monaco language so .mu/.mural files get syntax colouring.
registerMuralLanguage()

// Surface any uncaught error prominently (a swallowed mount throw shows as a
// blank white window otherwise).
window.addEventListener('error', (e) => console.error('[plexus] uncaught:', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => console.error('[plexus] unhandled rejection:', e.reason))

// Run the whole shell at Compact density — matches the mural demo platform.
// ThemeManager.Density is an inherited attached property on the app root (set
// up by app.mu's initialize on import), so this single write cascades to every
// control's `when (ThemeManager.Density = Compact)` template trigger (tighter
// chip/toolbar/list chrome). Set before mount so the first layout is compact.
ThemeManager.Density = Density.Compact

// Pin layout to the loaded icon-font metrics before mounting — measureText
// returns fallback widths until the @font-face resolves.
await document.fonts.load('24px "Material Symbols Outlined"')
try {
    const renderTarget = new HtmlTarget(document.getElementById('app'))
    app.initialize(renderTarget)
    // The shell chrome (title strip + @Surface) has mounted; drop the boot
    // splash once the browser has flushed a real frame. Double-rAF: the first
    // callback runs before paint, the second after — so we never reveal a blank
    // frame between the splash fading and mural's first render.
    requestAnimationFrame(() => requestAnimationFrame(() => removeSplash()))
    // Contribute the right-aligned status-bar colour-scheme picker (a service-
    // bound shell control) before opening the first document, so the toolbar
    // service surfaces it on the document-open rebuild.
    registerThemeSchemePicker(app)
    // Custom frame: re-tint the native caption buttons (Window Controls Overlay)
    // to the mural header's surface on every scheme change (+ tag <body> on mac).
    // The title strip itself is painted by mural (Header region → @PlexusTitleBar).
    attachTitleBar(app)
    // Title feed: construct now so its ActiveDocument / OpenProjects subscriptions
    // are live and document.title tracks from boot — even before the header view
    // first binds $service(TitleService).Title.
    app.Services.get(TitleService.Key)
    // Background-work manager: construct now so the status-bar dock's binding
    // resolves the same instance any submitter uses.
    const bg = app.Services.get(BackgroundWorkService.Key)
    // Dev-only demo hook for the e2e smoke: a 3-step fake task with progress + output.
    if (bg !== undefined) {
        globalThis.__bgDemo = () => bg.run('Demo task', async (ctx) => {
            for (let i = 1; i <= 3; i++) {
                ctx.throwIfCancelled()
                ctx.log(`step ${i}/3`)
                ctx.report(i / 3, `step ${i}/3`)
                await new Promise((r) => setTimeout(r, 150))
            }
            return 'done'
        })
    }
    // Construct the workspace-refresh service now so it subscribes to agent
    // events before any turn runs (it isn't tied to a visible panel).
    app.Services.get(WorkspaceRefreshService.Key)
    // Construct the file-watch service now so it watches open project roots from
    // boot (it isn't tied to a visible panel); its consumers resolve it too.
    app.Services.get(FileWatchService.Key)
    // Editor-reload consumer: reloads open buffers on external change.
    app.Services.get(EditorReloadService.Key)
    // Project-rescan consumer: re-validates the owning project on external change.
    app.Services.get(ProjectRescanService.Key)
    // Local-first base resolver: construct now so its OpenProjects subscription
    // (refresh dependents on open/close) is live before session restore.
    app.Services.get(WorkspaceBaseResolver.Key)
    // Arch diagram binding: construct now so it observes opened documents and
    // binds architecture diagrams to their ArchModel from boot.
    app.Services.get(ArchDiagramBindingService.Key)
    // Arch model toolbox page: construct now so it observes the active document
    // from boot and contributes the "Model:" page for architecture diagrams.
    app.Services.get(ArchModelToolboxContributor.Key)
    // Diagram camera persistence: restore each diagram's saved zoom/pan on open and
    // write it back (debounced) on change, via the document's metadata slot. Generic
    // to every .diagram, so it lives in the diagram module (not architecture-projects).
    app.Services.register(DiagramCameraService.Key, (p) => new DiagramCameraService(p))
    app.Services.get(DiagramCameraService.Key)
    // Diagram guide persistence: restore each diagram's saved ruler guides on open
    // and write them back (debounced) on change, via the document's metadata slot.
    // Generic to every .diagram, like the camera service above.
    app.Services.register(DiagramGuidesService.Key, (p) => new DiagramGuidesService(p))
    app.Services.get(DiagramGuidesService.Key)
    // Document close guard: prompts Save / Don't Save / Cancel before a dirty
    // document tab closes. Registered so the tab template's ✕ ($service) and the
    // project-explorer/quit paths reach the same instance.
    app.Services.register(DocumentCloseGuard.Key, (p) => new DocumentCloseGuard(p))
    app.Services.get(DocumentCloseGuard.Key)
    // Autosave: periodically save every dirty document (interval + on/off from the
    // "Documents" settings). Eagerly constructed so its timer starts from boot.
    app.Services.register(AutosaveService.Key, (p) => new AutosaveService(p))
    app.Services.get(AutosaveService.Key)
    // Diagram canvas background: drive each diagram's PaginatedCanvas from the
    // "Diagram" settings — page size (page width/height) and the "Show grid"
    // pattern (grid size + colour). Generic to every .diagram; construct now so
    // it observes documents + settings from boot.
    app.Services.register(DiagramCanvasService.Key, (p) => new DiagramCanvasService(p))
    app.Services.get(DiagramCanvasService.Key)
    // Arch new-diagram participant: aliased under the generic NewFileParticipant
    // key so the ProjectExplorer prompts for governing viewpoints when a new
    // .diagram is created in an architecture project.
    app.Services.register(NewFileParticipantKey, (p) => new ArchNewDiagramParticipant(p))
    // Arch edit-viewpoints toolbar command: aliased under the generic diagram
    // command-extension key so PlexusDiagramDocument routes "arch.editViewpoints"
    // to the shared viewpoints editor (enabled only for arch-bound diagrams).
    app.Services.register(DiagramCommandExtensionKey, (p) => new ArchEditViewpointsCommand(p))
    // Arch node context-menu action: aliased under the generic node-command
    // contributor key so the ProjectExplorer surfaces "Edit Viewpoints…" on a
    // .diagram node in an architecture project.
    app.Services.register(NodeCommandContributorKey, (p) => new ArchNodeCommandContributor(p))
    // Wire the out-of-process TODL language client: build the JSON-RPC connection
    // over the preload pipe, handshake with the forked server, register the Monaco
    // provider adapters, and resync every project after a server restart.
    const todlClient = app.Services.get(TodlLanguageClient.Key)
    const todlBridge = window.api?.todlLsp
    if (todlClient !== undefined && todlBridge !== undefined) {
        const connection = createTodlLspConnection(todlBridge)
        await todlClient.Initialize(connection)
        todlBridge.onServerRestart(() => { void todlClient.Reinitialize() })
        registerTodlProviders(todlClient)
        // Cross-file go-to-definition: resolve a todl:// target back to its
        // (project, path) and open it in a tab + reveal, so navigation reaches
        // files that aren't already open. Non-todl URIs fall through to Monaco.
        setCrossFileOpener((uri, selection) => {
            const r = todlClient.resolveUri(uri)
            if (r === null) return false
            void app.Services.get(ProjectExplorerService.Key)?.OpenFileInProject(
                r.projectId, r.relpath, selection?.startLineNumber ?? 1, selection?.startColumn ?? 1)
            return true
        })
    }
    // The content region is document-driven (DocumentsContentHostService under
    // ContentHostService.Key). Nothing is opened at launch: the app starts with
    // no document tabs, and the user opens diagrams/files from the explorer. (We
    // used to seed an in-memory "Untitled Diagram" + a scratch.md tab here, but a
    // fixed seeded diagram fought the active-document model — the Format Shape
    // inspector bound to it instead of the diagram the user actually opened.)
    const host = app.Services.get(ContentHostService.Key)

    // Ctrl+S / Ctrl+Shift+S → Save / Save All; Ctrl+W → close the active document
    // through the close guard (prompts if dirty). CloseActiveCommand bridges "the
    // active document" to the host's id-keyed CloseDocumentCommand.
    if (host !== undefined) attachSaveShortcuts({
        SaveActiveCommand: host.SaveActiveCommand,
        SaveAllCommand: host.SaveAllCommand,
        CloseActiveCommand: new RelayCommand(
            () => { const d = host.ActiveDocument; if (d !== undefined) host.CloseDocumentCommand.Execute(d.Id) },
            () => host.ActiveDocument !== undefined),
    })

    // Ctrl +/−/0 → zoom in / out / reset on the active diagram's camera.
    if (host !== undefined) attachZoomShortcuts(host)

    // Save-on-quit: the main process awaits this from the window 'close' handler
    // (executeJavaScript). Resolves true when it's safe to quit (nothing dirty, or
    // the user chose Save All / Discard All) and false to cancel the quit.
    globalThis.__confirmCloseDocs = () =>
        host !== undefined ? confirmCloseDocs(host, app.Services.get(DialogService.Key)) : true

    // Dev/e2e: read a live setting value by key (used by the save-ux e2e to assert
    // the autosave settings registered with their defaults).
    globalThis.__getSetting = (k) => app.Services.get(ApplicationSettings.Key)?.Get(k)

    // Restore the previous session's open projects into the explorer (skips
    // folders whose project manifest is gone). Fire-and-forget after mount.
    const explorer = app.Services.get(ProjectExplorerService.Key)
    if (explorer !== undefined) void explorer.RestoreSession()

    // Right panel dock: restore stored conversations into the Conversations panel,
    // then open one starter conversation as the initial Chat tab. Constructing the
    // manager also wires its single agent-event listener. Also auto-open the Format
    // Shape inspector as a tab the first time a shape is selected (the behavior
    // watches the document's ActiveView, published when the canvas mounts).
    const dock = app.Services.get(PanelDockService.Key)
    const chats = app.Services.get(ChatSessionsService.Key)
    // Construct the .claude catalog cache now so the explorer's async submenu
    // populate resolves the same instance (it's otherwise lazy).
    app.Services.get(ProjectAgentCatalog.Key)
    if (chats !== undefined) {
        await chats.RestoreSession()
        // The single docked "Agent Chat" (restored in place if it has history). Other
        // sessions open as editor document tabs.
        await chats.EnsurePrimary()
        // Dev-only hooks for the e2e smoke: reach the manager from the page, and
        // launch a synthetic agent/skill run (no real .claude fixture needed).
        globalThis.__chats = chats
        globalThis.__runAgent = () => chats.RunAgentSkill(
            { kind: 'skill', name: 'demo-skill', description: '' }, '/tmp/x', 'Demo')
        // Flush all open conversations to disk. The main process awaits this from the
        // window 'close' handler (executeJavaScript) so nothing is lost on app quit.
        globalThis.__flushChats = () => chats.FlushAll()
    }
    // Dev-only: a Card Gallery tab to preview the agent card templates without
    // driving the agent. Never seeded in packaged builds.
    // DISABLED — registration turned off by request; re-enable by uncommenting.
    // The TemplateGalleryService + its templates are kept intact (import above,
    // agent-chat.module.mu registration, DataTemplate in agent-chat.resources.mu).
    // if (dock !== undefined && env !== undefined && env.IsDevelopment)
    // {
    //     const gallery = app.Services.get(TemplateGalleryService.Key)
    //     if (gallery !== undefined) dock.Add(gallery)
    // }
    if (host !== undefined && dock !== undefined)
    {
        attachAutoOpenInspector(host, dock)
    }
} catch (err) {
    // Never let the splash hang over a failed mount — drop it so the error
    // surfaces (console / any error overlay) instead of a frozen loading screen.
    removeSplash()
    console.error('[plexus] mount failed:', err)
    throw err
}
