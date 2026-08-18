---
summary: hold a key to arm a tool and release to go back, generalised from the two momentary modifiers that already implement it for specific effects — with `deriveMomentary`'s wholesale-restore semantics as the constraint any generalisation inherits
---

# Spring-loaded tools

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

Hold a key to arm a tool, release to go back — the pattern the momentary ⇧ (smooth) and ⌃
(dig↔fill invert) modifiers already implement for two specific effects. Generalising it to the
whole tool rail is the item.

**Trigger to revisit:** a third momentary override being wanted. Note the release semantics are already
subtle: `deriveMomentary` assigns the saved tool WHOLESALE on release, which is exactly why the
brush radius had to be moved out of `FieldTool` — a generalisation has to keep that distinction.

**Reference:** `deriveMomentary` (the wholesale assign-on-release that is why the brush radius had to leave `FieldTool`); the momentary ⇧ smooth and ⌃ invert modifiers as the two existing instances; `docs/reference/editor/chrome.md`, `design-system.md` and `tools.md` for everything the same sweep put in the adopt column.
