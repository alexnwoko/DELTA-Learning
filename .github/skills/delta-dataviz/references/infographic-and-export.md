# Infographics, icon arrays and export

Sources: `berba-q/faostat-skills` `infographic` (`third_party/faostat-infographic`, MIT); OCHA
Humanitarian Icons 2026 (`UN-OCHA/humanitarian-icons-2026-BDU`, CC BY 4.0, README licence);
Dashboard layout research section 2.5 (print and PDF).

## One-page fact sheet (adapted from FAOSTAT)

1. One hero figure, with its grade and coverage under it.
2. A headline that states the takeaway in plain words.
3. Two to four supporting figures.
4. One visual (bar chart, icon array or map).
5. One takeaway sentence.
6. Source footer: source, method, grade, coverage, date, disclaimer.

Ten-second test: a reader understands the main point in ten seconds.

## Icon arrays (people and housing)

- Use OCHA icons (self-hosted, recoloured to DELTA tokens, credit "Icons: OCHA, CC BY 4.0").
- State the unit per icon ("each icon = 100 people") in text, next to the array.
- Partial icons are allowed only as a clipped final icon, and the exact figure is printed.
- Screen-reader text gives the exact number, not the icon count.
- Never let an icon alone carry meaning; label every array.

## Print and PDF

- Every exported panel carries title, subtitle, source line, grade, coverage, provisional label,
  date and the DELTA disclaimer.
- Use the browser print route with a print stylesheet (Playwright for automated exports).
- Charts export as vector; the table twin prints on the next page when requested.
