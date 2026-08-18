---
summary: an emerging-tech WATCH rather than a task — WICG "HTML in Canvas" would put HTML elements inside a canvas with depth participation and AOM integration, and Vello does not target the web today; either landing collapses this design space
---

# Emerging-tech watch: WICG HTML-in-Canvas / Vello browser readiness

The WICG "HTML in Canvas" proposal would let HTML elements live inside a canvas with native rasterization, depth participation, and accessibility object model integration. Linebender's Vello is a GPU vector graphics renderer in Rust+wgpu, but per Linebender's own docs the web is not currently a primary target. Either landing in production would collapse the in-scene UI design space.

**Trigger to revisit:** WICG proposal reaches Stage 2+, or Vello announces production web support.

**Reference:** `docs/reference/ui-foundation.md`, "Research write-up" section.
