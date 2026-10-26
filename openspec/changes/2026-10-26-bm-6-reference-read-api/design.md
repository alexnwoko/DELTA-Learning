## Decisions

1. Licence rules live in the read model, not in the routes, so no caller
   can skip them. The source rule governs; a value's own rule counts only
   under a per-resource source; an unresolved one is withheld.
2. API-key callers receive only redistributable values (D-BM-08); signed-in
   users also see display-only and signed-in-only values.
3. Withheld values are counted and named, never dropped silently.
4. Malformed requests return 400 with `MALFORMED_REQUEST`; the geo refusal
   envelope with its `meta` block is a follow-up when reference refusals
   need provenance.
