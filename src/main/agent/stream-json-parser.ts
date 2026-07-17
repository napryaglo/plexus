// Pure: one raw `claude -p --output-format stream-json` line → domain AgentEvents.
// Assumes --include-partial-messages is on, so assistant TEXT comes from
// stream_event text deltas; the full `assistant` message is read only for
// tool_use blocks (reading its text too would double every token). Stateless
// per line: tool_use arrives whole in the assistant message, deltas whole in a
// stream_event, so no cross-line assembly is needed. Unknown line types
// (hook_started, status, rate_limit_event, …) fall through to [].
import {
    AgentEventKind,
    type AgentEvent,
} from '../../shared/agent-api.js'

// Reduce a tool_result's content (a string or an array of text blocks) to a
// short one-line summary for the UI chip.
function summarize(content: unknown): string
{
    if (typeof content === 'string') return content.slice(0, 200)
    if (Array.isArray(content))
    {
        const text = content
            .map((b) => (b !== null && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
            .join(' ')
            .trim()
        return text.slice(0, 200)
    }
    return ''
}

export class StreamJsonParser
{
    public push(line: string): AgentEvent[]
    {
        const trimmed = line.trim()
        if (trimmed === '') return []

        let msg: Record<string, unknown>
        try { msg = JSON.parse(trimmed) as Record<string, unknown> }
        catch { return [] }   // skip malformed line, keep the stream alive

        const out: AgentEvent[] = []
        switch (msg.type)
        {
            case 'system':
                if (msg.subtype === 'init' && typeof msg.session_id === 'string')
                    out.push({ Kind: AgentEventKind.SessionStarted, SessionId: msg.session_id })
                break

            case 'stream_event':
            {
                const ev = msg.event as { type?: string; delta?: { type?: string; text?: unknown } } | undefined
                if (ev?.type === 'content_block_delta'
                    && ev.delta?.type === 'text_delta'
                    && typeof ev.delta.text === 'string')
                    out.push({ Kind: AgentEventKind.AssistantText, Text: ev.delta.text })
                break
            }

            case 'assistant':
            {
                const content = (msg.message as { content?: unknown })?.content
                if (Array.isArray(content))
                    for (const block of content as Array<Record<string, unknown>>)
                        if (block?.type === 'tool_use')
                            out.push({
                                Kind:  AgentEventKind.ToolUse,
                                Id:    String(block.id),
                                Name:  String(block.name),
                                Input: block.input,
                            })
                break
            }

            case 'user':
            {
                const content = (msg.message as { content?: unknown })?.content
                if (Array.isArray(content))
                    for (const block of content as Array<Record<string, unknown>>)
                        if (block?.type === 'tool_result')
                            out.push({
                                Kind:    AgentEventKind.ToolResult,
                                Id:      String(block.tool_use_id),
                                Ok:      block.is_error !== true,
                                Summary: summarize(block.content),
                            })
                break
            }

            case 'result':
                if (msg.is_error === true || msg.subtype === 'error_max_turns' || msg.subtype === 'error_during_execution')
                    out.push({ Kind: AgentEventKind.Error, Message: String(msg.result ?? msg.subtype ?? 'agent error') })
                else
                    out.push({ Kind: AgentEventKind.TurnComplete })
                break
        }
        return out
    }
}
