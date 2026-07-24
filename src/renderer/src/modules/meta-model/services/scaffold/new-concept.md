---
description: Scaffold a new TODL concept skeleton in this meta-model project
argument-hint: <concept-name>
---

Add a new TODL concept named `$ARGUMENTS` to this meta-model.

If `$ARGUMENTS` is empty, ask for the concept name first (lowercase kebab-case),
then proceed.

1. Choose the target `.todl` file. Keep one `namespace` per file, mirroring its
   folder path; create a new file under the right namespace if none fits.
2. Inside that namespace, add a concept skeleton:

       concept $ARGUMENTS
       {
           description = """
               <one paragraph: what this concept is, and the rule it enforces>
               """;

           id : identifier;
           label : label;
           // fields:        <name> : <type> <card>;   card = (none) | ? | [] | [+]
           // relationships: relationship <name> -> <target> <card>;
       }

3. Type every field with a primitive, a taxonomy, or another concept — never an
   inline `object { … }`. For structured data, add a nested concept and reference
   it by name.
4. Add `invariant "…";` lines for any rule the validator should enforce.
5. Follow `.claude/todl-manual.md` for exact syntax: `&` for references,
   lowercase kebab-case identifiers, and a `;` at the end of every statement.
6. Save, then read the **Problems** panel. Resolve every diagnostic before you
   consider the concept done.
