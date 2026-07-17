// The Agent chat module — a ShellModule contributing one capability whose
// content is the AgentService, rendered by DataTemplate[DataType = AgentService]
// (agent-chat.resources.mu) in the shell's left panel. Icon reuses @Outline for
// v1 (a dedicated glyph can be added to plexus-icons.mu later).

import AgentService from "./services/agent-service.js"

module AgentChatModule [ Name = "Agent" ] {
    .services: {
        AgentService
    }

    Capability [ Name = "Agent", Icon = @Outline, ServiceKey = AgentService ]
}
