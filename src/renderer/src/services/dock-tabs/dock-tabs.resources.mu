// dock-tabs.resources.mu — the Plexus right-dock panel switcher.
//
// Overrides the framework's DataTemplate[PanelDockService] (mural's plain
// TabControl) with a horizontal, TEXT-label navigation rail over the selected
// panel's body — a slim VSCode-style switcher rather than tabs. The rail is a
// Selector, so SelectedItem TwoWay-binds to SelectedPanel: clicking a label
// switches panels, and Add()/Close() re-select. No icons, no per-tab close;
// the selected destination carries a 2dp @Primary bottom accent (the same
// active-indicator the tab underline gave).
//
// Merged app-global by app.mu (`merge DockTabsResources`); it lives in
// Application.Resources so it shadows the framework theme's implicit
// DataTemplate[PanelDockService] (same mechanism as DocumentTabsResources).

resources DockTabsResources {

    // Horizontal, left-aligned destination row — vs the M3 rail's vertical
    // stack (@DefaultNavigationRailPanel) and the bar's even UniformGrid.
    ItemsPanelTemplate x:key="DockRailPanel" {
        StackPanel [ Orientation = Horizontal ]
    }

    // One dock destination: a text label ($Title, bound through the item's
    // DataContext — the IDockPanel) with a 2dp bottom accent that lights
    // @Primary when selected. No icon slot. Ink is @OnSurfaceVariant at rest,
    // @Primary when selected (matching the accent), @OnSurface on hover. The
    // NavigationRail wraps each panel into a NavigationItem whose DataContext is
    // the panel, so $Title resolves even though the panel also carries a
    // full-body DataTemplate (rendered below, not here).
    Template x:key="DockRailItemTemplate" [ TargetType = NavigationItem ] {
        Border x:name="PART_Outer"
            [ Fill      = #00000000,
              Stroke     = Pen [ Brush = #00000000 ],
              BorderThickness = (0,0,0,2),
              Padding         = (12,8,12,8) ] {
            TextBlock x:name="PART_Label"
                [ Style             = @TitleSmall,
                  Text              = $Title,
                  Foreground        = @OnSurfaceVariant,
                  VerticalAlignment = Center ]
        }
        when ( IsSelected ) {
            PART_Outer.Stroke = Pen [ Brush = @Primary ];
            PART_Label.Foreground  = @Primary;
        }
        when ( IsMouseOver ) { PART_Label.Foreground = @OnSurface; }
    }

    // Keyed (not implicit-by-type) so only the dock rail adopts it — ordinary
    // NavigationItems keep the M3 icon+label row.
    Style x:key="DockRailItem" [ TargetType = NavigationItem ] {
        Template = @DockRailItemTemplate;
    }

    // Horizontal text-rail chrome — the destinations row over a 1dp bottom rule
    // (the strip divider). No Header / Footer slots (the dock has none). Items
    // render left-aligned via the horizontal panel above.
    Template x:key="DockRailTemplate" [ TargetType = NavigationRail ] {
        Border x:name="PART_Border"
            [ Fill      = @Surface,
              Stroke     = Pen [ Brush = @OutlineVariant ],
              BorderThickness = (0,0,0,1) ] {
            ItemsPresenter x:name="PART_ItemsPresenter"
        }
    }

    // Keyed dock-rail Style: swaps in the horizontal template + panel. mural's
    // Style.Seal() splices the theme NavigationRail style in as this style's
    // implicit BasedOn base, so these own setters override the vertical M3
    // Template / ItemsPanel while the rest of the base is inherited.
    Style x:key="DockRail" [ TargetType = NavigationRail ] {
        Template   = @DockRailTemplate;
        ItemsPanel = @DockRailPanel;
    }

    // Right-dock host: the horizontal text rail (panel switcher) docked over the
    // selected panel's body. The body is a ContentPresenter bound through a
    // SERVICE binding ($service(...).SelectedPanel), NOT a DataContext binding
    // ($SelectedPanel): a ContentPresenter re-points its OWN DataContext to
    // whatever it presents, so a $SelectedPanel source would be clobbered after
    // the first render and never update on the next switch (see the shell
    // template's ContentHostService note). ReuseContentViews caches each panel's
    // view so switching back restores it rather than rebuilding.
    DataTemplate [ DataType = PanelDockService ] {
        DockPanel [ LastChildFill = true ] {
            NavigationRail
                [ DockPanel.Dock     = Top,
                  Style              = @DockRail,
                  ItemContainerStyle = @DockRailItem,
                  ItemsSource        = $Panels,
                  SelectedItem       = $SelectedPanel ]
            ContentPresenter
                [ Content           = $service(PanelDockService).SelectedPanel,
                  ReuseContentViews = true ]
        }
    }
}
