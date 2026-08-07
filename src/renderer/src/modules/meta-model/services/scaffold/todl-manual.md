# TODL — language manual

The **Typed Object Definition Language** as accepted by the current
`@pragmatic-lab/todl` compiler that Plexus runs on every keystroke. This
describes the surface the parser and validator actually enforce — not the older
YAML-flavoured or `list<T>` forms you may find in archived sources.

> If prose here ever disagrees with the **Problems** panel, the panel wins — it
> is the live compiler. Treat a clean panel as ground truth.

---

## 1. File shape

One `namespace` per file. Everything is declared inside it:

    namespace acme.ea.concepts
    {
        // imports first (optional), then declarations
        concept Component { … }
    }

- The namespace path is a dotted, lowercase path (`acme.ea.concepts`). By
  convention it mirrors the file's folder path.
- **`import` statements come first**, before any declaration:

      namespace acme.ea.model
      {
          import acme.ea.concepts;
          import acme.ea.taxonomies;

          model acme { … }
      }

  An import pulls another namespace's declarations into scope so you can refer to
  its concepts / primitives / taxonomies by bare name.

## 2. Lexical rules

- **Identifiers**: `[A-Za-z_] [A-Za-z0-9_]*` — C-like. No hyphens; `_` is
  allowed; no leading digit. By convention:
  - **Types** — `concept`, `primitive`, `taxonomy`, `annotation`, `enum`,
    `term`, and `class` names — are **PascalCase**: `AppComponent`,
    `ComponentCategory`, `Identifier`.
  - **Members** — field names, relationship names, and annotation parameters —
    are **camelCase**: `implementedBy`, `realisedBy`, `category`.
  - **Keywords** (`concept`, `model`, `import`, …) and **namespace** segments
    are lowercase.
- **Comments**: `// line` and `/* block */`. Both are ignored by the compiler.
- **Strings**: `"single line"`. **Raw / multi-line**: triple-quoted
  `"""…"""` (keeps newlines; use for `description` prose).
- **Numbers**: bare integers, e.g. `version = 5;`.
- **References**: a bare `Name` or `dotted.Path` — there is no sigil. Whether a
  value is a reference (an edge) or a scalar is decided by the member's declared
  **type**: a field typed by a `concept` or `taxonomy` is a reference, a field
  typed by a primitive is a scalar. `@` and `$` are **reserved for Mural** and
  are hard errors in `.todl`.
- **Every statement ends in `;`.** Blocks are delimited by `{ … }`, lists by
  `[ … ]`.

## 3. `concept` — a type in the meta-model

A concept is a first-class entity: the unit authors instantiate and the compiler
validates. It carries fields, relationships, and invariants.

    concept Component
    {
        description = """
            A first-class entity in the architecture — the unit that runs in a
            location. Naming is purpose-first; the technology choice lives in
            implementedBy, not in the name.
            """;

        id : Identifier;
        label : Label;
        category : ComponentCategory;
        implementedBy : Identifier ?;

        relationship in -> Location;
        relationship realisedBy -> Technology [];

        invariant "Component ids are globally unique within the model.";
        invariant "category resolves to a known ComponentCategory term.";
    }

### Fields

    <name> : <Type> <cardinality>? ;

- `<Type>` is a **single name**: a primitive (`string`, `Identifier`), a taxonomy
  (`ComponentCategory`), or another concept. There is **no inline object type** —
  for structured data, define a nested concept and reference it by name.
- `<cardinality>` is a suffix:

  | Suffix | Meaning        | Range |
  |--------|----------------|-------|
  | (none) | exactly one    | 1     |
  | `?`    | optional       | 0..1  |
  | `[]`   | many           | 0..N  |
  | `[+]`  | one or more    | 1..N  |

  So `realisedBy : Technology [];` is "zero or more technologies", and
  `implementedBy : Identifier ?;` is "at most one".

### Inheritance

    concept AppComponent : Component { … }

`concept <Name> : <Parent>` extends a parent concept; the child inherits its
fields and relationships. Override an inherited field only with a
type-compatible narrowing.

### Relationships

    relationship <name> -> <Target> <cardinality>? ;

