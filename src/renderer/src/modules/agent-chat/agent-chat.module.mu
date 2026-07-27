// The Agent chat module — a ShellModule contributing one capability whose
// content is the AgentService, rendered by DataTemplate[DataType = AgentService]
// (agent-chat.resources.mu) in the shell's left panel.

import AgentService from "./services/agent-service.js"

module AgentChatModule [ Name = "Agent" ] {
    .services: {
        AgentService
    }
    // Agent chat lives in the right panel dock (added at startup in main.js as
    // the Chat tab), not the left activity rail — so no Capability contribution.
}
