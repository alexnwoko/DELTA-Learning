---
name: delta-house-style
description:
  "DELTA writing and documentation house style. Use when writing or reviewing any DELTA
  document, README, decision memo, comment, commit message or report, or when asked to
  lint, clean up or de-slop DELTA text. Runs alongside general anti-slop skills (lesslop,
  no-ai-slop); where they disagree, this skill wins for DELTA."
---

# DELTA house style

Formal UNDRR register: plain, precise, direct. Write as an experienced UNDRR technical
officer would.

## Rules

- Active voice. Short sentences; split any sentence over about 30 words. One idea per sentence.
- No em-dashes. Keep the en-dash only inside numeric or date ranges (2000–2015, A–D).
- No hedging, no filler openers (Moreover, Furthermore, Additionally, Notably), no
  rule-of-three flourishes, no "not only X but also Y", no rhetorical questions.
- Banned terms: delve, leverage, robust, seamless, tapestry, testament, realm, landscape
  (figurative), navigate (figurative), underscore, harness, foster, empower, crucial, pivotal,
  cutting-edge, holistic, synergy, unlock, elevate, spearhead, plethora, myriad, boasts,
  "it is worth noting", "it is important to note", "in today's world", "at its core",
  "in conclusion", ever-evolving.
- Headings in sentence case, specific and concrete. No emoji in formal deliverables.
- Terminology: DELTA, Sendai Framework, HIPs 2025, DesInventar, PostGIS, Drizzle. Expand each
  acronym once on first use. No meta text ("as an AI", "this document was generated").
- Distinguish built, designed and gap. Mark open items `TBD-decision:`. Never invent a figure;
  label illustrative numbers and cite real ones.

## Deliverable header

Every formal deliverable starts with: Title; Status (for example Draft v0.1); Date; Sources
(files cited); Owner. Cross-link sibling documents by relative path.

## Lint before finishing

```bash
grep -c "—" FILE        # must print 0
grep -inoE "\b(delve|leverage|robust|seamless|tapestry|testament|realm|underscore|harness|foster|empower|crucial|pivotal|cutting-edge|holistic|synergy|unlock|elevate|spearhead|plethora|myriad|boasts)\b" FILE   # must print nothing
```

Quotations with attribution and this skill's own examples are exempt.
