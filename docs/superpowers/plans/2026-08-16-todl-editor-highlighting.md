# TODL Editor Syntax Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight TODL keywords, operator glyphs, and (meta-model-derived) concept names all in the keyword blue in the Plexus Monaco editor, with concept names updating live when a referenced meta-model gains a concept.

**Architecture:** Two coloring layers. (1) A static Monarch grammar colors the fixed keyword set and operator glyphs — pure data in a monaco-free module. (2) Concept names ride the already-wired LSP **semantic-token** pipeline; we rename the concept-bearing legend entries to TODL-namespaced scopes (`todlType`/`todlClass`) so a blue theme rule targets only TODL and cannot collide with the mural grammar's `type` scope, and we fire the semantic-tokens provider's `onDidChange` when bases refresh so open documents recolor without an edit.

**Tech Stack:** TypeScript, Monaco Editor, vscode-jsonrpc LSP client, vitest (node env). No TODL/compiler changes.

## Global Constraints

- **No `@pragmatic-tech-ai/todl` changes and no republish.** Renderer-only.
- **Every test file lives in a `tests/` subfolder next to the code it exercises** (e.g. `src/renderer/src/services/todl/tests/…`).
- **Tests run in the `node` vitest environment and must NOT import `monaco-editor`.** All tested logic lives in pure modules; monaco-touching glue (`todl-language.ts`, `register-providers.ts`, `code-editor.ts`) is wired but not unit-tested (existing convention: "monaco adapters tested headless").
- **Uniform keyword-blue** for all three token classes. Blue matches Monaco's own keyword color per base: dark `569CD6`, light `0000FF` (6-hex, no leading `#`).
- **Enums over string-literal unions** where a fixed set of names is introduced.
- Do not alter mural (`.mu`) highlighting.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/renderer/src/modules/meta-model/todl-grammar.ts` (NEW, pure) | Monarch data: current keyword list, operator-glyph pattern, tokenizer, language configuration |
| `src/renderer/src/services/todl/semantic-scopes.ts` (NEW, pure) | TODL semantic scope names, `editorSemanticLegend()` (rename type/class), `todlSemanticThemeRules(dark)` |
| `src/renderer/src/modules/meta-model/todl-language.ts` (MODIFY) | Consume `todl-grammar.ts` instead of inline stale data |
| `src/renderer/src/services/todl/todl-language-client.ts` (MODIFY) | `SemanticLegend()` returns the renamed legend; add `onSemanticTokensStale` subscription + fire on `RefreshBases`/`Reinitialize` |
| `src/renderer/src/modules/meta-model/todl-lsp/register-providers.ts` (MODIFY) | Semantic-tokens provider gets an `onDidChange` emitter fed by `onSemanticTokensStale` |
| `src/renderer/src/modules/code-editor/code-editor.ts` (MODIFY) | `defineMuralTheme`: `semanticHighlighting: true` + spread `todlSemanticThemeRules(dark)` into `rules` |

---

## Task 1: Pure Monarch grammar module

**Files:**
- Create: `src/renderer/src/modules/meta-model/todl-grammar.ts`
- Test: `src/renderer/src/modules/meta-model/tests/todl-grammar.test.ts`

**Interfaces:**
- Produces: `TODL_KEYWORDS: string[]`, `TODL_OPERATOR_PATTERN: RegExp`, `TODL_IDENTIFIER_PATTERN: RegExp`, `todlMonarchLanguage: object` (IMonarchLanguage-shaped POJO), `todlLanguageConfiguration: object` (LanguageConfiguration-shaped POJO). No `monaco` import.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/modules/meta-model/tests/todl-grammar.test.ts
import { describe, it, expect } from 'vitest'
import {
  TODL_KEYWORDS, TODL_OPERATOR_PATTERN, TODL_IDENTIFIER_PATTERN, todlMonarchLanguage,
} from '../todl-grammar.js'

describe('TODL Monarch grammar data', () => {
  it('includes the current C-like keyword set', () => {
    for (const kw of [
      'namespace', 'import', 'package', 'primitive', 'concept', 'taxonomy', 'viewpoint',
      'annotation', 'annotate', 'model', 'operator', 'relationship', 'invariant', 'term',
      'class', 'internal', 'sealed', 'extends', 'represents', 'frames', 'uses', 'conforms',
      'instanceof', 'authoring', 'true', 'false',
    ]) expect(TODL_KEYWORDS).toContain(kw)
  })

  it('drops the stale pre-cutover kebab vocabulary', () => {
    for (const stale of ['meta-model', 'root-concept', 'top-level-concepts', 'enum', 'implies', 'none', 'this'])
      expect(TODL_KEYWORDS).not.toContain(stale)
  })

  it('matches operator glyphs but not a lone assignment =', () => {
    for (const glyph of ['->', '-->', '==>', '~>', '->>', '==', '!='])
      expect(new RegExp(`^${TODL_OPERATOR_PATTERN.source}$`).test(glyph)).toBe(true)
    expect(new RegExp(`^${TODL_OPERATOR_PATTERN.source}$`).test('=')).toBe(false)
  })

  it('uses a C-like identifier pattern (no kebab, no & sigil)', () => {
    expect(new RegExp(`^${TODL_IDENTIFIER_PATTERN.source}$`).test('agent_orchestrator')).toBe(true)
    expect(new RegExp(`^${TODL_IDENTIFIER_PATTERN.source}$`).test('agent-orchestrator')).toBe(false)
    expect(new RegExp(`^${TODL_IDENTIFIER_PATTERN.source}$`).test('&ref')).toBe(false)
  })

  it('routes operator glyphs and keywords to the keyword scope in the tokenizer', () => {
    const root = (todlMonarchLanguage as { tokenizer: { root: unknown[][] } }).tokenizer.root
    const flat = JSON.stringify(root)
    expect(flat).toContain('keyword')
    // the & sigil variable rule is gone
    expect(flat).not.toContain('&[A-Za-z]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/tests/todl-grammar.test.ts`