`<Target>` must be a concept name. Cardinality suffixes are the same as fields;
omit the suffix for exactly-one. `relationship realisedBy -> Technology [];`.

### Invariants

Rules the validator enforces on instances. Two forms:

    invariant "Prose describing the rule the model must satisfy.";

    invariant
    {
        description = "Longer explanation of the same rule.";
        predicate   = this.implementedBy != none;
    }

The prose form is documentation the validator surfaces on violation. The
`predicate` form is an optional machine-checked expression — operators include
`==` `!=` `&&` `||` `implies`, the literals `this` and `none`, member access
(`this.field`), and `all` / `any … in …` comprehensions. When unsure of a
predicate's exact shape, write the prose form and confirm behaviour in the
Problems panel.

## 4. `primitive` — a base data type

    primitive Identifier : string
    {
        description = "A stable, machine-friendly id.";
        regex = "[A-Za-z_][A-Za-z0-9_]*";
    }

- `primitive <Name> : <base>` optionally names a base primitive (`string`,
  `integer`, …). The body carries a `description` and, for string primitives, a
  `regex` constraint.
- Built-in primitives usable as a bare type without declaring them: `string`
  (and, where a project defines them, ids/labels layered on top).

## 5. `taxonomy` — a controlled vocabulary (clabject classes)

A taxonomy *represents* one or more concepts; each `term` is a **class** of that
concept — a named subtype carrying fixed field values. A concept field typed by
the taxonomy takes one of its terms as a bare-name value.

    taxonomy ComponentCategory : represents Component
    {
        description = "The kinds of component the architecture recognises.";

        term AiAgent   { label = "AI Agent"; }
        term Database  { label = "Database"; }
        term Api       { label = "API"; }
    }

- `taxonomy <Name> : represents <Concept> ( , <Concept> )*` — the concept(s) whose
  instances draw their class from this taxonomy.
- `term <Id> { <name> = <value>; … }` — the single-concept form (valid when the
  taxonomy represents exactly one concept).
- `<Concept> <Id> { … }` — the **concept-led** term form, used when a taxonomy
  represents several concepts and each term must say which one it is a class of.

A concept referencing it:

    concept Component { category : ComponentCategory; }

and an instance picks a term by name: `category = AiAgent;`. A `|`-composed set
of terms is allowed where the field is a flag set: `traits = Physical | Managed;`.

## 6. `annotation` — typed metadata on concepts and the package

An **annotation** is typed, author-declared metadata attached to a concept or to
the package as a whole. It is **static / type-level** — it carries no per-instance
data; the compiler validates it and downstream tools read it (Plexus's
presentation generator and the package manifest).

Declare an annotation type like a concept, with typed params:

    annotation icon     { path : string; }
    annotation Category { name : string; order : integer ?; }
    annotation Author   { name : string; email : string ?; }

Apply it with `annotate` — legal inside a `concept` body, a taxonomy `term` body,
a `class` declaration, or a `package { }` block (annotations are type-level; a
concrete instance carrying `annotate` is `annotation.invalid-target`) — giving
each param a fixed value:

    concept Actor
    {
        annotate icon     { path = "resources/actor.svg"; }
        annotate Category { name = "actors"; order = 1; }

        label : Label;
    }

    package
    {
        annotate Author { name = "Acme Corp"; email = "eng@acme.io"; }
    }

- Annotation **type** names are PascalCase; their **params** are camelCase, like
  every other type/member. The one exception: the four **well-known** annotations
  tools switch on by name — `icon`, `label`, `toolbox`, `instance` — are
  lowercase.
- Each annotation applies **at most once per target**; a repeat is an error.
- Params are **scalar** (string / integer / boolean). A required param must be
  given; an undeclared param is rejected.
- **Well-known annotations drive presentation.** `annotate icon { path = "…"; }`
  and `annotate label { text = "…"; }` on a concept feed the generated presentation
  (a raw `icon =` / `label =` attribute, where present, still takes precedence).
  Custom annotations are queryable and bindable in author presentation overrides.

## 7. Instances, classes, containment

