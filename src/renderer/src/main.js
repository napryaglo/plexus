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
import { HtmlTarget } from '@pragmatic-lab/mural/visual-engine'
import { ContentHostService, PanelDockService } from '@pragmatic-lab/mural/framework'
import { DiagramWorkspaceService } from './modules/diagram/services/diagram-workspace-service.js'
import { AgentService } from './modules/agent-chat/services/agent-service.js'
import { attachAutoOpenInspector } from './modules/diagram/behaviors/auto-open-inspector-behavior.js'
import { attachSaveShortcuts } from './services/documents/save-shortcuts.js'
import { registerThemeSchemePicker } from './theme/register-scheme-picker.js'
import { attachTabSwitchDiagnostics } from './dev/tab-switch-diagnostics.js'
import { CodeEditorService } from './modules/code-editor/code-editor-service.js'
import { EnvironmentService } from './services/environment/environment-service.js'
import { ProjectExplorerService } from './modules/project-explorer/services/project-explorer-service.js'
import { WorkspaceRefreshService } from './services/workspace/workspace-refresh-service.js'
import { FileWatchService } from './services/file-watch/file-watch-service.js'
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

// Pin layout to the loaded icon-font metrics before mounting — measureText
// returns fallback widths until the @font-face resolves.
await document.fonts.load('24px "Material Symbols Outlined"')
try {
    const renderTarget = new HtmlTarget(document.getElementById('app'))
    app.initialize(renderTarget)
    // TEMPORARY: tab→canvas swap diagnostic (remove once root-caused).
    attachTabSwitchDiagnostics(app, renderTarget)
    // Contribute the right-aligned status-bar colour-scheme picker (a service-
    // bound shell control) before opening the first document, so the toolbar
    // service surfaces it on the document-open rebuild.
    registerThemeSchemePicker(app)
    // Construct the workspace-refresh service now so it subscribes to agent
    // events before any turn runs (it isn't tied to a visible panel).
    app.Services.get(WorkspaceRefreshService.Key)
    // Construct the file-watch service now so it watches open project roots from
    // boot (it isn't tied to a visible panel); its consumers resolve it too.
    app.Services.get(FileWatchService.Key)
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
    // Open the seeded diagram as the initial document. The content region is
    // document-driven (DocumentsContentHostService under ContentHostService.Key),
    // so opening the workspace's document activates it → the canvas renders via
    // DataTemplate[DiagramDocument]. Composition-root concern: the bootstrap
    // decides what's open at launch.
    const host = app.Services.get(ContentHostService.Key)
    const workspace = app.Services.get(DiagramWorkspaceService.Key)
    if (host !== undefined && workspace !== undefined) host.Open(workspace.Document)

    // Ctrl+S / Ctrl+Shift+S → Save / Save All on the document host.
    if (host !== undefined) attachSaveShortcuts(host)

    // Open a scratch file in the app's storage folder as a Monaco-backed code
    // document (DomHost + Monaco through a document tab). Opened after the
    // diagram so the editor tab is the active one on launch. The file need not
    // exist — the editor opens empty and Save() creates it under userData.
    const codeEditor = app.Services.get(CodeEditorService.Key)
    const env = app.Services.get(EnvironmentService.Key)
    if (codeEditor !== undefined && env !== undefined)
    {
        const sep = env.PathSeparator ?? '/'
        codeEditor.OpenFile(`${env.UserDataDirectory}${sep}scratch.md`)
    }

    // Restore the previous session's open projects into the explorer (skips
    // folders whose project manifest is gone). Fire-and-forget after mount.
    const explorer = app.Services.get(ProjectExplorerService.Key)
    if (explorer !== undefined) void explorer.RestoreSession()

    // Right panel dock: seed the always-present Chat tab, and auto-open the
    // Format Shape inspector as a tab the first time a shape is selected (the
    // behavior watches the document's ActiveView, published when the canvas mounts).
    const dock = app.Services.get(PanelDockService.Key)
    const agent = app.Services.get(AgentService.Key)
    if (dock !== undefined && agent !== undefined) dock.Add(agent)
    if (workspace !== undefined && dock !== undefined)
    {
        attachAutoOpenInspector(workspace.Document, dock)
    }
} catch (err) {
    console.error('[plexus] mount failed:', err)
    throw err
}
