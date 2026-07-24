import {
    Bold, Border, FlowDocument, Hyperlink, InlineUIContainer, Italic, LineBreak,
    List, ListItem, ListMarkerStyle, Paragraph, Run, TextBlock,
    type Block, type Inline,
} from '@pragmatic-lab/mural/basic'
import { DynamicResource, Model, PropertyKey, Thickness } from '@pragmatic-lab/mural/runtime'

// markdown-document.ts — turns the agent's markdown text into a mural
// FlowDocument so a RichTextBlock can lay it out with real formatting
// (headings, bold / italic, inline + fenced code, lists, blockquotes, links).
//
// Deliberately a pragmatic subset of CommonMark — the constructs agents actually
// emit — not a spec-complete parser. It is a PURE, side-effect-free string →
// FlowDocument transform (the only closure it captures, a link opener, is not run
// during construction), so it stays unit-testable in a plain node environment.
// It re-runs on every streamed token delta, so partial / unterminated markup
// (an open code fence mid-stream) must degrade to readable text, never throw.

// Monospace stack for code. FontFamily accepts a raw CSS stack (TextElement).
const MONO = 'Consolas, "SF Mono", "Courier New", monospace'
const BASE_SIZE = 14
// A little extra leading over the ~17px natural line so body text breathes and
// baseline-aligned inline chips (which now hang below the baseline) don't crowd
// the following row.
const BODY_LINE_HEIGHT = 21
// h1..h6 point sizes (h5/h6 fall back to base; emphasis carries them).
const HEADING_SIZE = [22, 19, 17, 15, BASE_SIZE, BASE_SIZE]
// Non-breaking space — used to keep code indentation from collapsing in layout.
const NBSP = ' '

// Standard gap below a block so paragraphs / lists / headings breathe.
function blockGap(): Thickness { return new Thickness(0, 0, 0, 8) }

export function buildFlowDocument(markdown: string): FlowDocument
{
    const doc = new FlowDocument()
    for (const block of parseBlocks(markdown.replace(/\r\n?/g, '\n'))) doc.AddChild(block)
    return doc
}

// ── Block level ──────────────────────────────────────────────────────────────

function parseBlocks(text: string): Block[]
{
    const lines = text.split('\n')
    const blocks: Block[] = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]!
        if (line.trim() === '') { i += 1; continue }

        // Fenced code — ``` or ~~~ … matching fence (or end of text on a stream).
        const fence = /^\s*(`{3,}|~{3,})/.exec(line)
        if (fence) {
            const close = new RegExp('^\\s*' + fence[1]![0] + '{3,}\\s*$')
            const code: string[] = []
            i += 1
            while (i < lines.length && !close.test(lines[i]!)) { code.push(lines[i]!); i += 1 }
            if (i < lines.length) i += 1        // consume the closing fence
            blocks.push(codeBlock(code))
            continue
        }

        // ATX heading — # … ######.
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
            blocks.push(headingBlock(heading[1]!.length, heading[2]!.trim()))
            i += 1
            continue
        }

        // Blockquote — consecutive `>` lines folded into one quoted paragraph.
        if (/^\s*>\s?/.test(line)) {
            const quoted: string[] = []
            while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
                quoted.push(lines[i]!.replace(/^\s*>\s?/, '')); i += 1
            }
            blocks.push(quoteBlock(quoted.join(' ')))
            continue
        }

        // Unordered list — -, *, or + markers.
        if (/^\s*[-*+]\s+/.test(line)) {
            const list = new List()
            list.MarkerStyle = ListMarkerStyle.Disc
            list.Margin = blockGap()
            while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
                list.AddChild(listItem(lines[i]!.replace(/^\s*[-*+]\s+/, ''))); i += 1
            }
            blocks.push(list)
            continue
        }

        // Ordered list — `1.` markers; the first number seeds StartIndex.
        const ordered = /^\s*(\d+)\.\s+/.exec(line)
        if (ordered) {
            const list = new List()
            list.MarkerStyle = ListMarkerStyle.Decimal
            list.StartIndex = parseInt(ordered[1]!, 10)
            list.Margin = blockGap()
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
                list.AddChild(listItem(lines[i]!.replace(/^\s*\d+\.\s+/, ''))); i += 1
            }
            blocks.push(list)
            continue
        }

        // Paragraph — gather soft-wrapped lines until a blank line or a new block.
        const para: string[] = []
        while (i < lines.length && lines[i]!.trim() !== '' && !isBlockStart(lines[i]!)) {
            para.push(lines[i]!.trim()); i += 1
        }
        blocks.push(paragraph(para.join(' ')))
    }

    return blocks
}

// Does this line open a new block? Used to end a paragraph that isn't followed by
// a blank line (agents often write a list directly under a sentence).
function isBlockStart(line: string): boolean
{
    return /^\s*(`{3,}|~{3,})/.test(line)
        || /^#{1,6}\s+/.test(line)
        || /^\s*>\s?/.test(line)
        || /^\s*[-*+]\s+/.test(line)
        || /^\s*\d+\.\s+/.test(line)
}

function paragraph(text: string): Paragraph
{
    const p = new Paragraph()
    p.Margin = blockGap()
    p.LineHeight = BODY_LINE_HEIGHT
    for (const inline of parseInlines(text)) p.AddChild(inline)
    return p
}

function headingBlock(level: number, text: string): Paragraph
{
    const p = new Paragraph()
    p.FontSize = HEADING_SIZE[level - 1] ?? BASE_SIZE
    p.Margin = new Thickness(0, level <= 2 ? 6 : 4, 0, 4)
    // Bold carries the emphasis (h5/h6 that share the base size still read as
    // headings), and composes with any inline markup inside the heading.
    const bold = new Bold()
    for (const inline of parseInlines(text)) bold.AddChild(inline)
    p.AddChild(bold)
    return p
}