Meta-model authors mostly write concepts/primitives/taxonomies; the *data*
(instances) is authored in architecture projects. You'll still read and
occasionally write instances:

    // model <id> : <meta-model> [uses <library> , … ] { concrete instances }
    model acme : acmeEa uses azureCatalog
    {
        Component businessAgent
        {
            label = "Business Agent";
            category = AiAgent;
            implementedBy = copilot;
        }

        Location azureWesteurope { label = "Azure West Europe"; }
    }

- **A concrete instance must live inside a `model` block.** A `model <id> :
  <meta-model> [uses <library>, …] { … }` is the sole carrier of instances; the
  `:` names the meta-model and `uses` lists the libraries it draws terms from
  (both are **namespace names** that must be in scope). A concrete instance
  declared at top level is an error (`instance.orphan`).
- A nested record inside a body expresses **containment** (the `Component` lives
  in the `model`).
- `<id>` is a bare camelCase identifier or a quoted string.
- `class <Concept> <id> { … }` declares a **class** (a partial, fixed-value
  definition). Classes are **exempt** from the model rule — they may sit at top
  level. A leaf points at one with `instanceof`:
  `Component x instanceof webApp { … }`.

### Edge shorthand

Connectors and steps can be written as edges:

    connector businessAgent --> crmApi;
    step receive -> validate;

- `from <op> to` where `<op>` is `->` or `-->`; endpoints are bare names. A
  trailing `{ … }` block adds attributes; otherwise end with `;`.
- Inside a `connectors { … }` block, list bare `a --> b` edges.

## 8. Modifiers

`internal` and `sealed` may prefix a declaration
(`internal concept …`, `sealed concept …`) to mark visibility / finality. They
are optional; omit them unless a rule calls for them.

## 9. Diagnostics you'll see

The Problems panel reports these families (code → meaning):

- `syntax.*` — malformed source: unexpected/absent token, unterminated string,
  an unexpected character (often a stray `@` / `$`, or a missing `;`).
- `cardinality.required-missing` / `cardinality.too-many` /
  `cardinality.empty-not-allowed` — a field/relationship value count violates its
  cardinality suffix.
- `relationship.target-type` — a relationship `target` isn't the expected
  concept.
- `invariant.failed` — an instance violates a concept invariant.
- `class.override` / `class.binding-invalid` — a `class` illegally overrides a
  field, or an `instanceof` / meta-model binding doesn't resolve.
- `taxonomy.*` — a taxonomy represents no concept, a value doesn't resolve to a
  term, or a term names a concept the taxonomy doesn't represent.
- `instance.ambiguous-field-binding` — an assignment can't be matched to a single
  field.
- `instance.orphan` — a concrete instance is declared outside a `model` block.
- `model.binding-undefined` — a `model`'s `: <meta-model>` or a `uses` entry names
  a namespace no loaded module provides.
- `constructor.out-of-scope` — an instance's concept or class comes from a
  namespace the enclosing `model` doesn't bind (via `:` or `uses`).
- `annotation.unknown-param` / `annotation.duplicate` — an `annotate` gives a param
  the annotation didn't declare, or the same annotation is applied twice to one
  target. (An unknown annotation name is `reference.undefined`; a missing required
  param is `cardinality.required-missing`.)

Fix errors from the top down — a syntax error early in a file can cascade into
spurious later diagnostics. Re-check after each fix.

## 10. Quick reference

    namespace a.b.c { … }                       // one per file
    import a.b.d;                                // first in the body

    primitive Id : string { description = "…"; regex = "…"; }

    annotation icon { path : string; }          // typed metadata type

    concept Thing : Parent
    {
        annotate icon { path = "resources/thing.svg"; }   // decorate the concept
        description = """ … """;
        name  : Label;              // exactly one
        tags  : SomeTaxonomy [];    // many
        owner : Identifier ?;       // optional
        parts : Part [+];           // one or more
        relationship uses -> Other [];
        invariant "…";
    }

    taxonomy SomeTaxonomy : represents Thing { term A { label = "A"; } }

    package { annotate Author { name = "…"; } }  // package-level metadata

    model m : a.b.c uses lib { Thing t { … } }   // instances live in a model
