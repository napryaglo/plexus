---
description: Scaffold a new TODL concept skeleton in this meta-model project
argument-hint: <ConceptName>
---

Add a new TODL concept named `$ARGUMENTS` to this meta-model.

If `$ARGUMENTS` is empty, ask for the concept name first (PascalCase),
then proceed.

1. Choose the target `.todl` file. Keep one `namespace` per file, mirroring its
   folder path; create a new file under the right namespace if none fits.
2. Inside that namespace, add a concept skeleton:

       concept $ARGUMENTS
       {
           description = """
               <one paragraph: what this concept is, and the rule it enforces>
               """;

           id : Identifier;
           label : Label;
           // fields:        <name> : <Type> <card>;   card = (none) | ? | [] | [+]
           // relationships: relationship <name> -> <Target> <card>;
       }

3. Type every field with a primitive, a taxonomy, or another concept — never an
   inline `object { … }`. For structured data, add a nested concept and reference
   it by name.
4. Add `invariant "…";` lines for any rule the validator should enforce.
5. Follow `.claude/todl-manual.md` for exact syntax: bare-name references (no
   sigil), C-like identifiers (PascalCase types, camelCase members), and a `;`
   at the end of every statement.
6. Save, then read the **Problems** panel. Resolve every diagnostic before you
   consider the concept done.
