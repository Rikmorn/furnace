---
summary: a Playwright pixel-snapshot harness for the browser render path, plus the reference-image comparison that rides on it
---

# Visual regression testing

Tracker for the deferred visual-regression testing work: a Playwright pixel-snapshot
harness for the browser render path, and the reference-image comparison built on it.
They are merged because they are one story — the snapshot comparison rides the
Playwright setup — and share the same trigger (≥2 examples to compare, or any
non-trivial shader work).

## Playwright visual regression for browser path

Pixel-snapshot comparison of the rendered output to catch shader regressions — Playwright is the obvious tool. Overkill for one triangle, important when there's more.

**Trigger to revisit:** When we have ≥2 examples to compare, or any non-trivial shader work.

## Pixel-perfect snapshot testing

Reference-image comparison for the rendered output. Closely tied to the Playwright setup in the *Playwright visual regression for browser path* section above.

**Trigger to revisit:** Same as the *Playwright visual regression for browser path* section above.
