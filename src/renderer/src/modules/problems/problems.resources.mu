// problems.resources.mu — the Problems dock (Status-region) view.
//
// The dock is a MenuButton in the StatusBar region. Its face and its popup rows
// deliberately match the document-content-host ⋯ extended-commands dropdown
// (services/document-tabs/document-tabs.resources.mu):
//
//   * the FACE is a regular Button restyled with @ProblemsTriggerChrome — the
//     same pill @SurfaceContainerHigh surface + @OnSurfaceVariant hover/press
//     state layers as that dropdown's @TabOverflowTrigger, but hosting the
//     problem summary ($SummaryText) instead of a three-dots glyph;
//   * each popup ROW reuses @TabMenuRowButton verbatim — the same left-aligned,
//     full-width transparent hit surface the dropdown's rows use. Both keys are
//     app-global (merged by app.mu), so this cross-module reference resolves.
//
// Clicking the face opens a FLOATING popup (MenuPopupHost) that overlays the
// content above the bar rather than growing the status bar. IsOpen binds the
// service's IsOpen so a failed publish can force the popup open (Expand()).
//
// The ShellControlDefinition in problems.module.mu references @ProblemsDock.

import ProblemsService from "./problems-service.js"
import ProblemsRow from "./problems-service.js"

resources ProblemsResources {
    DataTemplate x:key="ProblemsDock" [ DataType = ProblemsService ] {
        MenuButton
            [ Header              = $SummaryText,
              IsOpen              = $IsOpen,
              Template            = @ProblemsPopup,
              TriggerTemplate     = @ProblemsDockTrigger,
              HorizontalAlignment = Left ]
    }

    // The MenuButton trigger: root PART_Trigger is a Button (MenuButton's
    // trigger contract), PART_TriggerStack + PART_HeaderText are the parts its
    // ctor keeps in sync with the Header DP. The Button wears @ProblemsTriggerChrome
    // for the dropdown-face look.
    Template x:key="ProblemsDockTrigger" [ TargetType = MenuButton ] {
        Button x:name="PART_Trigger" [ Template = @ProblemsTriggerChrome ] {
            StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal, VerticalAlignment = Center ] {
                TextBlock x:name="PART_HeaderText"
                    [ Style = @LabelMedium, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
            }
        }
    }

    // Face chrome — mirrors document-tabs' @TabOverflowTrigger (pill
    // @SurfaceContainerHigh surface, @OnSurfaceVariant state layers), sized for a
    // text summary rather than a single glyph. ContentPresenter shows the
    // trigger's PART_TriggerStack.
    Template x:key="ProblemsTriggerChrome" [ TargetType = Button ] {
        Border x:name="PART_Primary" [ Background = @SurfaceContainerHigh, CornerRadius = @ShapeFull, BorderThickness = (0) ] {
            Border x:name="PART_PrimaryState" [ Background = #00000000, CornerRadius = @ShapeFull, Padding = (10,3,10,3) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_PrimaryState.Background = @OnSurfaceVariantHoverLayer; }
        when ( IsPressed ) { PART_PrimaryState.Background = @OnSurfaceVariantPressLayer; }
        when ( IsEnabled = false ) { PART_Primary.Opacity = @DisabledContentOpacity; }
    }

    // The list's virtualizing panel — a fixed row height keeps virtualization
    // cheap (rows are single-line).
    ItemsPanelTemplate x:key="ProblemsListPanel" {
        VirtualizingStackPanel [ Orientation = Vertical, ItemHeight = 28 ]
    }

    // The popup control template. Preserves the MenuButton popup contract (root
    // MenuPopupHost = PART_PopupHost, a PART_Scrim ClickAwayScrim, a
    // PART_PopupContainer Border) and adds a header/toolbar above a height-capped,
    // virtualized ItemsControl bound to $Rows. Data bindings ($Rows, $ListMaxHeight,
    // $ShowErrors, …) resolve against the templated MenuButton's DataContext, which
    // is the ProblemsService (from the @ProblemsDock DataTemplate).
    Template x:key="ProblemsPopup" [ TargetType = MenuButton ] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim" [ BorderThickness = (0) ]
            Border x:name="PART_PopupContainer"
                [ Background = @SurfaceContainerHigh, BorderBrush = @OutlineVariant, BorderThickness = (1),
                  CornerRadius = @ShapeExtraSmall, Effect = @Elevation2, Padding = (0) ] {
                DockPanel [ LastChildFill = true, MinWidth = 340 ] {
                    // Header + toolbar (docked Top).
                    DockPanel [ DockPanel.Dock = Top, LastChildFill = true, Margin = (8,6,8,6) ] {
                        // Right cluster: copy-all + clear.
                        StackPanel [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center ] {
                            IconButton [ Template = @CompactHeaderIconButton, Command = $CopyAllCommand, Margin = (4,0,0,0) ] {
                                Shape [ Geometry = @Copy, Fill = @OnSurfaceVariant, Width = 12, Height = 12 ]
                            }
                            Button [ Command = $ClearFiltersCommand, Margin = (8,0,0,0) ] {
                                TextBlock [ Text = "Clear", Style = @LabelMedium, Foreground = @OnSurfaceVariant ]
                            }
                        }
                        // Left cluster: title + severity toggles + filter box.
                        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                            TextBlock [ Text = "Problems", Style = @LabelLarge, Foreground = @OnSurface, VerticalAlignment = Center, Margin = (0,0,12,0) ]
                            ToggleButton [ IsChecked = $ShowErrors, VerticalAlignment = Center, Margin = (0,0,6,0) ] {
                                TextBlock [ Text = $ErrorCount, Style = @LabelMedium ]
                            }
                            ToggleButton [ IsChecked = $ShowWarnings, VerticalAlignment = Center, Margin = (0,0,12,0) ] {
                                TextBlock [ Text = $WarningCount, Style = @LabelMedium ]
                            }
                            TextBox [ Text = $FilterText, Variant = Plain, MinWidth = 120, VerticalAlignment = Center ]
                        }
                    }
                    // Capped, virtualized list (fills the remainder).
                    ScrollViewer [ MaxHeight = $ListMaxHeight, HorizontalScrollEnabled = false ] {
                        ItemsControl [ ItemsSource = $Rows, ItemsPanel = @ProblemsListPanel ]
                    }
                }
            }
        }
    }

    // One row: copy button (docked right) + activate button (fills). Siblings, not
    // nested — clicking copy never triggers navigation. Project-header rows carry no
    // command, so both buttons are inert for them. The activate button reuses the
    // same @TabMenuRowButton chrome the document-host ⋯ dropdown uses.
    DataTemplate [ DataType = ProblemsRow ] {
        DockPanel [ LastChildFill = true ] {
            IconButton [ DockPanel.Dock = Right, Template = @CompactHeaderIconButton, Command = $CopyCommand, VerticalAlignment = Center, Margin = (8,0,4,0) ] {
                Shape [ Geometry = @Copy, Fill = @OnSurfaceVariant, Width = 11, Height = 11 ]
            }
            Button [ Template = @TabMenuRowButton, Command = $ActivateCommand, HorizontalAlignment = Stretch, MinWidth = 240 ] {
                DockPanel [ LastChildFill = true ] {
                    TextBlock [ DockPanel.Dock = Right, Text = $Detail, Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (12,0,0,0) ]
                    TextBlock [ Text = $Label, Foreground = @OnSurface, VerticalAlignment = Center ]
                }
            }
        }
    }
}
