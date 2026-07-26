// project-explorer.resources.mu — the Project Explorer's left-panel view.
//
// Renders the generic ProjectExplorerService: a small command bar (Open / New
// project, Save), a status line, and the OPEN PROJECTS — each an OpenProject
// root (a header row carrying a right-click context menu of project-specific
// actions: New File / Publish / Close) over its file tree. A node's row binds
// its OpenCommand; the recursive DataTemplate[ProjectNode] gives arbitrary-depth
// folders.

import ProjectExplorerService from "./services/project-explorer-service.js"
import OpenProject from "../../services/projects/open-project.js"
import ProjectNode from "../../services/projects/project.js"
import KindToGeometry from "../../services/projects/project-node-icon.js"
import ExpandedToChevron from "../../services/projects/project-node-icon.js"
import EditingToLabelVisibility from "../../services/projects/project-node-icon.js"
import NewProjectDialogModel from "../../services/projects/new-project-dialog-model.js"
import ProjectTypeChoice from "../../services/projects/new-project-dialog-model.js"
import LibraryChoice from "../../services/projects/new-project-dialog-model.js"
import OpenProjectDialogModel from "../../services/projects/open-project-dialog-model.js"
import RecentProjectItem from "../../services/projects/open-project-dialog-model.js"
import ConfirmDialogModel from "../../services/dialogs/confirm-dialog-model.js"
import TreeSelectionBehavior from "../../services/projects/tree-selection-behavior.js"
import TreeDragDropBehavior from "../../services/projects/tree-drag-drop-behavior.js"