function quoteBlock(text: string): Paragraph
{
    const p = new Paragraph()
    p.Margin = new Thickness(12, 0, 0, 8)   // indent stands in for a quote bar
    p.LineHeight = BODY_LINE_HEIGHT
    const italic = new Italic()
    for (const inline of parseInlines(text)) italic.AddChild(inline)
    p.AddChild(italic)
    return p
}

function codeBlock(lines: string[]): Paragraph
{
    const p = new Paragraph()
    p.FontFamily = MONO                      // inherits to every Run below
    p.Margin = new Thickness(8, 2, 0, 8)
    lines.forEach((line, index) => {
        if (index > 0) p.AddChild(new LineBreak())
        p.AddChild(new Run(preserveIndent(line)))
    })
    return p
}

function listItem(text: string): ListItem
{
    const item = new ListItem()
    const p = new Paragraph()
    p.LineHeight = BODY_LINE_HEIGHT
    for (const inline of parseInlines(text)) p.AddChild(inline)
    item.AddChild(p)                          // a ListItem holds Blocks, not inlines
    return item
}

// Keep leading indentation visible — layout collapses ordinary leading spaces, so
// swap them for non-breaking spaces (a tab counts as four).
function preserveIndent(line: string): string
{
    return line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    ').replace(/ /g, NBSP))
}

// ── Inline level ─────────────────────────────────────────────────────────────

// Scan a run of text into styled inlines. Recurses into the bodies of emphasis /
// links so `**bold with `code`**` nests correctly. Any unterminated marker falls
// through as a literal character (buffered into the next Run).
function parseInlines(text: string): Inline[]
{
    const out: Inline[] = []
    let buffer = ''
    const flush = (): void => { if (buffer.length > 0) { out.push(new Run(buffer)); buffer = '' } }

    let i = 0
    while (i < text.length) {
        const ch = text[i]!

        // Inline code — `…`. Parsed first so markup inside a span is literal.
        if (ch === '`') {
            const end = text.indexOf('`', i + 1)
            if (end > i) {
                flush()
                out.push(codeChip(text.slice(i + 1, end)))
                i = end + 1
                continue
            }
        }

        // Bold — **…** or __…__.
        const bold = text.startsWith('**', i) ? '**' : text.startsWith('__', i) ? '__' : ''
        if (bold !== '') {
            const end = text.indexOf(bold, i + 2)
            if (end > i + 1) {
                flush()
                const span = new Bold()
                for (const inline of parseInlines(text.slice(i + 2, end))) span.AddChild(inline)
                out.push(span)
                i = end + 2
                continue
            }
        }

        // Italic — *…* or _…_ (a single marker, not the doubled emphasis).
        if ((ch === '*' || ch === '_') && text[i + 1] !== ch) {
            const end = findSingle(text, ch, i + 1)
            if (end > i) {
                flush()
                const span = new Italic()
                for (const inline of parseInlines(text.slice(i + 1, end))) span.AddChild(inline)
                out.push(span)
                i = end + 1
                continue
            }
        }

        // Link — [text](uri "optional title").
        if (ch === '[') {
            const m = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(text.slice(i))
            if (m !== null) {
                flush()
                const uri = m[2]!
                const link = new Hyperlink()
                link.NavigateUri = uri
                link.Click = (): void => openExternal(uri)
                for (const inline of parseInlines(m[1]!)) link.AddChild(inline)
                out.push(link)
                i += m[0].length
                continue
            }
        }

        buffer += ch
        i += 1
    }

    flush()
    return out
}

// Index of the next lone `marker` at or after `from` (skips a doubled marker so
// italic scanning doesn't stop on the `**` of a bold run).
function findSingle(text: string, marker: string, from: number): number
{
    for (let j = from; j < text.length; j += 1) {
        if (text[j] === marker && text[j + 1] !== marker && text[j - 1] !== marker) return j
    }
    return -1
}

// Best-effort external open. Guarded so the pure transform stays node-safe (tests,
// non-renderer contexts have no window); in the renderer this hands off to the
// host, which routes it to the OS browser.
function openExternal(uri: string): void
{
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(uri, '_blank', 'noopener')
    }
}

// Inline code renders as a CHIP — a rounded, tinted Border wrapping a monospace
// label — embedded in the text flow through an InlineUIContainer, because the
// flow model's runs carry no background. Its colours come from theme tokens via
// DynamicResource, so the chip tracks light/dark with the rest of the chrome
// instead of hardcoding a grey.
function codeChip(text: string): InlineUIContainer
{
    const label = new TextBlock(text)
    label.FontFamily = MONO
    bindTheme(label, TextBlock.ForegroundKey, 'OnSurface')

    const chip = new Border(label)
    chip.CornerRadius = 4
    // Slightly taller box; with baseline alignment the label sits on the text
    // baseline and the extra bottom padding lets the chip hang below the line.
    chip.Padding = new Thickness(6, 2, 6, 2)
    bindTheme(chip, Border.BackgroundKey, 'SurfaceContainerHigh')

    return new InlineUIContainer(chip)
}

// Bind a DP to a theme token via DynamicResource. set_property_value is typed to
// the DP's value, but the runtime also accepts a Binding here (the documented
// DynamicResource pattern) — it resolves against the ambient theme and tracks
// light/dark swaps. The cast is the static-typing tax on that pattern.
function bindTheme<T>(target: Model, key: PropertyKey<T>, token: string): void
{
    target.set_property_value(key, DynamicResource(target, token) as unknown as T)
}
