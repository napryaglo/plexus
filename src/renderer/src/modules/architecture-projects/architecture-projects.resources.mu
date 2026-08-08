// architecture-projects.resources.mu — view resources for the `.archdiagram`
// editor + its term palette. Merged app-global by app.mu.
//
// The editor (DataTemplate[ArchDiagramDocument]) is a term-palette rail beside a
// base Diagram whose DataContext is the document — which IS a DiagramMutator, so
// the Diagram auto-wires it (drop -> CreateNode, connect -> CreateConnector,
// delete -> DeleteNodes) with no Diagram subclass (a subclass can't be a `.mu`
// element). Each node (InstanceNodeVM) is wrapped by the Diagram in a Figure whose
// Content is the vm; the Figure resolves DataTemplate[InstanceNodeVM] by type, which
// presents the vm through the shared ToolboxVisualPresenter (Figure context) — the
// presenter resolves the vm's Descriptor and upgrades lazily-compiled class visuals
// in place. The ItemContainerStyle binds each node Figure's Left/Top to the vm's, so
// saved positions place the nodes. Palette tiles live in the global Toolbox; drop
// routes the item id through the repository to the ArchInstanceDropFactory.

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

    // ── One node: present the vm's figure through the shared ToolboxVisualPresenter
    // (Figure context) with the node's caption ($Display, wrapping) beneath it. The
    // presenter renders the figure/icon ONLY and upgrades in place when a
    // lazily-compiled class arrives; the node — not the visual — owns the label, so
    // nothing double-labels. ──
    DataTemplate [ DataType = InstanceNodeVM ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
            ToolboxVisualPresenter [ Descriptor = $Descriptor, Context = VisualContext.Figure ]
            TextBlock
                [ Text                = $Display,
                  Style               = @BodySmall,
                  Foreground          = @OnSurface,
                  TextWrapping        = Wrap,
                  TextAlignment       = Center,
                  HorizontalAlignment = Center,
                  Margin              = (0,4,0,0) ]
        }
    }
}
