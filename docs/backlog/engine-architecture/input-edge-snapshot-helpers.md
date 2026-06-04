# Input edge-snapshot helpers (`wasKeyPressed`, `wasKeyReleased`)

Tranche 3 ships only "is this key currently held" / "is this pointer button currently down" as the polled snapshot surface. Consumers needing per-frame edge state (jump-on-press, single-shot weapons, toggle-on-release) must subscribe to `input.onKeyDown` / `input.onKeyUp` themselves and maintain their own latched flag.

Implementation sketch: add `input.wasKeyPressed(code)` / `input.wasKeyReleased(code)` / `input.wasPointerButtonPressed(btn)` / `input.wasPointerButtonReleased(btn)` to the polled-snapshot surface. The engine maintains a per-key/button "pressed this frame" / "released this frame" bitfield; the bitfield must be cleared at a deterministic point in the frame — most likely at the render-frame boundary, which means `frame.loop` needs to know about and call `input.resetEdges()` (a one-line internal hook). Note there is now only one loop to couple to: fixed-step consumers advance a `frame.fixedClock` *inside* `frame.loop`'s callback (the shell dispatches the per-scene frame there), so a single `frame.loop` reset point covers the fixed-step case too — no separate fixed loop to hook. That's the only real design cost: a documented Tier 1 cross-module coupling (input ↔ frame), similar to the documented `stats` instrumentation exception in the master arch spec.

Alternative if the cross-module coupling feels heavy: `input.consumeKeyPresses()` returns and clears the list each call — no edge flags, no engine-internal reset needed. Slightly weirder ergonomics; doesn't compose well with multiple consumers of the same edge.

Open design questions:
- Where exactly is `resetEdges` called from — `frame.loop`'s per-RAF tick boundary, or a new `frame.beginFrame`/`frame.endFrame` boundary the engine itself owns? The latter is cleanest but adds API surface.
- For fixed-step sims (a `frame.fixedClock` advanced inside the loop), does each simulation tick get its own edge state, or do all ticks of a frame share the render-frame's edges? Probably the latter (edges fire once per RAF; the clock's catch-up ticks all see them).
- Whether the edge bitfield is bounded (every keyboard scancode pre-allocated) or sparse (Map<KeyCode, EdgeBits>). Sparse is fine; the absolute number of distinct keys touched per frame is small.

**Trigger to revisit:** First demo that needs discrete press/release semantics — typically jump physics, menu navigation, weapon firing, or any "I want to act on the transition, not the held state" interaction. Tranche 3's moving-triangle demo is entirely continuous, which is why this is deferred.

**Reference:** Tranche 3 design spec (`docs/superpowers/specs/2026-05-22-core-tranche-3-input-design.md` once written) — captured the held-only snapshot decision and pointed here.
