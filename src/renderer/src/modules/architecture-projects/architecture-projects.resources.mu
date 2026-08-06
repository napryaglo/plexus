// architecture-projects.resources.mu — view resources for the `.archdiagram`
// editor + its term palette. Merged app-global by app.mu.
//
// The editor (DataTemplate[ArchDiagramDocument]) is a term-palette rail beside a
// base Diagram whose DataContext is the document — which IS a DiagramMutator, so
// the Diagram auto-wires it (drop -> CreateNode, connect -> CreateConnector,
// delete -> DeleteNodes) with no Diagram subclass (a subclass can't be a `.mu`
// element). Each node (InstanceNodeVM) is wrapped by the Diagram in a Figure whose
// Content is the vm; the Figure's ContentPresenter resolves DataTemplate[InstanceNodeVM]
// by type, which presents the vm THROUGH its per-term library template (mirrors
// library ClassRow). The ItemContainerStyle binds each node Figure's Left/Top to the
// vm's, so saved positions place the nodes. Palette tiles (TermTile) are draggable
// Borders emitting the term id under the canvas-drop format (BeginKindDragData).

import ArchDiagramDocument from "./services/arch-diagram-document.js"
import InstanceNodeVM from "./services/instance-node-vm.js"

resources ArchitectureProjectsResources {

    // ── Node container placement: bind each node Figure to its vm's position ──
    Style x:key="ArchNodeContainerStyle" [ TargetType = Figure ] {
        Left = $Left;
        Top  = $Top;
    }

    // ── The .archdiagram editor: concept-aware canvas. The palette is the
    // global Toolbox (ToolboxService) now, not an embedded rail. ───────────
    DataTemplate [ DataType = ArchDiagramDocument ] {
        DockPanel {
            Diagram x:name="canvas"
                [ ItemsSource                  = $Nodes,
                  Connectors                   = $Connectors,
                  ItemsPanel                   = @DiagramCanvasPanel,
                  ItemContainerStyle           = @ArchNodeContainerStyle,
                  SelectionMode                = Extended,
                  AllowMarqueeSelection        = true,
                  ConnectorInteractionsEnabled = true,
                  ReflectSelectionToItems      = true,
                  DropReceiver                 = $Self,
                  Focusable                    = true ]
        }
    }

    // ── One node: present the vm through its resolved per-term template ───
    // $Data is the vm itself; $Template is its referenced term's DataTemplate
    // (LibraryRegistry-resolved by the document). Default is a labelled box.
    DataTemplate [ DataType = InstanceNodeVM ] {
        ContentPresenter [ Content = $Data, ContentTemplate = $Template ]
    }
}
