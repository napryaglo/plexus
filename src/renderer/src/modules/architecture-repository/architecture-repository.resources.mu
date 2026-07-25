// architecture-repository.resources.mu — view resources for the `.archdiagram`
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
import ArchTermsPaletteService from "./services/arch-terms-palette-service.js"
import TermTile from "./services/arch-terms-palette-service.js"

resources ArchitectureRepositoryResources {

    // ── Node container placement: bind each node Figure to its vm's position ──
    Style x:key="ArchNodeContainerStyle" [ TargetType = Figure ] {
        Left = $Left;
        Top  = $Top;
    }

    // ── The .archdiagram editor: palette rail + concept-aware canvas ──────
    DataTemplate [ DataType = ArchDiagramDocument ] {
        DockPanel {
            ContentControl [ DockPanel.Dock = Left, Content = $Palette, Width = 190 ]
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

    // ── The term palette (rendered where the editor hosts $Palette) ───────
    DataTemplate [ DataType = ArchTermsPaletteService ] {
        Border [ Padding = (8), Background = @SurfaceContainer ] {
            DockPanel {
                TextBlock [ DockPanel.Dock = Top, Text = "Library Terms", Style = @LabelMedium,
                            Foreground = @OnSurfaceVariant, Margin = (2,0,0,8) ]
                TextBlock [ DockPanel.Dock = Top, Style = @BodyMedium, Text = "No published libraries yet.",
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                            Visibility = $IsEmpty << ToVisibility ]
                ScrollViewer [ HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Terms, ItemsPanel = @VerticalStackPanel ]
                }
            }
        }
    }

    // ── One draggable palette tile ────────────────────────────────────────
    DataTemplate [ DataType = TermTile ] {
        Border [ IsDraggable     = true,
                 OnDragStart     = $BeginKindDragData,
                 Background      = @Surface,
                 BorderBrush     = @OutlineVariant,
                 BorderThickness = (1),
                 CornerRadius    = 4,
                 Padding         = (8,6,8,6),
                 Margin          = (0,0,0,4) ] {
            TextBlock [ Text = $Display, FontSize = 12, Foreground = @OnSurface ]
        }
    }
}
