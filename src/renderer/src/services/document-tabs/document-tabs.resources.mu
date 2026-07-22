// document-tabs.resources.mu — the Plexus document tab strip.
//
// Overrides the framework's DataTemplate[DocumentsContentHostService] (mural's
// plain TabControl) with an ExtendedTabControl. Beyond the tabs + active-document
// body, the strip's top-right corner carries an ACTION AREA:
//
//   [ module command buttons … ]  [ ⋯ ]
//
//   * the command buttons are the host's ExtendedCommands — every module command
//     tagged Region = ShellRegion.EditorActions, dispatched to the active document
//     (rendered by the framework's implicit DataTemplate[CommandViewModel]);
//   * the ⋯ split button carries NO primary command — clicking it opens a menu of
//     the host's TabMenu rows: a "Close All" action, a separator, then one row per
//     open document (click the title to activate, ✕ to close).
//
// The tabs live in a ScrollViewer (Grid column 0) so a long tab set scrolls
// rather than spilling under the action area (Grid column 1). Host actions resolve
// the root-registered document host via `$service(ContentHostService)`.
//
// Merged app-global by app.mu (`merge DocumentTabsResources`); it lives in
// Application.Resources so it shadows the framework theme's implicit
// DocumentsContentHostService template.

import ExtendedTabControl from "./extended-tab-control.js"
import TabMenuAction from "@pragmatic-lab/mural/framework"
import TabMenuSeparator from "@pragmatic-lab/mural/framework"
import TabMenuDocument from "@pragmatic-lab/mural/framework"

resources DocumentTabsResources {

    // Horizontal tab strip panel (mirrors the framework's DefaultTabControlPanel).
    ItemsPanelTemplate x:key="ExtendedTabStripPanel" {
        StackPanel [ Orientation = Horizontal ]
    }

    // A left-aligned, full-width row button for the dropdown's rows: a transparent
    // hit surface with the standard hover/press state layers (the default Button
    // chrome centres + pads, which reads wrong for a menu row).
    Template x:key="TabMenuRowButton" [ TargetType = Button ] {
        Border x:name="PART_Row" [ Background = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (8,6,8,6) ] {
            ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Row.Background = @StateHoverOverlay; }
        when ( IsPressed ) { PART_Row.Background = @StatePressOverlay; }
    }

    // ── ⋯ dropdown flyout rows (host TabMenu, resolved by implicit type) ────────
    // A one-shot action row (today "Close All") — fires its own carried command.
    DataTemplate [ DataType = TabMenuAction ] {
        Button [ Template = @TabMenuRowButton, Command = $Command, HorizontalAlignment = Stretch, MinWidth = 200 ] {
            TextBlock [ Text = $Label, Foreground = @OnSurface, VerticalAlignment = Center ]
        }
    }

    // The rule between the action block and the document list.
    DataTemplate [ DataType = TabMenuSeparator ] {
        Border [ Height = 1, Background = @OutlineVariant, Margin = (6,4,6,4) ]
    }

    // One open-document row: click the title to activate that tab, ✕ to close it.
    DataTemplate [ DataType = TabMenuDocument ] {
        DockPanel [ LastChildFill = true, MinWidth = 200, Margin = (0,1,0,1) ] {
            IconButton
                [ DockPanel.Dock  = Right,
                  Template         = @CompactHeaderIconButton,
                  Command          = $service(ContentHostService).CloseDocumentCommand,
                  CommandParameter = $Id,
                  VerticalAlignment = Center,
                  Margin           = (4,0,0,0) ] {
                Shape [ Geometry = @IconClose, Fill = @OnSurfaceVariant, Width = 10, Height = 10 ]
            }
            Button
                [ Template          = @TabMenuRowButton,
                  Command           = $service(ContentHostService).ActivateDocumentCommand,
                  CommandParameter  = $Id,
                  HorizontalAlignment = Stretch ] {
                TextBlock [ Text = $Title, Foreground = @OnSurface, VerticalAlignment = Center ]
            }
        }
    }

    // The ExtendedTabControl chrome: the framework TabControl template with the
    // header strip split into a Grid — the tabs scroll in column 0 (so they never
    // spill under the actions), and the action area (module command buttons + the
    // ⋯ overflow dropdown) pins to column 1. The content presenter is unchanged.
    Template x:key="ExtendedTabControlTemplate" [ TargetType = ExtendedTabControl ] {
        Border x:name="PART_Border"
            [ Background      = @Surface,
              BorderBrush     = @OutlineVariant,
              BorderThickness = (0,0,0,1) ] {
            DockPanel [ LastChildFill = true ] {
                Grid [ DockPanel.Dock = Top ] {
                    // The header row hugs the tab height (Auto). Without an
                    // explicit RowDefinition the Grid falls back to a single
                    // Star row, which — measured with the DockPanel's finite
                    // remaining height — greedily fills the whole pane and
                    // centres the tabs vertically.
                    RowDefinitions {
                        RowDefinition [ Height = GridLength.Auto ]
                    }
                    ColumnDefinitions {
                        ColumnDefinition [ Width = GridLength.Star ]
                        ColumnDefinition [ Width = GridLength.Auto ]
                    }
                    // Tabs — scroll horizontally so a long set never overlaps the actions.
                    ScrollViewer [ Grid.Column = 0, VerticalScrollEnabled = false ] {
                        ItemsPresenter x:name="PART_ItemsPresenter"
                    }
                    // Action area: module command buttons + the ⋯ overflow dropdown.
                    StackPanel [ Grid.Column = 1, Orientation = Horizontal, VerticalAlignment = Center, Margin = (4,0,2,0) ] {
                        ItemsControl
                            [ ItemsSource = $service(ContentHostService).ExtendedCommands,
                              ItemsPanel  = @ExtendedTabStripPanel,
                              VerticalAlignment = Center ]
                        // No Command + no TriggerTemplate → mural's default
                        // dropdown trigger: the whole button is one hit region
                        // that opens the popup, faced with a centred three-dots
                        // (more_horiz) glyph. The popup renders the host's
                        // TabMenu rows via the by-type DataTemplates above.
                        ToolBarSplitButton
                            [ ItemsSource      = $service(ContentHostService).TabMenu,
                              VerticalAlignment = Center ]
                    }
                }
                ContentPresenter x:name="PART_ContentSlot"
                    [ Content = $$SelectedContent, ReuseContentViews = true ]
            }
        }
    }

    Style [ TargetType = ExtendedTabControl ] {
        Template   = @ExtendedTabControlTemplate;
        ItemsPanel = @ExtendedTabStripPanel;
    }

    // Override the framework's document-host template to use the ExtendedTabControl.
    // The inherited DPs are qualified with their registering BASE classes
    // (ItemsControl / Selector) because the .mu compiler only resolves DPs on
    // built-in control classes, not host subclasses — the setter still lands on the
    // ExtendedTabControl instance. The tab HEADER reuses the framework's own
    // @DocumentTabHeaderTemplate (compact title + close ✕).
    DataTemplate [ DataType = DocumentsContentHostService ] {
        ExtendedTabControl
            [ ItemsControl.ItemsSource  = $OpenDocuments,
              Selector.SelectedItem     = $ActiveDocument,
              ItemsControl.ItemTemplate = @DocumentTabHeaderTemplate ]
    }
}
