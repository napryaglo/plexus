import {
  monacoToLspPosition, lspToMonacoRange,
  type LspRange, type MonacoRange, type MonacoPosition,
} from './position.js'

// Pure LSP↔Monaco provider adapters. They take a requester (the language client)
// + a model-like (only needs its URI string) + a Monaco position, issue an LSP
// request, and map the response to neutral Monaco-shaped objects. No runtime
// monaco import, so they are headless-testable; the registration shim
// (register-providers.ts) constructs monaco.Uri and registers them.

export interface LspRequester { sendRequest<R>(method: string, params: unknown): Promise<R> }
export interface ModelLike { uri: { toString(): string } }

export interface HoverResult { contents: Array<{ value: string }>; range?: MonacoRange }
export interface LocationResult { uri: string; range: MonacoRange }
export interface CompletionItemResult { label: string; kind?: number; insertText: string; detail?: string; documentation?: string }
export interface CompletionResult { suggestions: CompletionItemResult[] }

function textDocumentParams(model: ModelLike, position: MonacoPosition): unknown {
  return { textDocument: { uri: model.uri.toString() }, position: monacoToLspPosition(position) }
}

type LspMarkup = string | { value: string }
interface LspHover { contents: LspMarkup | LspMarkup[]; range?: LspRange }

function hoverText(contents: LspHover['contents']): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map((c) => (typeof c === 'string' ? c : c.value)).join('\n')
  return contents.value
}

export async function provideHover(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<HoverResult | null> {
  const res = await req.sendRequest<LspHover | null>('textDocument/hover', textDocumentParams(model, position))
  if (res == null) return null
  const out: HoverResult = { contents: [{ value: hoverText(res.contents) }] }
  if (res.range !== undefined) out.range = lspToMonacoRange(res.range)
  return out
}

interface LspLocation { uri: string; range: LspRange }

function toLocations(res: LspLocation | LspLocation[] | null): LocationResult[] {
  const list = res == null ? [] : Array.isArray(res) ? res : [res]
  return list.map((l) => ({ uri: l.uri, range: lspToMonacoRange(l.range) }))
}

export async function provideDefinition(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<LocationResult[]> {
  return toLocations(await req.sendRequest('textDocument/definition', textDocumentParams(model, position)))
}

export async function provideReferences(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<LocationResult[]> {
  const params = { ...(textDocumentParams(model, position) as object), context: { includeDeclaration: true } }
  return toLocations(await req.sendRequest('textDocument/references', params))
}

interface LspCompletionItem { label: string; kind?: number; insertText?: string; detail?: string; documentation?: string | { value: string } }
type LspCompletionResponse = LspCompletionItem[] | { items: LspCompletionItem[] } | null

export async function provideCompletion(req: LspRequester, model: ModelLike, position: MonacoPosition): Promise<CompletionResult> {
  const res = await req.sendRequest<LspCompletionResponse>('textDocument/completion', textDocumentParams(model, position))
  const items = res == null ? [] : Array.isArray(res) ? res : res.items
  return {
    suggestions: items.map((it): CompletionItemResult => {
      const doc = typeof it.documentation === 'string' ? it.documentation : it.documentation?.value
      const out: CompletionItemResult = { label: it.label, insertText: it.insertText ?? it.label }
      if (it.kind !== undefined) out.kind = it.kind
      if (it.detail !== undefined) out.detail = it.detail
      if (doc !== undefined) out.documentation = doc
      return out
    }),
  }
}
