// diagram.resources.mu — view resources for Plexus's diagram editor, ported
// from the Diagrammer demo (demo/demos/diagram) and distributed across the
// shell regions. Merged app-global by app.mu (`merge DiagramResources`).
//
// Holds: the icon geometries (align/distribute/group/ungroup, baked from SVG)
// and the four boolean-combine glyphs (baked from the Material Symbols font at
// compile time); the toolbar-button template the Commands region iterates; the
// draggable toolbox tile; the ToolBox capability's shapes panel; and the CANVAS
// itself — a `DataTemplate[DataType=DiagramDocument]` the content host presents
// for the active diagram document (materializing the Diagram control in-tree).

import ToolboxService from "./services/diagram-panel-services.js"
import LayoutPipelineService from "./layout/layout-pipeline-service.js"
import DropCandidateChooserService from "../architecture-projects/services/drop-candidate-chooser-service.js"
import ArchNodeVM from "../architecture-projects/services/arch-node-vm.js"

resources DiagramResources {
    // ── Icon geometries ─────────────────────────────────────────────────
    // SVG → shared Geometry at compile time (paint dropped; a Shape paints
    // each with a theme brush). @alignLeft, @group, @distributeHorizontal, …
    include "assets/icons/*.svg"

    // Boolean-combine glyphs baked from the Material Symbols font into
    // PathGeometry at COMPILE time (one per name). The font is compile-time
    // only — the baked geometry ships, not the .ttf. Venn glyphs map onto the
    // set ops: union → @join, intersect → @join_inner, subtract → @join_left,
    // exclude → @difference.
    glyphs "assets/material-symbols-outlined.ttf" {
        join
        join_inner
        join_left
        difference
        // Input-mode toolbar: Connectors mode.
        polyline
        // Text-format toolbars: paragraph alignment within the label …
        format_align_left
        format_align_center
        format_align_right
        format_align_justify
        // … and the 3×3 label-placement grid (where the label sits in the shape).
        north_west
        north
        north_east
        west
        filter_center_focus
        east
        south_west
        south
        south_east
        // Character decorations (text-style toolbar).
        format_bold
        format_italic
        format_underlined
        format_strikethrough
        // Grow / shrink font.
        text_increase
        text_decrease
    }

    // ── Canvas ItemsPanel — a paginated canvas whose measured extent grows
    // as nodes move/drop past the bounds (the enclosing ScrollViewer in the
    // Diagram's own template tracks it). ──
    ItemsPanelTemplate x:key="DiagramCanvasPanel" {
        PaginatedCanvas [ PageWidth = 800, PageHeight = 600 ]
    }

    // ── Canvas — the diagram surface, materialized in-tree ──────────────
    // The Content region presents the active DiagramDocument
    // (DocumentsContentHostService.ActiveDocument) through this template.
    // Because the Diagram is created BY the template — attached in the live
    // tree — its alignment / resize / connector-interaction adorners mount
    // against a live AdornerLayer with no detached-build re-assert hack.
    // Mutator auto-wires from the DataContext (DiagramDocument IS a
    // DiagramMutator); the control publishes itself back onto the document's
    // ActiveView (IDiagramViewHost) so the shell's Commands / Inspector regions
    // reach its editing commands + selection-format state. DropReceiver = $Self
    // (the Diagram is on every canvas drop's bubble path). Mirrors the
    // Diagrammer demo's Diagram declaration (demo/demos/diagram).
    // The content area is now JUST the canvas — the input-mode strip that used to
    // ride above it is gone: the Connectors-mode toggle moved to the shell status
    // bar (see @ConnectorModeIndicator + the module's StatusBar-region .ShellControls:
    // entry), and the font editors moved to the command bar (@FontFormatEditor).
    DataTemplate [DataType = DiagramDocument] {
        DockPanel {
            // Grid so the drop-candidate chooser overlay floats over the canvas.
            Grid {
                Diagram x:name="canvas"
                    [ ItemsSource                  = $Nodes,
                      Connectors                   = $Connectors,
                      ItemsPanel                   = @DiagramCanvasPanel,
                      SelectionMode                = Extended,
                      AllowMarqueeSelection        = true,
                      AlignmentGuidesEnabled       = true,
                      SelectionResizeEnabled       = true,
                      ConnectorInteractionsEnabled = true,
                      ReflectSelectionToItems      = true,
                      DropReceiver                 = $Self,
                      Focusable                    = true,
                      ContextMenuService.ContextMenu = @DiagramContextMenu ]
                // Ambiguous term-drop chooser: implicit DataTemplate[
                // DropCandidateChooserService] renders a hidden MenuButton whose
                // popup lists the candidates. Content is the app-scoped service.
                ContentControl [ Content = $service(DropCandidateChooserService),
                                 HorizontalAlignment = Left, VerticalAlignment = Top ]
            }
        }
    }

    // ── Font-format editor — a toolbar CONTROL (not a command) ──────────
    // Hosted in the shell command bar by the module's .ShellControls: entry.
    // The shell applies this template with the active document as DataContext, so
    // the pickers two-way bind the document's IFontFormatSink surface
    // (FontFamily / FontSize / FontColorHex), which the DiagramDocument mirrors
    // onto the live canvas selection. The size steppers bind the sink's step
    // commands. (Was the canvas-local picker row; now shared shell chrome.)
    //
    // Reached ONLY explicitly, by its key (the module's Template = @FontFormatEditor).
    // An x:key'd DataTemplate is never used for implicit type resolution
    // (findDataTemplateForType looks up the type KEY, not by DataType), so it can't
    // shadow the keyless canvas template above even though both are
    // [DataType = DiagramDocument].
    DataTemplate x:key="FontFormatEditor" [DataType = DiagramDocument] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            FontFamilyPicker [ Text = $FontFamily, Width = 170, VerticalAlignment = Center ]
            FontSizePicker   [ Value = $FontSize, IsEditable = true, Width = 80, Margin = (8,0,0,0), VerticalAlignment = Center ]
            ToolBar [ Margin = (8,0,0,0) ] {
                ToolBarButton [ Command = $IncreaseFontSizeCommand ] {
                    Shape [ Geometry = @text_increase, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
                }
                ToolBarButton [ Command = $DecreaseFontSizeCommand ] {
                    Shape [ Geometry = @text_decrease, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
                }
            }
            ColorPicker [ ColorHex = $FontColorHex, Margin = (8,0,0,0), VerticalAlignment = Center ]
        }
    }

    // ── Connector-mode indicator — a StatusBar-region toolbar CONTROL ────
    // Hosted in the shell STATUS BAR by the module's .ShellControls: entry
    // (Region = StatusBar). A tiny dot + "Connector" label that two-way binds the
    // document's ConnectorsModePinned (mirrored onto the live canvas): click to
    // pin/unpin the connectors interaction mode. Inactive → monochrome +
    // semitransparent; active → the dot turns green and the whole cell goes opaque.
    //
    // Like @FontFormatEditor: an x:key'd template reached only explicitly by key,
    // never implicitly — so it doesn't shadow the keyless canvas template.
    //
    // Chromeless ToggleButton chrome — strips the default pill so the cell reads as
    // plain status text; a transparent (#00000000) Border keeps it hit-testable.
    Template x:key="ConnectorModeToggleChrome" [TargetType = ToggleButton] {
        Border [ Background = #00000000, Padding = (6,1,6,1), CornerRadius = (4) ] {
            ContentPresenter [ VerticalAlignment = Center ]
        }
    }
    DataTemplate x:key="ConnectorModeIndicator" [DataType = DiagramDocument] {
        ToggleButton x:name="Root"
            [ Template          = @ConnectorModeToggleChrome,
              IsChecked         = $ConnectorsModePinned,
              Opacity           = 0.55,
              VerticalAlignment = Center ] {
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Border x:name="Dot"
                    [ Width             = 8,
                      Height            = 8,
                      CornerRadius      = (4),
                      Background        = @OnSurfaceVariant,
                      VerticalAlignment = Center,
                      Margin            = (0,0,6,0) ]
                TextBlock
                    [ Text              = "Connector",
                      FontSize          = 11,
                      Foreground        = @OnSurfaceVariant,
                      VerticalAlignment = Center ]
            }
        }
        // Pinned → opaque cell + green dot; reverts to the base 0.55 / mono otherwise.
        when ( $ConnectorsModePinned ) {
            Root.Opacity   = 1;
            Dot.Background = #4caf50;
        }
    }

    // ── Canvas context menu — "Format Shape" ────────────────────────────
    // Right-click the canvas → "Format Shape" adds the document's DiagramInspector
    // to the PanelDockService, opening the Format Shape tab in the shell's right
    // panel dock (reuse-by-key, so it re-surfaces the one tab). The menu's logical
    // owner is the Diagram (DataContext = DiagramDocument), so `$Inspector` resolves
    // the document's inspector and `$service(PanelDockService)` the shell-scoped
    // dock host. The tab then tracks the live selection through the inspector's
    // View handle.
    ContextMenu x:key="DiagramContextMenu" {
        // Align + distribute — bound to the live canvas's commands via the
        // document's published ActiveView. Each self-disables when fewer than two
        // shapes are selected (the Diagram command's own CanExecute), so no extra
        // gating is needed. Icons reuse the toolbar geometries baked from SVG.
        MenuItem
            [ Header  = "Align Left",
              Command = $ActiveView.AlignLeftCommand,
              Icon    = Shape [ Geometry = @alignLeft, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Center",
              Command = $ActiveView.AlignCenterCommand,
              Icon    = Shape [ Geometry = @alignCenter, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Right",
              Command = $ActiveView.AlignRightCommand,
              Icon    = Shape [ Geometry = @alignRight, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Top",
              Command = $ActiveView.AlignTopCommand,
              Icon    = Shape [ Geometry = @alignTop, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Middle",
              Command = $ActiveView.AlignMiddleCommand,
              Icon    = Shape [ Geometry = @alignMiddle, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        MenuItem
            [ Header  = "Distribute Horizontally",
              Command = $ActiveView.DistributeHorizontalCommand,
              Icon    = Shape [ Geometry = @distributeHorizontal, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Distribute Vertically",
              Command = $ActiveView.DistributeVerticalCommand,
              Icon    = Shape [ Geometry = @distributeVertical, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        MenuItem
            [ Header           = "Format Shape",
              Command          = $service(PanelDockService).AddPanelCommand,
              CommandParameter = $Inspector ]
        MenuSeparator
        // Layout — opens the layout-pipeline builder as a dock tab. The inspector
        // instance lives on LayoutPipelineService; adding it via the same
        // AddPanelCommand surfaces the builder panel.
        MenuItem
            [ Header           = "Layout…",
              Command          = $service(PanelDockService).AddPanelCommand,
              CommandParameter = $service(LayoutPipelineService).Inspector ]
    }

    // ── Toolbox ItemsPanel — a uniform-cell wrap grid so the tiles fit a
    // narrow pane. IsUniformChildren sizes every cell to the largest tile, so
    // the palette reads as an even grid regardless of per-shape label width. ─
    ItemsPanelTemplate x:key="DiagramToolboxPanel" {
        WrapPanel [ IsUniformChildren = true ]
    }

    // ── Toolbox tile — one draggable tile for every repository item (both mural
    // ShapeToolboxItems and Plexus ArchToolboxItems extend ToolboxItem, so the
    // base-type match serves both). The picture is the item's descriptor resolved
    // for the Tile context through the shared ToolboxVisualPresenter (shapes → the
    // shape figure; library/meta-model terms → the class icon, upgraded in place
    // when a lazily-compiled class arrives). Dragging emits the item id under
    // TOOLBOX_ITEM_FORMAT; dropping on the canvas routes id → repository → factory.
    // The presenter renders the figure/icon ONLY; the tile owns the caption below
    // it ($Label, wrapping), so shapes and class terms read the same and long names
    // wrap within the tile instead of clipping into the 48×48 figure. ──
    DataTemplate [DataType = ToolboxItem] {
        Border x:root
            [ IsDraggable     = true,
              OnDragStart     = $BeginDragData,
              Background      = @Surface,
              BorderBrush     = @OutlineVariant,
              BorderThickness = (1),
              CornerRadius    = 4,
              Padding         = (4,8,4,8),
              Margin          = (2,0,2,4),
              MaxWidth        = 104 ] {
            StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
                ToolboxVisualPresenter
                    [ Descriptor          = $Descriptor,
                      Context             = VisualContext.Tile,
                      Width               = @ToolboxItemWidth,
                      Height              = @ToolboxItemHeight,
                      HorizontalAlignment = Center ]
                TextBlock
                    [ Text                = $Label,
                      Style               = @BodySmall,
                      Foreground          = @OnSurfaceVariant,
                      TextWrapping        = Wrap,
                      TextAlignment       = Center,
                      HorizontalAlignment = Center,
                      Margin              = (0,4,0,0) ]
            }
        }
    }

    // ── Architecture node tile — icon + label for an ArchNodeVM dropped on an
    // architecture diagram. ToolboxVisualPresenter renders the term's icon via the
    // Figure context (same resolver path as the toolbox tile, but sized for the
    // canvas); the TextBlock shows the entity's display label below the icon.
    DataTemplate [DataType = ArchNodeVM] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
            ToolboxVisualPresenter
                [ Descriptor          = $Descriptor,
                  Context             = VisualContext.Figure,
                  Width               = 40,
                  Height              = 40,
                  HorizontalAlignment = Center ]
            TextBlock
                [ Text                = $Label,
                  Style               = @BodySmall,
                  Foreground          = @OnSurfaceVariant,
                  TextWrapping        = Wrap,
                  // Caps the tile width so a long name wraps instead of stretching
                  // the node; the container sizes the box to this wrapped tile.
                  MaxWidth            = 120,
                  TextAlignment       = Center,
                  HorizontalAlignment = Center,
                  Margin              = (0,4,0,0) ]
        }
    }

    // ── ToolBox capability panel — the shapes palette in the left pane.
    // Overrides the generic `DataTemplate [DataType = PlexusPanelService]` for the
    // ToolboxService subtype (exact-type match wins). The unified toolbox presents
    // $Pages as a single-expand ACCORDION (a built-in Shapes page plus one section
    // per visible taxonomy): each section's header two-ways the page's IsExpanded
    // and its body collapses when closed; opening one collapses the others
    // (coordinated in ToolboxService). The whole stack scrolls as one region. ──
    // The 8dp inset lives on an OUTER Border (padding), NOT as a Margin on the
    // scrolled ItemsControl. A margin on the scroll viewport's content shifts
    // that content's origin (translate(8,8)), but the ScrollContentPresenter
    // sizes its viewport clip to the full viewport and applies it on the
    // (now margin-offset) content — so the clip overshoots the viewport bottom
    // by the top margin, letting the last few dp of tiles paint over whatever
    // sits below the pane (the status bar). Keeping the inset outside the
    // ScrollViewer leaves the scrolled content at origin, so the clip aligns.
    DataTemplate [DataType = ToolboxService] {
        Border [ Padding = (8) ] {
            ScrollViewer [ IsAutoHideScrollBars = false, HorizontalScrollEnabled = false ] {
                ItemsControl [ ItemsSource = $Pages, ItemTemplate = @ToolboxAccordionItem, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    // One toolbox section: a title over the page's tiles in the uniform wrap grid.
    // v1 drops the single-expand accordion (mural's ToolboxPage carries no expand
    // state); every section is shown, and the outer ScrollViewer scrolls the whole
    // stack. Tiles dispatch by DataType through the single [DataType = ToolboxItem]
    // template above.
    DataTemplate x:key="ToolboxAccordionItem" [DataType = ToolboxPage] {
        StackPanel [ Orientation = Vertical, Margin = (0,0,0,6) ] {
            TextBlock [ Text = $Title, Style = @LabelMedium, Foreground = @OnSurfaceVariant, Margin = (0,0,0,4) ]
            ItemsControl [ ItemsSource = $Items, ItemsPanel = @DiagramToolboxPanel ]
        }
    }
}
