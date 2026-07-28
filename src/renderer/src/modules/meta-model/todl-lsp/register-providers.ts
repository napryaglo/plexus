import * as monaco from 'monaco-editor'
import { TODL_LANGUAGE_ID } from '../todl-language.js'
import type { TodlLanguageClient } from '../../../services/todl/todl-language-client.js'
import {
  provideHover, provideCompletion, provideDefinition, provideReferences,
  provideDocumentSymbols, provideFoldingRanges, provideDocumentSemanticTokens, provideSignatureHelp,
} from './providers.js'

// Browser-only: wire the pure adapters (providers.ts) into Monaco. Neutral
// results are adapted to Monaco shapes here (monaco.Uri, enum kinds, completion
// ranges). Never imported by tests — the adapters' logic is tested headless.

// LSP CompletionItemKind → Monaco CompletionItemKind (best-effort; unmapped → Text).
const K = monaco.languages.CompletionItemKind
const COMPLETION_KIND: Record<number, monaco.languages.CompletionItemKind> = {
  5: K.Field, 6: K.Variable, 7: K.Class, 10: K.Property, 12: K.Value,
  13: K.Enum, 14: K.Keyword, 18: K.Reference, 20: K.EnumMember, 22: K.Struct,
}

function foldingKind(kind: string | undefined): monaco.languages.FoldingRangeKind | undefined {
  if (kind === 'comment') return monaco.languages.FoldingRangeKind.Comment
  if (kind === 'imports') return monaco.languages.FoldingRangeKind.Imports
  if (kind === 'region') return monaco.languages.FoldingRangeKind.Region
  return undefined
}

// LSP SymbolKind (1-based) → Monaco SymbolKind (0-based).
function symbolKind(kind: number): monaco.languages.SymbolKind {
  return Math.max(0, kind - 1) as monaco.languages.SymbolKind
}

function toMonacoSymbols(syms: Awaited<ReturnType<typeof provideDocumentSymbols>>): monaco.languages.DocumentSymbol[] {
  return syms.map((s) => ({
    name: s.name, detail: s.detail, kind: symbolKind(s.kind), tags: [],
    range: s.range, selectionRange: s.selectionRange, children: toMonacoSymbols(s.children),
  }))
}

export function registerTodlProviders(client: TodlLanguageClient): void {
  const lang = TODL_LANGUAGE_ID

  monaco.languages.registerHoverProvider(lang, {
    provideHover: async (model, position) => (await provideHover(client, model, position)) ?? null,
  })

  monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ['&', ':', '-', ' '],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn }
      const { suggestions } = await provideCompletion(client, model, position)
      return {
        suggestions: suggestions.map((s) => ({
          label: s.label,
          kind: s.kind !== undefined ? (COMPLETION_KIND[s.kind] ?? K.Text) : K.Text,
          insertText: s.insertText,
          detail: s.detail,
          documentation: s.documentation,
          range,
        })),
      }
    },
  })

  monaco.languages.registerDefinitionProvider(lang, {
    provideDefinition: async (model, position) =>
      (await provideDefinition(client, model, position)).map((l) => ({ uri: monaco.Uri.parse(l.uri), range: l.range })),
  })

  monaco.languages.registerReferenceProvider(lang, {
    provideReferences: async (model, position) =>
      (await provideReferences(client, model, position)).map((l) => ({ uri: monaco.Uri.parse(l.uri), range: l.range })),
  })

  monaco.languages.registerDocumentSymbolProvider(lang, {
    provideDocumentSymbols: async (model) => toMonacoSymbols(await provideDocumentSymbols(client, model)),
  })

  monaco.languages.registerFoldingRangeProvider(lang, {
    provideFoldingRanges: async (model) => (await provideFoldingRanges(client, model)).map((r) => {
      const kind = foldingKind(r.kind)
      return kind !== undefined ? { start: r.start, end: r.end, kind } : { start: r.start, end: r.end }
    }),
  })

  monaco.languages.registerDocumentSemanticTokensProvider(lang, {
    getLegend: () => client.SemanticLegend(),
    provideDocumentSemanticTokens: async (model) => ({ data: new Uint32Array((await provideDocumentSemanticTokens(client, model)).data) }),
    releaseDocumentSemanticTokens: () => {},
  })

  monaco.languages.registerSignatureHelpProvider(lang, {
    signatureHelpTriggerCharacters: ['&'],
    provideSignatureHelp: async (model, position) => {
      const help = await provideSignatureHelp(client, model, position)
      return help !== null ? { value: help, dispose: () => {} } : null
    },
  })
}
