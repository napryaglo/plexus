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

import ToolBoxService from "./services/diagram-panel-services.js"

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
    // to the InspectorService, opening the Format Shape panel in the shell's
    // Inspector region (reuse-by-key, so it re-surfaces the one panel). The menu's
    // logical owner is the Diagram (DataContext = DiagramDocument), so `$Inspector`
    // resolves the document's inspector and `$service(InspectorService)` the shell-
    // scoped host. The pane then tracks the live selection through the inspector's
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
              Command          = $service(InspectorService).AddInspectorCommand,
              CommandParameter = $Inspector ]
    }

    // ── Toolbox ItemsPanel — a uniform-cell wrap grid so the tiles fit a
    // narrow pane. IsUniformChildren sizes every cell to the largest tile, so
    // the palette reads as an even grid regardless of per-shape label width. ─
    ItemsPanelTemplate x:key="DiagramToolboxPanel" {
        WrapPanel [ IsUniformChildren = true ]
    }

    // ── Toolbox tile — a draggable picture + label. The picture is the
    // ToolboxShape's PreviewNode (a per-Kind Figure sized 48×48) slotted into a
    // ContentControl. Dragging emits the `mural/node-kind` payload; dropping on
    // the canvas fires the Diagram's ItemDropped → Document.CreateNode. ──
    DataTemplate [DataType = ToolboxShape] {
        Border x:root
            [ IsDraggable     = true,
              OnDragStart     = $BeginKindDragData,
              Background      = @Surface,
              BorderBrush     = @OutlineVariant,
              BorderThickness = (1),
              CornerRadius    = 4,
              Padding         = (4,8,4,8),
              Margin          = (2,0,2,4) ] {
            StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
                ContentControl
                    [ Content             = $PreviewNode,
                      Width               = 48,
                      Height              = 48,
                      HorizontalAlignment = Center ]
                TextBlock
                    [ Text                = $Label,
                      FontSize            = 10,
                      Foreground          = @OnSurface,
                      Margin              = (0,4,0,0),
                      HorizontalAlignment = Center ]
            }
        }
    }

    // ── ToolBox capability panel — the shapes palette in the left pane.
    // Overrides the generic `DataTemplate [DataType = PlexusPanelService]` for
    // the ToolBoxService subtype (exact-type match wins), rendering the live
    // $Shapes through the toolbox tile. ──
    DataTemplate [DataType = ToolBoxService] {
        Border [ Padding = (8) ] {
            // No explicit Width — the shell's side pane now has a definite Width and
            // a Star content column (see @PlexusSideContentPane), so this content
            // measures against the pane width and the WrapPanel wraps to it.
            DockPanel {
                TextBlock
                    [ DockPanel.Dock = Top,
                      Text           = "Shapes",
                      Style          = @LabelMedium,
                      Foreground     = @OnSurfaceVariant,
                      Margin         = (2,0,0,8) ]
                // HorizontalScrollEnabled = false so the ScrollViewer measures
                // its content at the viewport width instead of +Infinity —
                // otherwise the WrapPanel gets unbounded width and never wraps
                // (overflow becomes horizontal scroll). The palette only scrolls
                // vertically.
                ScrollViewer [ IsAutoHideScrollBars = false, HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Shapes, ItemsPanel = @DiagramToolboxPanel ]
                }
            }
        }
    }
}
