# Annotation-Driven Term Drop — Design (Backlog)

**Status:** Backlog — captured 2026-08-03, not scheduled. Design approved in
principle; no implementation started.

**Owner context:** Follows the arch-canvas Phase 3 work (`.archdiagram`
concept-aware editor). This replaces the fragile drop-target *inference* with an
explicit, author-declared drop binding.

---

## Problem (root cause, confirmed live)

Dropping a toolbox term onto an `.archdiagram` canvas silently creates no shape
for most taxonomies. Traced end-to-end with instrumentation:

- The drag-drop pipeline is fully working: drag-start fires, the drop reaches
  `ArchDiagramDocument.CreateNode`, `registry=true`.
- The break is in **term-scope / semantics resolution**. For a dropped term
  (e.g. `categories.web-portal`), `repo.resolve(term)` succeeds — `typeOf =
  "category"` — but `resolveTermDrop` returns `[]`, so `applyTermDrop` is a
  no-op and no node is created.

Why: `resolveTermDrop`'s semantics are *"scan every concept for a **field**
whose type matches the dropped term's concept; instantiate that concept and set
the field = &term."* That only lands when the term's concept happens to be a
reference-field target somewhere. In the published `tech-architecture` meta-model,
**9 of 14 toolbox taxonomies are unsatisfiable** because no concept has a field
typed by their concept:

| Result | Taxonomies |
|--------|-----------|
| WORKS  | app-components, environments, ingresses, locations, networks |
| BROKEN | actors, application-kinds, application-lifecycle-stages, billing-models, **categories**, connectivity-kinds, connectors, container-roles, lifecycle-stages |

The BROKEN set are *classifier* taxonomies — nothing references them by a field,
so the type-scan inference yields nothing. The works/broken split is accidental,
not authored.

## Goal

Let the meta-model author **declare** what a dropped term materialises and how it
references the term, per taxonomy and (optionally) per term — replacing the
type-scan guess. Every visible taxonomy becomes deliberately droppable or
deliberately not.

## Design — the `instance` annotation

Reuse the existing typed-annotation primitive. Introduce a well-known annotation
Plexus's drop resolver understands:

```todl
annotation instance { concept : identifier; via : identifier?; }
```

- `concept` — the instance-layer concept to create on drop.
- `via` — the reference member on that concept that receives `&term`. Optional:
  if the concept has exactly one member typed by the dropped term's concept, the
  resolver infers it; name it only to disambiguate.

The annotation can be attached at three levels, giving increasing flexibility.

### Variant A — forward (`@instance` marker on the placeable concept)

Mark the concept a user places; the resolver scans `@instance` concepts for a
member typed by the dropped term's concept. Good when one concept absorbs many
facets.

```todl
namespace tech-architecture
{
    annotation instance { }                         // pure marker variant

    concept category   { label : string; }
    concept technology { label : string; }

    concept component
    {
        annotate instance { }                       // ← placeable
        label          : string;
        category       : category?;                 // a `categories` term fills this
        implemented-by : technology?;               // a `technology` term fills this
    }

    taxonomy categories : represents category { term web-portal { label = "Web Portal"; } }
    taxonomy stacks     : represents technology { term azure-openai { label = "Azure OpenAI"; } }
}
```

### Variant B — reverse (binding on the classifier concept)

The dragged classifier declares its own instance form. Resolution is O(1): term →
its concept → its `instance` binding. Good when each facet maps to one instance
concept.

```todl
namespace tech-architecture
{
    annotation instance { concept : identifier; via : identifier?; }

    concept category
    {
        annotate instance { concept = component; via = category; }
        label : string;
    }

    concept component
    {
        label    : string;
        category : category?;                       // member the binding points at
    }

    taxonomy categories : represents category { term web-portal { label = "Web Portal"; } }
}
```

### Variant C — per-term override (concept default + term override)

The concept sets a default; individual terms override the target concept. Because
a subtype inherits the reference member, only `concept` changes — `via` is shared.

```todl
namespace tech-architecture
{
    annotation instance { concept : identifier; via : identifier?; }

    concept category { label : string; }

    concept component
    {
        label    : string;
        category : category?;
    }

    concept application : component                 // application IS a component
    {
        url : string?;
    }

    concept category
    {
        annotate instance { concept = component; via = category; }   // default
        label : string;
    }

    taxonomy categories : represents category
    {
        term api        { label = "API"; }                              // → default: component
        term web-portal
        {
            label = "Web Portal";
            annotate instance { concept = application; }                // override → application
        }
    }
}
```

### Emitted arch-project model

Identical shape regardless of variant — the *data* is the same, only the
declaration moved. Instances wrapped in a `model` block, `member = &taxonomy.term`
(matches the existing arch emitter, round-trips through the compiler unchanged):

```todl
namespace acme-architecture
{
    model
    {
        application portal  { category = &categories.web-portal; }   // term override → application
        component   gateway { category = &categories.api; }          // concept default → component
    }
}
```

## Resolver algorithm (replaces the type-scan in `resolveTermDrop`)

For a dropped term `T`:

1. If `T` (the taxonomy term node) carries an `instance` annotation → use it.
2. Else fall back to `T.typeOf` (the concept) → its `instance` annotation
   (Variant B), or to any `@instance`-marked concept with a member typed
   `T.typeOf` (Variant A).
3. Create the resolved `concept`; set `via` (or the single inferred member) =
   `&T`. If several candidate concepts/members remain, surface a chooser (v1
   first-pick already exists in `applyTermDrop`).

## Open decisions (resolve during planning)

1. **Fields vs. relationships.** `resolveTermDrop` currently reads
   `effectiveSchema().fields` only. In the real meta-model, reference members like
   `component.realised-by` are `relationship`s, which are ignored. Decide whether
   `via` / inference should consider relationships too, or whether classifier
   links stay fields.
2. **Many-to-one facet.** A facet placed as more than one entity kind: Variant B's
   single `concept` can't express it; either use Variant A/C, or let the
   annotation list several target concepts + chooser.
3. **Toolbox scoping.** Taxonomies with no `instance` binding (pure facets like
   `billing-model`) should be hidden from the palette or clearly marked
   non-placeable, instead of appearing and silently failing.
4. **Well-known annotation contract.** Plexus hard-codes the annotation name
   `instance` and params `concept`/`via`. Confirm the name and whether TODL should
   ship it as a standard annotation vs. leaving it a per-meta-model convention.

## Affected components

- **Meta-model authoring** — author declares + applies the `instance` annotation.
  `tech-architecture` gains the annotation, the reference members (e.g.
  `component.category`), and per-term overrides; republish.
- **Plexus** — `resolveTermDrop` / `applyTermDrop`
  (`modules/architecture-repository/services/`) read the annotation instead of
  scanning by type; `ToolboxService` filters non-placeable taxonomies.
- **TODL** — likely none (annotations are already a general typed mechanism);
  confirm per open decision #4.
