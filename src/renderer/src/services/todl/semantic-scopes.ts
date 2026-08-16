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
