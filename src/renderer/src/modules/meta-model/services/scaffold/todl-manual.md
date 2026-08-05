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
        concept component { … }
    }

- The namespace path is a dotted, kebab-case path (`acme.ea.concepts`). By
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

- **Identifiers**: `[a-z] [a-z0-9]* ( - [a-z0-9]+ )*` — lowercase kebab-case.
  `app-component`, `implemented-by`, `location`. No PascalCase, no `_`, no
  leading digit.
- **Comments**: `// line` and `/* block */`. Both are ignored by the compiler.
- **Strings**: `"single line"`. **Raw / multi-line**: triple-quoted
  `"""…"""` (keeps newlines; use for `description` prose).
- **Numbers**: bare integers, e.g. `version = 5;`.
- **References**: a bare `name` or `dotted.path` — there is no sigil. Whether a
  value is a reference (an edge) or a scalar is decided by the member's declared
  **type**: a field typed by a `concept` or `taxonomy` is a reference, a field
  typed by a primitive is a scalar. `@` and `$` are **reserved for Mural** and
  are hard errors in `.todl`.
- **Every statement ends in `;`.** Blocks are delimited by `{ … }`, lists by
  `[ … ]`.

## 3. `concept` — a type in the meta-model

A concept is a first-class entity: the unit authors instantiate and the compiler
validates. It carries fields, relationships, and invariants.

    concept component
    {
        description = """
            A first-class entity in the architecture — the unit that runs in a
            location. Naming is purpose-first; the technology choice lives in
            implemented-by, not in the name.
            """;

        id : identifier;
        label : label;
        category : component-category;
        implemented-by : identifier ?;

        relationship in -> location;
        relationship realised-by -> technology [];

        invariant "Component ids are globally unique within the model.";
        invariant "category resolves to a known component-category term.";
    }

### Fields

    <name> : <type> <cardinality>? ;

- `<type>` is a **single name**: a primitive (`string`, `identifier`), a taxonomy
  (`component-category`), or another concept. There is **no inline object type** —
  for structured data, define a nested concept and reference it by name.
- `<cardinality>` is a suffix:

  | Suffix | Meaning        | Range |
  |--------|----------------|-------|
  | (none) | exactly one    | 1     |
  | `?`    | optional       | 0..1  |
  | `[]`   | many           | 0..N  |
  | `[+]`  | one or more    | 1..N  |

  So `realised-by : technology [];` is "zero or more technologies", and
  `implemented-by : identifier ?;` is "at most one".

### Inheritance

    concept app-component : component { … }

`concept <name> : <parent>` extends a parent concept; the child inherits its
fields and relationships. Override an inherited field only with a
type-compatible narrowing.

### Relationships

    relationship <name> -> <target> <cardinality>? ;

`<target>` must be a concept name. Cardinality suffixes are the same as fields;
omit the suffix for exactly-one. `relationship realised-by -> technology [];`.

### Invariants

Rules the validator enforces on instances. Two forms:

    invariant "Prose describing the rule the model must satisfy.";

    invariant
    {
        description = "Longer explanation of the same rule.";
        predicate   = this.implemented-by != none;
    }

The prose form is documentation the validator surfaces on violation. The
`predicate` form is an optional machine-checked expression — operators include
`==` `!=` `&&` `||` `implies`, the literals `this` and `none`, member access
(`this.field`), and `all` / `any … in …` comprehensions. When unsure of a
predicate's exact shape, write the prose form and confirm behaviour in the
Problems panel.

## 4. `primitive` — a base data type

    primitive identifier : string
    {
        description = "A stable, machine-friendly id.";
        regex = "[a-z][a-z0-9]*(-[a-z0-9]+)*";
    }

- `primitive <name> : <base>` optionally names a base primitive (`string`,
  `integer`, …). The body carries a `description` and, for string primitives, a
  `regex` constraint.
- Built-in primitives usable as a bare type without declaring them: `string`
  (and, where a project defines them, ids/labels layered on top).

## 5. `taxonomy` — a controlled vocabulary (clabject classes)

