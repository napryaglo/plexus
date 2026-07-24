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
            [ Header          = $SummaryText,
              IsOpen          = $IsOpen,
              ItemsSource     = $Rows,
              TriggerTemplate = @ProblemsDockTrigger,
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

    // One popup row: the SAME @TabMenuRowButton chrome the document-host ⋯
    // dropdown uses — a full-width, left-aligned transparent hit surface with the
    // standard hover/press state layers. Diagnostic rows navigate to their file +
    // span via ActivateCommand (project-level rows carry no command → inert). The
    // message sits left, the file location ($Detail) right.
    DataTemplate [ DataType = ProblemsRow ] {
        Button [ Template = @TabMenuRowButton, Command = $ActivateCommand, HorizontalAlignment = Stretch, MinWidth = 260 ] {
            DockPanel [ LastChildFill = true ] {
                TextBlock [ DockPanel.Dock = Right, Text = $Detail, Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (12,0,0,0) ]
                TextBlock [ Text = $Label, Foreground = @OnSurface, VerticalAlignment = Center ]
            }
        }
    }
}
