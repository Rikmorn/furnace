---
summary: the F4.5 charter cut a game view and recorded the ownership doctrine instead — headlamp is a player-entity concept, fog a region/world one, and the editor hosts a consumer-declared view rather than hardcoding either
---

# Game-view consumer extension (D-18)

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

The charter CUT a game view from F4.5 and recorded the ownership doctrine instead: a future
consumer-provided view extension, declared through the engine seam — **headlamp is a
player-entity concept, fog is a region/world concept, and the editor hosts them rather than
hardcoding them**. That doctrine is what closes the standing fog/headlamp question (the old
cockpit gate's finding ④): they were surfaced as editor view-flags, which conflated "debug
visualization" with "scene data you are authoring", and the answer is that they are neither —
they are the consumer's, and the editor should be able to host a view the consumer declares.

**Trigger to revisit:** the editor-extensions seam contract being worked (F5+). Today that seam has ONE
consumer — the analyzer worker's `analyzerVerify` — and this is the second one that would
justify formalising it.

**Reference:** the editor-extensions seam, whose ONE consumer today is the analyzer worker's `analyzerVerify` — this would be the second, and the one that justifies formalising the contract; `docs/reference/editor-architecture.md` §16–§18 for everything the same sweep put in the adopt column.