A taxonomy *represents* one or more concepts; each `term` is a **class** of that
concept — a named subtype carrying fixed field values. A concept field typed by
the taxonomy takes one of its terms as a bare-name value.

    taxonomy component-category : represents component
    {
        description = "The kinds of component the architecture recognises.";

        term ai-agent  { label = "AI Agent"; }
        term database  { label = "Database"; }
        term api       { label = "API"; }
    }

- `taxonomy <name> : represents <concept> ( , <concept> )*` — the concept(s) whose
  instances draw their class from this taxonomy.
- `term <id> { <name> = <value>; … }` — the single-concept form (valid when the
  taxonomy represents exactly one concept).
- `<concept> <id> { … }` — the **concept-led** term form, used when a taxonomy
  represents several concepts and each term must say which one it is a class of.

A concept referencing it:

    concept component { category : component-category; }

and an instance picks a term by name: `category = ai-agent;`. A `|`-composed set
of terms is allowed where the field is a flag set: `traits = physical | managed;`.

## 6. `annotation` — typed metadata on concepts and the package

An **annotation** is typed, author-declared metadata attached to a concept or to
the package as a whole. It is **static / type-level** — it carries no per-instance
data; the compiler validates it and downstream tools read it (Plexus's
presentation generator and the package manifest).

Declare an annotation type like a concept, with typed params:

    annotation icon     { path : string; }
    annotation category { name : string; order : integer ?; }
    annotation author   { name : string; email : string ?; }

Apply it with `annotate` — legal inside a `concept` body, a taxonomy `term` body,
a `class` declaration, or a `package { }` block (annotations are type-level; a
concrete instance carrying `annotate` is `annotation.invalid-target`) — giving
each param a fixed value:

    concept actor
    {
        annotate icon     { path = "resources/actor.svg"; }
        annotate category { name = "actors"; order = 1; }

        label : label;
    }

    package
    {
        annotate author { name = "Acme Corp"; email = "eng@acme.io"; }
    }

- Names are lowercase kebab-case, like every other identifier.
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
    model acme : acme-ea uses azure-catalog
    {
        component business-agent
        {
            label = "Business Agent";
            category = ai-agent;
            implemented-by = copilot;
        }

        location azure-westeurope { label = "Azure West Europe"; }
    }

- **A concrete instance must live inside a `model` block.** A `model <id> :
  <meta-model> [uses <library>, …] { … }` is the sole carrier of instances; the
  `:` names the meta-model and `uses` lists the libraries it draws terms from
  (both are **namespace names** that must be in scope). A concrete instance
  declared at top level is an error (`instance.orphan`).
- A nested record inside a body expresses **containment** (the `component` lives
  in the `model`).
- `<id>` is a bare identifier or a quoted string.
- `class <concept> <id> { … }` declares a **class** (a partial, fixed-value
  definition). Classes are **exempt** from the model rule — they may sit at top
  level. A leaf points at one with `instanceof`:
  `component x instanceof web-app { … }`.

### Edge shorthand

Connectors and steps can be written as edges:

    connector business-agent --> crm-api;
    step receive -> validate;

- `from <op> to` where `<op>` is `->` or `-->`; endpoints are bare names. A
  trailing `{ … }` block adds attributes; otherwise end with `;`.
- Inside an `application-connectors { … }` block, list bare `a --> b` edges.

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

    primitive id : string { description = "…"; regex = "…"; }

    annotation icon { path : string; }          // typed metadata type

    concept thing : parent
    {
        annotate icon { path = "resources/thing.svg"; }   // decorate the concept
        description = """ … """;
        name  : label;              // exactly one
        tags  : some-taxonomy [];   // many
        owner : identifier ?;       // optional
        parts : part [+];           // one or more
        relationship uses -> other [];
        invariant "…";
    }

    taxonomy some-taxonomy : represents thing { term a { label = "A"; } }

    package { annotate author { name = "…"; } }  // package-level metadata

    model m : a.b.c uses lib { thing t { … } }   // instances live in a model
