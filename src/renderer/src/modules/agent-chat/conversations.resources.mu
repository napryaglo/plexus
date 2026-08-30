// The Conversations navigation panel: a New-conversation button, the live (Open)
// conversations, and the stored (restorable) ones. Rendered in the left side pane
// by DataTemplate[ChatSessionsService] (named by the module's Capability
// ServiceKey). Row templates are x:key'd (not implicit) so they don't shadow the
// implicit DataTemplate[ChatSession] that renders the full chat panel in the dock.

import ChatSessionsService from "./services/chat-sessions-service.js"
import ChatSession from "./services/chat-session.js"
import StoredConversationRow from "./services/stored-conversation-row.js"

resources ConversationsResources {
    DataTemplate [ DataType = ChatSessionsService ] {
        DockPanel [ LastChildFill = true, Margin = (8,8,8,8) ] {
            // New conversation — pinned to the top.
            PanelButton [ DockPanel.Dock = Top, Command = $NewConversationCommand, HorizontalAlignment = Stretch, Margin = (0,0,0,8) ] {
                TextBlock [ Text = "＋ New conversation", Style = @LabelLarge, Foreground = @OnSurface, TextWrapping = Wrap ]
            }
            ScrollViewer [ HorizontalScrollEnabled = false ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @LabelSmall, Text = "OPEN", Foreground = @OnSurfaceVariant, Margin = (0,0,0,4), TextWrapping = Wrap ]
                    ItemsControl [ ItemsSource = $Open, ItemsPanel = @VerticalStackPanel, ItemTemplate = @OpenConversationRow ]
                    TextBlock [ Style = @LabelSmall, Text = "STORED", Foreground = @OnSurfaceVariant, Margin = (0,10,0,4), TextWrapping = Wrap ]
                    ItemsControl [ ItemsSource = $Stored, ItemsPanel = @VerticalStackPanel, ItemTemplate = @StoredConversationRow ]
                }
            }
        }
    }

    // One live conversation — its title. The dock tab strip handles activation.
    DataTemplate x:key="OpenConversationRow" [ DataType = ChatSession ] {
        TextBlock [ Text = $Title, Style = @BodyMedium, Foreground = @OnSurface, Margin = (0,2,0,2), TextWrapping = Wrap ]
    }

    // One stored (restorable) conversation — a clickable row that reopens it.
    DataTemplate x:key="StoredConversationRow" [ DataType = StoredConversationRow ] {
        PanelButton [ Command = $OpenCommand, HorizontalAlignment = Stretch, Margin = (0,2,0,2) ] {
            TextBlock [ Text = $Title, Style = @BodyMedium, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
        }
    }
}