Expected: FAIL (module `../todl-grammar.js` does not exist).

- [ ] **Step 3: Write the module**

```ts
// src/renderer/src/modules/meta-model/todl-grammar.ts
// Pure, monaco-free Monarch grammar DATA for the 'todl' language. Kept free of
// any `monaco-editor` import so it is unit-testable in the node vitest env; the
// registration glue (todl-language.ts) casts these POJOs to the monaco types.
//
// Two things earn the keyword-blue scope: the fixed keyword set below, and any
// operator GLYPH — a run of edge characters (`- ~ = > < !`). Operator glyphs are
// author-defined per meta-model (todl 0.28.0+), but every glyph is lexically a
// run of those characters, so the grammar colors them without knowing the
// declared set. Concept names are NOT here — they are meta-model-derived and
// arrive via LSP semantic tokens.

export const TODL_KEYWORDS: string[] = [
  'namespace', 'import', 'package', 'primitive', 'concept', 'taxonomy', 'viewpoint',
  'annotation', 'annotate', 'model', 'operator', 'relationship', 'invariant', 'term',
  'class', 'internal', 'sealed', 'extends', 'represents', 'frames', 'uses', 'conforms',
  'instanceof', 'authoring', 'true', 'false',
]

// A C-like identifier: leading letter/underscore, then word chars. No kebab `-`.
export const TODL_IDENTIFIER_PATTERN = /[A-Za-z_]\w*/

// An operator glyph: a run of 2+ edge characters (covers `->`, `-->`, `==>`,
// `~>`, `->>`, `==`, `!=`). A lone `=` (assignment) has length 1 and is left to
// the delimiter rule, so it stays neutral.
export const TODL_OPERATOR_PATTERN = /[-~=<>!]{2,}/

export const todlMonarchLanguage = {
  keywords: TODL_KEYWORDS,
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"""/, 'string', '@rawstring'],
      [/"/, 'string', '@string'],
      [TODL_IDENTIFIER_PATTERN, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/\d+/, 'number'],
      [TODL_OPERATOR_PATTERN, 'keyword'],
      [/[{}()[\]]/, '@brackets'],
      [/[:;,.=|?*+&]/, 'delimiter'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    string: [
      [/[^"]+/, 'string'],
      [/"/, 'string', '@pop'],
    ],
    rawstring: [
      [/"""/, 'string', '@pop'],
      [/[^"]+/, 'string'],
      [/"/, 'string'],
    ],
  },
}

export const todlLanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' }, { open: '[', close: ']' },
    { open: '(', close: ')' }, { open: '"', close: '"' },
  ],
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/tests/todl-grammar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/todl-grammar.ts src/renderer/src/modules/meta-model/tests/todl-grammar.test.ts
git commit -m "feat(todl-editor): pure Monarch grammar data with current keywords + operator glyphs"
```

