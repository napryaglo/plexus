import * as monaco from 'monaco-editor'

// Registers a minimal 'todl' Monaco language so .todl files get an id and basic
// syntax colouring (keywords, comments, strings, the & reference sigil). This is
// deliberately small — richer highlighting can grow later. Squiggles do NOT
// depend on this: diagnostics attach to the model as markers regardless of
// whether the language is registered. Idempotent; call once from the bootstrap.

export const TODL_LANGUAGE_ID = 'todl'

let registered = false

export function registerTodlLanguage(): void
{
    if (registered) return
    registered = true

    monaco.languages.register({ id: TODL_LANGUAGE_ID })

    monaco.languages.setMonarchTokensProvider(TODL_LANGUAGE_ID, {
        keywords: [
            'namespace', 'concept', 'primitive', 'enum', 'meta-model', 'relationship',
            'connector', 'model', 'root-concept', 'top-level-concepts', 'implies', 'none', 'this',
        ],
        tokenizer: {
            root: [
                [/\/\/.*$/, 'comment'],
                [/\/\*/, 'comment', '@comment'],
                [/"""/, 'string', '@rawstring'],
                [/"/, 'string', '@string'],
                [/&[A-Za-z][\w-]*/, 'variable'],
                [/[A-Za-z][\w-]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
                [/\d+/, 'number'],
                [/->|==|\|\||[:;=|.?]/, 'operator'],
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
    })

    monaco.languages.setLanguageConfiguration(TODL_LANGUAGE_ID, {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [['{', '}'], ['[', ']'], ['(', ')']],
        autoClosingPairs: [
            { open: '{', close: '}' }, { open: '[', close: ']' },
            { open: '(', close: ')' }, { open: '"', close: '"' },
        ],
    })
}
