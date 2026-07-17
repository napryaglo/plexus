// View resources for the Agent capability. DataTemplate[AgentService] renders
// the transcript (an ItemsControl over $Transcript) above an input row (a
// TextBox bound to $Draft + a Send button bound to $SendCommand). Item templates
// render each transcript Model by DataType. Merged app-global by app.mu.
// Render-through-templates rule: all chat chrome lives here, none in TS.

import AgentService from "./services/agent-service.js"
import UserMessage from "./services/transcript.js"
import AssistantMessage from "./services/transcript.js"
import ToolActivity from "./services/transcript.js"

resources AgentChatResources {
    DataTemplate [ DataType = AgentService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            resources: {
                // Enter-to-send. The single-line TextBox leaves Return unhandled,
                // so KeyDown bubbles to the input-row DockPanel (a descendant this
                // implicit style matches). The EventTrigger invokes SubmitCommand,
                // which sends only on Return and clears $Draft. A Style is the only
                // place `on <Event>` is allowed; DockPanel has no default style to
                // clobber and its local Dock/Margin attrs win over the (setter-less)
                // style.
                Style [ TargetType = DockPanel ] {
                    on KeyDown { InvokeCommand [ Command = $SubmitCommand ] }
                }
            }
            // Input row pinned to the bottom.
            DockPanel [ DockPanel.Dock = Bottom, LastChildFill = true, Margin = (0,8,0,0) ] {
                Button  [ DockPanel.Dock = Right, Variant = Filled, Command = $SendCommand, Margin = (8,0,0,0) ] {
                    TextBlock [ Text = "Send" ]
                }
                TextBox [ Text = $Draft ]
            }
            // Scrolling transcript fills the rest.
            ScrollViewer [ HorizontalScrollEnabled = false ] {
                ItemsControl [ ItemsSource = $Transcript, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    DataTemplate [ DataType = UserMessage ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 8,
                 Padding = (10,6,10,6), Margin = (40,3,0,3) ] {
            TextBlock [ Style = @BodyMedium, Text = $Text, Foreground = @OnSurface, TextWrapping = Wrap ]
        }
    }

    DataTemplate [ DataType = AssistantMessage ] {
        Border [ Padding = (10,6,10,6), Margin = (0,3,40,3) ] {
            TextBlock [ Style = @BodyMedium, Text = $Text, Foreground = @OnSurface, TextWrapping = Wrap ]
        }
    }

    DataTemplate [ DataType = ToolActivity ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            TextBlock [ DockPanel.Dock = Right, Style = @BodySmall, Text = $Status, Foreground = @OnSurfaceVariant, Margin = (8,0,0,0) ]
            TextBlock [ Style = @BodySmall, Text = $Name, Foreground = @OnSurfaceVariant ]
        }
    }
}