---

## Task 2: Wire the grammar module into the language registration

**Files:**
- Modify: `src/renderer/src/modules/meta-model/todl-language.ts`

**Interfaces:**
- Consumes: `todlMonarchLanguage`, `todlLanguageConfiguration` from Task 1.
- Produces: unchanged public surface (`TODL_LANGUAGE_ID`, `registerTodlLanguage()`).

This task is monaco-touching glue with no new unit test (existing convention). Its correctness is that `tsc` type-checks the casts and the app still registers the language.

- [ ] **Step 1: Replace the inline grammar with the module**

Replace the body of `registerTodlLanguage()` in `todl-language.ts` (the `setMonarchTokensProvider` and `setLanguageConfiguration` calls) so it imports and uses the Task 1 data. Full new file:

```ts
import * as monaco from 'monaco-editor'
import { todlMonarchLanguage, todlLanguageConfiguration } from './todl-grammar.js'

// Registers the 'todl' Monaco language so .todl files get an id and syntax
// colouring. Keywords + operator glyphs are colored via the pure Monarch data
// in todl-grammar.ts; concept names arrive separately as LSP semantic tokens.
// Squiggles do NOT depend on this (diagnostics attach as markers regardless).
// Idempotent; call once from the bootstrap.

export const TODL_LANGUAGE_ID = 'todl'

let registered = false

export function registerTodlLanguage(): void
{
    if (registered) return
    registered = true

    monaco.languages.register({ id: TODL_LANGUAGE_ID })
    monaco.languages.setMonarchTokensProvider(
        TODL_LANGUAGE_ID, todlMonarchLanguage as monaco.languages.IMonarchLanguage)
    monaco.languages.setLanguageConfiguration(
        TODL_LANGUAGE_ID, todlLanguageConfiguration as monaco.languages.LanguageConfiguration)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.node.json --noEmit` (or the repo's renderer typecheck script — check `package.json` `scripts` for `typecheck`; use that). Also run `npx vitest run src/renderer/src/modules/meta-model/tests/todl-grammar.test.ts` to confirm no regression.
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/modules/meta-model/todl-language.ts
git commit -m "feat(todl-editor): register todl language from pure grammar module"
```

---

## Task 3: TODL semantic scopes — renamed legend + blue theme rules

**Files:**
- Create: `src/renderer/src/services/todl/semantic-scopes.ts`
- Test: `src/renderer/src/services/todl/tests/semantic-scopes.test.ts`

**Interfaces:**
- Consumes: `SemanticLegend` type (`{ tokenTypes: string[]; tokenModifiers: string[] }`, exported from `todl-language-client.ts`) — re-declare a local structural type to avoid a circular import (client will import THIS module in Task 4, so this module must not import the client).
- Produces:
  - `enum TodlSemanticScope { Type = 'todlType', Class = 'todlClass' }`
  - `editorSemanticLegend(server: { tokenTypes: string[]; tokenModifiers: string[] }): { tokenTypes: string[]; tokenModifiers: string[] }` — renames server type `type`→`todlType`, `class`→`todlClass`, order preserved, other entries untouched.
  - `todlSemanticThemeRules(dark: boolean): { token: string; foreground: string }[]` — blue rules for the two scopes.
  - `TODL_KEYWORD_BLUE_DARK = '569CD6'`, `TODL_KEYWORD_BLUE_LIGHT = '0000FF'`.

Rationale for renaming: Monaco themes semantic tokens through the same rule namespace as Monarch scopes. The mural grammar emits `type` for PascalCase elements, so a global `{ token: 'type' }` blue rule would recolor `.mu` files. Renaming the concept-bearing legend entries to TODL-only scopes confines the blue rule to `.todl`. The token DATA (a `Uint32Array` indexing into the legend) is unaffected — only the display names change.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/services/todl/tests/semantic-scopes.test.ts
import { describe, it, expect } from 'vitest'
import {
  TodlSemanticScope, editorSemanticLegend, todlSemanticThemeRules,
  TODL_KEYWORD_BLUE_DARK, TODL_KEYWORD_BLUE_LIGHT,
} from '../semantic-scopes.js'

const SERVER = { tokenTypes: ['type', 'class', 'enumMember', 'property', 'method', 'variable'], tokenModifiers: [] }

describe('editorSemanticLegend', () => {
  it('renames the concept-bearing types to TODL scopes, order preserved', () => {
    const legend = editorSemanticLegend(SERVER)
    expect(legend.tokenTypes).toEqual([
      TodlSemanticScope.Type, TodlSemanticScope.Class, 'enumMember', 'property', 'method', 'variable',
    ])
  })
  it('leaves modifiers and non-concept types untouched', () => {
    const legend = editorSemanticLegend({ tokenTypes: ['property', 'variable'], tokenModifiers: ['declaration'] })
    expect(legend.tokenTypes).toEqual(['property', 'variable'])
    expect(legend.tokenModifiers).toEqual(['declaration'])
  })
  it('is a pure copy (does not mutate the server legend)', () => {
    const server = { tokenTypes: ['type'], tokenModifiers: [] }
    editorSemanticLegend(server)
    expect(server.tokenTypes).toEqual(['type'])
  })
})

describe('todlSemanticThemeRules', () => {
  it('colors both TODL scopes the dark keyword blue', () => {
    const rules = todlSemanticThemeRules(true)
    expect(rules).toContainEqual({ token: TodlSemanticScope.Type, foreground: TODL_KEYWORD_BLUE_DARK })
    expect(rules).toContainEqual({ token: TodlSemanticScope.Class, foreground: TODL_KEYWORD_BLUE_DARK })
  })
  it('uses the light keyword blue on a light base', () => {
    const rules = todlSemanticThemeRules(false)
    expect(rules.every((r) => r.foreground === TODL_KEYWORD_BLUE_LIGHT)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/services/todl/tests/semantic-scopes.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the module**

```ts
// src/renderer/src/services/todl/semantic-scopes.ts
// The TODL LSP legend names its concept-bearing token types `type` and `class`.
// Monaco themes semantic tokens in the same scope namespace as Monarch, and the
// mural grammar already uses `type` — so we rename these two to TODL-only scopes
// before handing the legend to Monaco, and theme ONLY those scopes blue. The
// token data (indices into the legend) is unchanged; only display names differ.

interface Legend { tokenTypes: string[]; tokenModifiers: string[] }

export enum TodlSemanticScope {
  Type = 'todlType',
  Class = 'todlClass',
}

// Server legend type name -> TODL-scoped display name.
const RENAME: Record<string, string> = {
  type: TodlSemanticScope.Type,
  class: TodlSemanticScope.Class,
}

export const TODL_KEYWORD_BLUE_DARK = '569CD6'
export const TODL_KEYWORD_BLUE_LIGHT = '0000FF'

export function editorSemanticLegend(server: Legend): Legend {
  return {
    tokenTypes: server.tokenTypes.map((t) => RENAME[t] ?? t),
    tokenModifiers: [...server.tokenModifiers],
  }
}

export function todlSemanticThemeRules(dark: boolean): { token: string; foreground: string }[] {
  const blue = dark ? TODL_KEYWORD_BLUE_DARK : TODL_KEYWORD_BLUE_LIGHT
  return [
    { token: TodlSemanticScope.Type, foreground: blue },
    { token: TodlSemanticScope.Class, foreground: blue },
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/services/todl/tests/semantic-scopes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/todl/semantic-scopes.ts src/renderer/src/services/todl/tests/semantic-scopes.test.ts
git commit -m "feat(todl-editor): TODL-scoped semantic legend rename + blue theme rules"
```

---

## Task 4: Client — renamed legend + semantic-stale event

**Files:**
- Modify: `src/renderer/src/services/todl/todl-language-client.ts`
- Test: `src/renderer/src/services/todl/tests/todl-language-client-semantic.test.ts`

**Interfaces:**
- Consumes: `editorSemanticLegend` from Task 3.
- Produces on `TodlLanguageClient`:
  - `SemanticLegend()` now returns `editorSemanticLegend(rawServerLegend)` (renamed).
  - `onSemanticTokensStale(cb: () => void): () => void` — subscribe; returns an unsubscribe.
  - `RefreshBases()` and `Reinitialize()` fire the stale callbacks after pushing bases.

**Existing code referenced** (from `todl-language-client.ts`):
- `private semanticLegend: SemanticLegend | undefined` (~line 76)
- `public SemanticLegend(): SemanticLegend { return this.semanticLegend ?? { tokenTypes: [], tokenModifiers: [] } }` (~line 180)
- `public async RefreshBases(storage: IStorage): Promise<void> { … await this.notify('todl/refreshBases', …) }` (~line 270)
- `public async Reinitialize(): Promise<void> { await this.handshake(); await this.ResyncAll() }` (~line 157)

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/services/todl/tests/todl-language-client-semantic.test.ts
import { describe, it, expect, vi } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { TodlSemanticScope } from '../semantic-scopes.js'

// Minimal fake so we can drive the client without a real LSP connection. Mirrors
// the pattern in the sibling todl-language-client-*.test.ts files; adjust the
// helper name if those tests expose a shared harness.
function clientWithServerLegend(types: string[]): TodlLanguageClient {
  const c = new TodlLanguageClient()
  // The raw server legend is normally captured during handshake; set it directly.
  ;(c as unknown as { semanticLegend: { tokenTypes: string[]; tokenModifiers: string[] } })
    .semanticLegend = { tokenTypes: types, tokenModifiers: [] }
  return c
}

describe('TodlLanguageClient semantic highlighting', () => {
  it('advertises the TODL-renamed legend to the editor', () => {
    const c = clientWithServerLegend(['type', 'class', 'property'])
    expect(c.SemanticLegend().tokenTypes).toEqual([
      TodlSemanticScope.Type, TodlSemanticScope.Class, 'property',
    ])
  })

  it('notifies subscribers when bases refresh so open docs re-fetch tokens', async () => {
    const c = clientWithServerLegend(['type'])
    const stale = vi.fn()
    c.onSemanticTokensStale(stale)
    // Drive RefreshBases with a storage the client does not know: it returns
    // early WITHOUT firing (no project => nothing to recolor).
    await c.RefreshBases({} as never)
    expect(stale).not.toHaveBeenCalled()
    // Fire the internal notifier directly to prove subscription + unsubscribe.
    const off = c.onSemanticTokensStale(stale)
    ;(c as unknown as { fireSemanticStale(): void }).fireSemanticStale()
    expect(stale).toHaveBeenCalledTimes(1)  // only the still-subscribed one from line above counts once
    off()
  })
})
```

> Note for the implementer: the sibling tests (`todl-language-client-workspace-bases.test.ts`) already construct a client and stub `notify`/bases. If they expose a reusable harness, prefer it over the inline `as unknown` pokes above, and assert `fireSemanticStale` runs at the end of a *successful* `RefreshBases` (a known project + stubbed `notify`). Keep at least: (a) `SemanticLegend()` renames, (b) a subscribed callback fires on a successful refresh, (c) unsubscribe stops it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/services/todl/tests/todl-language-client-semantic.test.ts`
Expected: FAIL (`onSemanticTokensStale` undefined).

- [ ] **Step 3: Implement**

Add the import at the top of `todl-language-client.ts`:

```ts
import { editorSemanticLegend } from './semantic-scopes.js'
```

Add the notifier field + methods to the class (near the other private state / public methods):

```ts
  private semanticStaleSubs = new Set<() => void>()

  // Subscribe to "semantic tokens may have changed for reasons other than a
  // document edit" (bases refreshed / server reinitialized). The Monaco
  // semantic-tokens provider forwards this to its onDidChange so open documents
  // re-fetch — this is how a newly added meta-model concept recolors live.
  public onSemanticTokensStale(cb: () => void): () => void {
    this.semanticStaleSubs.add(cb)
    return () => { this.semanticStaleSubs.delete(cb) }
  }

  private fireSemanticStale(): void {
    for (const cb of [...this.semanticStaleSubs]) cb()
  }
```

Change `SemanticLegend()` to rename:

```ts
  public SemanticLegend(): SemanticLegend {
    return editorSemanticLegend(this.semanticLegend ?? { tokenTypes: [], tokenModifiers: [] })
  }
```

Fire after a successful `RefreshBases` (append after the `notify('todl/refreshBases', …)` call, inside the method, after the early `if (found === null) return`):

```ts
    await this.notify('todl/refreshBases', { rootUri: this.uriFor(found.project.projectId, ''), bases })
    this.fireSemanticStale()
```

Fire at the end of `Reinitialize` (after `ResyncAll`):

```ts
  public async Reinitialize(): Promise<void> {
    await this.handshake()
    await this.ResyncAll()
    this.fireSemanticStale()
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/services/todl/tests/todl-language-client-semantic.test.ts`
Expected: PASS. Also run the whole todl client suite to catch regressions: `npx vitest run src/renderer/src/services/todl/`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/todl/todl-language-client.ts src/renderer/src/services/todl/tests/todl-language-client-semantic.test.ts
git commit -m "feat(todl-editor): renamed semantic legend + semantic-stale event on base refresh"
```

---

## Task 5: Provider onDidChange + theme blue rules (monaco glue)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/todl-lsp/register-providers.ts`
- Modify: `src/renderer/src/modules/code-editor/code-editor.ts`

**Interfaces:**
- Consumes: `client.onSemanticTokensStale` (Task 4), `todlSemanticThemeRules` (Task 3).

Monaco-touching glue; no new unit test (convention). Verified by `tsc` + the manual smoke below.

- [ ] **Step 1: Feed onDidChange in the semantic-tokens provider**

In `register-providers.ts`, replace the `registerDocumentSemanticTokensProvider` block (~lines 90–94) with one that carries an emitter fired by the client:

```ts
  const semanticTokensChanged = new monaco.Emitter<void>()
  client.onSemanticTokensStale(() => semanticTokensChanged.fire())
  monaco.languages.registerDocumentSemanticTokensProvider(lang, {
    onDidChange: semanticTokensChanged.event,
    getLegend: () => client.SemanticLegend(),
    provideDocumentSemanticTokens: async (model) => ({ data: new Uint32Array((await provideDocumentSemanticTokens(client, model)).data) }),
    releaseDocumentSemanticTokens: () => {},
  })
```

- [ ] **Step 2: Add the blue semantic rules to the theme**

In `code-editor.ts`, import the helper at the top:

```ts
import { todlSemanticThemeRules } from '../../services/todl/semantic-scopes.js'
```

In `defineMuralTheme()`, change the `defineTheme` call (currently `rules: []`) to enable semantic highlighting and supply the TODL blue rules:

```ts
        monaco.editor.defineTheme(MURAL_THEME, {
            base:    dark ? 'vs-dark' : 'vs',
            inherit: true,
            rules:   todlSemanticThemeRules(dark),
            colors,
            semanticHighlighting: true,
        })
```

> `semanticHighlighting` is a valid field on Monaco's `IStandaloneThemeData`. If the installed monaco typings reject it, cast the object literal `as monaco.editor.IStandaloneThemeData` — do NOT drop the field. The rules only name `todlType`/`todlClass`, which no Monarch grammar emits, so `.mu` files are unaffected.

- [ ] **Step 3: Type-check + full suite**

Run the renderer typecheck script (from `package.json`, e.g. `npm run typecheck`) and `npx vitest run`.
Expected: no type errors; all tests green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/modules/meta-model/todl-lsp/register-providers.ts src/renderer/src/modules/code-editor/code-editor.ts
git commit -m "feat(todl-editor): semantic-tokens onDidChange + blue concept-name theme rules"
```

- [ ] **Step 5: Manual smoke (human)**

Rebuild/run Plexus (`npm run dev`). Open a `.todl` file in a tech-architecture project and confirm:
1. Keywords (`namespace`, `concept`, `operator`, `model`, `conforms`, `uses`, …) are blue.
2. Operator glyphs (`-->`, `==>`, `->`) are blue.
3. Concept names in instance declarations (`component foo {`, `connector`, `step`) are blue.
4. `.mu` files are visually unchanged (PascalCase elements are NOT forced blue).
5. Add a new `concept` to a referenced meta-model and republish/refresh bases; the new concept name starts highlighting blue in the already-open model file without needing to edit that file.

---

## Self-Review

**Spec coverage:** keywords (Task 1/2), operator glyphs (Task 1), concept names blue via semantic tokens (Task 3/5), runtime update on base change (Task 4 event → Task 5 onDidChange), no-mural-collision (Task 3 rename), no TODL change (whole plan), testing headless (Tasks 1/3/4). All covered.

**Placeholder scan:** none — every code step carries full content.

**Type consistency:** `SemanticLegend` shape `{ tokenTypes: string[]; tokenModifiers: string[] }` used identically in Tasks 3/4. `editorSemanticLegend`/`todlSemanticThemeRules`/`TodlSemanticScope` names match across Tasks 3/4/5. `onSemanticTokensStale`/`fireSemanticStale` consistent across Task 4/5. Blue constants `569CD6`/`0000FF` consistent between spec and Tasks 3/5.
