// document-tabs.resources.mu — the Plexus document tab strip.
//
// Overrides the framework's DataTemplate[DocumentsContentHostService] (mural's
// plain TabControl) with an ExtendedTabControl: the same tab strip + active-
// document body, PLUS an overflow dropdown pinned to the strip's top-right
// corner. The dropdown's primary action is "Close All"; its flyout lists every
// open tab (click a row to activate it, ✕ to close just that one). All actions
// resolve the root-registered document host through `$service(ContentHostService)`
// — CloseAllCommand / ActivateDocumentCommand / CloseDocumentCommand — so the
// control itself stays a pure re-template (see extended-tab-control.ts).
//
// Merged app-global by app.mu (`merge DocumentTabsResources`). Because it lives
// in Application.Resources it shadows the framework theme's implicit
// DocumentsContentHostService template (resolver walks local → app → theme).

import ExtendedTabControl from "./extended-tab-control.js"

resources DocumentTabsResources {

    // Horizontal tab strip panel (mirrors the framework's DefaultTabControlPanel).
    ItemsPanelTemplate x:key="ExtendedTabStripPanel" {
        StackPanel [ Orientation = Horizontal ]
    }

    // A left-aligned, full-width row button for the dropdown's tab entries: a
    // transparent hit surface with the standard hover/press state layers (the
    // default Button chrome centres + pads, which reads wrong for a menu row).
    Template x:key="TabMenuRowButton" [ TargetType = Button ] {
        Border x:name="PART_Row" [ Background = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (8,6,8,6) ] {
            ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Row.Background = @StateHoverOverlay; }
        when ( IsPressed ) { PART_Row.Background = @StatePressOverlay; }
    }

    // NOTE: the tab HEADER (strip) uses the framework's own
    // @DocumentTabHeaderTemplate — referenced directly by the override below, so
    // the tab close ✕ keeps its original compact chrome (@CompactHeaderIconButton).
    // We do NOT redefine it here; a local copy previously dropped that template
    // and inflated the close button.

    // One ROW in the overflow dropdown: click the title to activate that tab, ✕
    // to close it. DataContext is the document (Title / Id). The close button
    // reuses the framework's @CompactHeaderIconButton so it matches the strip's ✕.
    DataTemplate x:key="TabMenuRowTemplate" [ DataType = RailAction ] {
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

    // The ExtendedTabControl chrome: identical to the framework TabControl
    // template except the header strip is wrapped in an inner DockPanel that
    // reserves the RIGHT corner for the overflow dropdown (a ToolBarSplitButton:
    // "Close All" primary + a chevron flyout listing the open tabs). The
    // ItemsPresenter fills the remaining width so the tabs scroll under the
    // pinned dropdown.
    Template x:key="ExtendedTabControlTemplate" [ TargetType = ExtendedTabControl ] {
        Border x:name="PART_Border"
            [ Background      = @Surface,
              BorderBrush     = @OutlineVariant,
              BorderThickness = (0,0,0,1) ] {
            DockPanel [ LastChildFill = true ] {
                DockPanel [ DockPanel.Dock = Top, LastChildFill = true ] {
                    ToolBarSplitButton
                        [ DockPanel.Dock  = Right,
                          Command          = $service(ContentHostService).CloseAllCommand,
                          Content          = TextBlock [ Text = "Close all", Foreground = @OnSurfaceVariant, FontSize = 12 ],
                          ItemsSource      = $$ItemsSource,
                          ItemTemplate     = @TabMenuRowTemplate,
                          VerticalAlignment = Center,
                          Margin           = (4,2,4,2) ]
                    ItemsPresenter x:name="PART_ItemsPresenter"
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
    // Same bindings as the framework's, but the DPs are qualified with their
    // registering BASE classes (ItemsControl / Selector) rather than the bare
    // names: the .mu compiler only knows built-in control classes, so a bare
    // `ItemsSource=` on the custom ExtendedTabControl element can't resolve — the
    // `Owner.Prop` form resolves the inherited DP through the built-in owner while
    // the setter still lands on the ExtendedTabControl instance.
    DataTemplate [ DataType = DocumentsContentHostService ] {
        ExtendedTabControl
            [ ItemsControl.ItemsSource  = $OpenDocuments,
              Selector.SelectedItem     = $ActiveDocument,
              ItemsControl.ItemTemplate = @DocumentTabHeaderTemplate ]
    }
}