resources ProjectExplorerResources {

    // The project-specific actions — a shared context menu opened on a project's
    // header row. Its Command bindings resolve against that row's OpenProject.
    ContextMenu x:key="ProjectContextMenu" {
        MenuItem
            [ Header = "New File",
              Command = $NewFileCommand,
              Icon = Shape [ Geometry = @NoteAdd, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "New Folder",
              Command = $NewFolderCommand,
              Icon = Shape [ Geometry = @NewFolder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Add Existing Files…",
              Command = $AddFileCommand,
              Icon = Shape [ Geometry = @UploadFile, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Publish",
              Command = $PublishCommand,
              Icon = Shape [ Geometry = @Publish, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem [ Header = "Refresh Bases", Command = $RefreshBasesCommand ]
        MenuSeparator
        MenuItem [ Header = "Close Project", Command = $CloseCommand ]
    }

    // Per-node right-click menu: create a file / subfolder in the node's
    // containing folder (the host wires each so a folder node creates inside
    // itself, a file node beside itself). Commands resolve against the row's
    // ProjectNode DataContext.
    ContextMenu x:key="NodeContextMenu" {
        MenuItem
            [ Header = "New File",
              Command = $NewFileCommand,
              Icon = Shape [ Geometry = @NoteAdd, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "New Folder",
              Command = $NewFolderCommand,
              Icon = Shape [ Geometry = @NewFolder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        MenuItem [ Header = "Rename", Command = $BeginRenameCommand ]
        MenuItem [ Header = "Delete", Command = $DeleteCommand ]
    }

    // Keyed Style carrying only a KeyDown trigger. Applied to the plain Border
    // that wraps a project's TreeView (Borders have no default style to clobber,
    // unlike the TreeView itself): a focused row's F2 / Enter / Escape bubbles up
    // to this ancestor, where TreeKeyCommand drives rename begin / commit / cancel.
    Style x:key="TreeKeyStyle" [ TargetType = Border ] {
        on KeyDown { InvokeCommand [ Command = $TreeKeyCommand ] }
    }

    // The empty "off" state for a row's rename slot. Explicit (rather than an
    // unset ContentTemplate) so the ContentControl never falls back to
    // type-resolving its ProjectNode Content — which would re-stamp the row
    // template into itself. A zero-size element: nothing rendered, ~1 node.
    DataTemplate x:key="EmptyRenameTemplate" [ DataType = ProjectNode ] {
        Border [ Width = 0, Height = 0 ]
    }

    // The in-place rename editor, stamped ONLY while a node is being renamed
    // (the ProjectNodeTemplate's trigger swaps it in). FocusOnVisibleBehavior
    // focuses + selects the Plain TextBox on attach (it's already visible when
    // stamped), so lazy materialisation keeps the F2-to-type flow.
    DataTemplate x:key="RenameEditorTemplate" [ DataType = ProjectNode ] {
        Border {
            .Behaviors: { FocusOnVisibleBehavior }
            TextBox [ Text = $EditingName, Variant = Plain, MinWidth = 80, VerticalAlignment = Center ]
        }
    }

    // One tree row: a per-kind leading icon (Kind → geometry via KindToGeometry)
    // and the node's name, in a transparent Border that carries the row's
    // right-click NodeContextMenu. `itemsselector = Children` recurses the
    // template down the tree; the framework's default TreeView chrome supplies
    // the chevrons, indent guides, full-row hover, and selection.
    //
    // The rename editor is NOT instantiated per row. It lives behind
    // PART_RenameSlot, a ContentControl whose ContentTemplate is the empty
    // template until a `when(IsEditing)` trigger swaps in the real editor — so
    // the heavy Plain TextBox (its own template + caret-blink timer + input
    // listeners) is materialised only for the single node actually being
    // renamed, not once for every file/folder in the tree.
    HierarchicalDataTemplate x:key="ProjectNodeTemplate"
        [ DataType = ProjectNode, itemsselector = Children ] {
        Border x:root [ Background = #00000000, ContextMenuService.ContextMenu = @NodeContextMenu ] {
            .Behaviors: { TreeDragDropBehavior }
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Shape [ Geometry = $Kind << KindToGeometry, Fill = @OnSurfaceVariant,
                        Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
                // Static label — hidden while the row is in rename mode.
                TextBlock [ Text = $Name, Style = @BodyMedium, VerticalAlignment = Center,
                            Visibility = $IsEditing << EditingToLabelVisibility ]
                // Lazy rename slot — empty until this row enters edit mode. A
                // ContentPresenter (not ContentControl) so ContentTemplate is a
                // real DP the trigger can swap; the explicit empty template keeps
                // it from type-resolving its ProjectNode Content into the row.
                ContentPresenter x:name="PART_RenameSlot"
                    [ Content = $Data, ContentTemplate = @EmptyRenameTemplate, VerticalAlignment = Center ]
            }
        }
        when ( IsEditing = true ) { PART_RenameSlot.ContentTemplate = @RenameEditorTemplate; }
    }

    // Chrome-less host for the header's expand/collapse toggle: no PART_Border /
    // state-layer, so there's no hover or press chrome — the chevron glyph is the
    // only state indicator. The transparent padded Border just gives a hit area.
    Template x:key="ChevronToggle" [ TargetType = ToggleButton ] {
        Border [ Background = #00000000, Padding = (2,2,2,2) ] {
            ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
        }
    }

    // One open project: a header row (chevron toggle + name + right-click context
    // menu) over its file tree. The tree binds declaratively — ItemsSource walks
    // the project's node tree, ItemTemplate renders each node, and SelectedDataItem
    // pushes the clicked node to OpenProject.SelectedNode (which opens it). A New
    // File re-scans Root, and the ItemsSource binding re-projects automatically.
    DataTemplate [ DataType = OpenProject ] {
        StackPanel [ Orientation = Vertical, Margin = (0,0,0,6) ] {
            // Collapsible project header. The transparent Border makes the whole
            // header a right-click target for the project context menu; the
            // chevron ToggleButton two-ways IsChecked ⇄ IsExpanded, so its glyph
            // (down/right) is the sole collapse affordance and the tree's
            // Visibility folds with it — no button chrome anywhere.
            Border [ Background = #00000000, HorizontalAlignment = Stretch, Margin = (0,2,0,2),
                     ContextMenuService.ContextMenu = @ProjectContextMenu ] {
                .Behaviors: { TreeDragDropBehavior }
                DockPanel [ LastChildFill = true ] {
                    ToggleButton [ DockPanel.Dock = Left, Template = @ChevronToggle,
                                   IsChecked = $IsExpanded, Margin = (0,0,4,0) ] {
                        Shape [ Geometry = $IsExpanded << ExpandedToChevron, Fill = @OnSurfaceVariant,
                                Width = 12, Height = 12, VerticalAlignment = Center ]
                    }
                    TextBlock [ Style = @LabelLarge, Text = $Name, Foreground = @OnSurfaceVariant,
                                VerticalAlignment = Center ]
                }
            }
            Border [ Style = @TreeKeyStyle, Visibility = $IsExpanded << ToVisibility ] {
                TreeView [ Indent = 14, ItemsSource = $Root.Children, ItemTemplate = @ProjectNodeTemplate,
                           SelectedDataItem = $SelectedNode, SelectionMode = Extended,
                           AllowMarqueeSelection = true ] {
                    .Behaviors: { TreeSelectionBehavior }
                }
            }
        }
    }

    DataTemplate [ DataType = ProjectExplorerService ] {
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            StackPanel [ Orientation = Vertical, Margin = (8,8,8,8) ] {

                StackPanel [ Orientation = Horizontal, Margin = (0,0,0,8) ] {
                    PanelButton [ Margin = (0,0,4,0), Command = $OpenProjectCommand ] {
                        Shape [ Geometry = @Folder, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                    PanelButton [ Margin = (0,0,4,0), Command = $NewProjectCommand ] {
                        Shape [ Geometry = @NewFolder, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                    PanelButton [ Command = $SaveActiveCommand ] {
                        Shape [ Geometry = @Save, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                }

                TextBlock [ Style = @BodySmall, Text = $Status, Foreground = @OnSurfaceVariant,
                            TextWrapping = Wrap, Margin = (0,0,0,8) ]

                ItemsControl [ ItemsSource = $OpenProjects, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    // ── New Project dialog ───────────────────────────────────────────────
    // One project-type choice: a full row (always shown, even for a single
    // factory). The leading marker (● / ○) is the VM-toggled selection glyph.
    DataTemplate [ DataType = ProjectTypeChoice ] {
        Button [ Template = @ListRowButton, Command = $SelectCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            DockPanel [ LastChildFill = true ] {
                TextBlock [ DockPanel.Dock = Left, Text = $Marker, Foreground = @Primary,
                            Margin = (0,0,10,0), VerticalAlignment = Top ]
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = $Title, Foreground = @OnSurface ]
                    TextBlock [ Style = @BodySmall, Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
                }
            }
        }
    }

    // The dialog body (DialogService supplies the surface, title, and padding).
    // HorizontalAlignment = Stretch so the panel fills the dialog width — a bare
    // StackPanel shrinks to its widest child and the content presenter pins it
    // to one side (leaving Name/Location collapsed).

    // One library row in the architecture picker's checklist: a Switch two-waying
    // LibraryChoice.IsSelected + its `id @ version` label.
    DataTemplate [ DataType = LibraryChoice ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            Switch [ DockPanel.Dock = Left, IsChecked = $IsSelected, Margin = (0,0,8,0) ]
            TextBlock [ Text = $Label, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center ]
        }
    }

    DataTemplate [ DataType = NewProjectDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = "Project type", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 6,
                     Padding = (4,4,4,4), Margin = (0,0,0,14) ] {
                ItemsControl [ ItemsSource = $Types, ItemsPanel = @VerticalStackPanel ]
            }

            TextBlock [ Style = @BodyLarge, Text = "Name", Foreground = @OnSurface ]
            TextBox [ Text = $Name, Margin = (0,4,0,14) ]

            TextBlock [ Style = @BodyLarge, Text = "Location", Foreground = @OnSurface ]
            DockPanel [ LastChildFill = true, Margin = (0,4,0,8) ] {
                Button [ DockPanel.Dock = Right, Variant = Outlined, Command = $BrowseCommand, Margin = (8,0,0,0) ] {
                    TextBlock [ Text = "Browse…" ]
                }
                TextBox [ Text = $Location ]
            }

            // Meta-model picker — shown only for a project type that requires a
            // base meta-model (library today, architecture later). The combo lists
            // the published meta-models as `id @ version` (MetaModelChoice.Label).
            Border [ Visibility = $ShowMetaModelPicker << ToVisibility, Margin = (0,4,0,8) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = "Meta-model", Foreground = @OnSurface ]
                    ComboBox [ ItemsSource = $MetaModels, SelectedItem = $SelectedMetaModel,
                               Margin = (0,4,0,0), HorizontalAlignment = Stretch ]
                }
            }

            // Libraries picker — shown only for a project type that offers
            // libraries (architecture). A checklist of published libraries; each
            // row's Switch two-ways LibraryChoice.IsSelected. Zero selected is valid.
            Border [ Visibility = $ShowLibrariesPicker << ToVisibility, Margin = (0,4,0,8) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = "Libraries", Foreground = @OnSurface ]
                    ItemsControl [ ItemsSource = $Libraries, ItemsPanel = @VerticalStackPanel, Margin = (0,4,0,0) ]
                }
            }

            TextBlock [ Style = @BodySmall, Text = $Error, Foreground = @Error, TextWrapping = Wrap, Margin = (0,0,0,10) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Create" ] }
            }
        }
    }

    // ── Confirm dialog ───────────────────────────────────────────────────
    // A reusable message + Cancel / confirm pair (DialogService supplies the
    // title/surface). The confirm button's label comes from the VM so it reads
    // as the action ("Delete"); it's Filled to sit as the primary affordance.
    DataTemplate [ DataType = ConfirmDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = $Message, Foreground = @OnSurface, TextWrapping = Wrap, Margin = (0,0,0,16) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand ] { TextBlock [ Text = $ConfirmLabel ] }
            }
        }
    }

    // ── Open Project dialog ──────────────────────────────────────────────
    // Left-aligned clickable list row. The M3 Text-button template centers its
    // content and pads it, so a row reads as indented by however much shorter it
    // is than the widest one. This template stretches the content full-width and
    // left-aligns it, keeping a subtle hover/press state layer for the click.
    Template x:key="ListRowButton" [ TargetType = Button ] {
        Border x:name="PART_Row" [ Background = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (8,6,8,6) ] {
            ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Row.Background = @StateHoverOverlay; }
        when ( IsPressed ) { PART_Row.Background = @StatePressOverlay; }
    }

    // One recent-projects row: click to open (OpenCommand closes with its path).
    DataTemplate [ DataType = RecentProjectItem ] {
        Button [ Template = @ListRowButton, Command = $OpenCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @BodyLarge, Text = $Name, Foreground = @OnSurface ]
                TextBlock [ Style = @BodySmall, Text = $Path, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = OpenProjectDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = "Recent", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            ItemsControl [ ItemsSource = $Recents, ItemsPanel = @VerticalStackPanel ]
            TextBlock [ Style = @BodySmall, Text = $EmptyLabel, Foreground = @OnSurfaceVariant, Margin = (0,2,0,0) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Outlined, Command = $BrowseCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Browse…" ] }
                Button [ Variant = Text, Command = $CancelCommand ] { TextBlock [ Text = "Cancel" ] }
            }
        }
    }
}
