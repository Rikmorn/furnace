---
summary: blur clears `keysDown` so the snapshot stays honest, but no `keyup` is synthesized — a consumer subscribed to `onKeyUp` never sees the up-edge for a key held through a window switch
---

# Stuck-key recovery: synthesize key-up events on focus loss

When the page loses focus while a key is held (alt-tab, window-switch, browser modal opens, etc.), the DOM never fires a `keyup` event. Without intervention, the engine's `keysDown` set stays "stuck" — `input.isKeyDown('ArrowLeft')` returns `true` forever, even after the user returns to the page having released the key.

Tranche 3 ships a partial fix: on `window`'s `blur` event the engine clears `keysDown` and resets pointer button state. This keeps the snapshot honest. But it does **not** synthesize the missing `keyup` events — consumers subscribed to `input.onKeyUp` see the key transition from "held" to "not held" without ever receiving the up-edge. Same gap for pointer buttons held during a window-switch.

Open design questions:
- Synthesize missing `keyup` / `pointerup` events at blur time, with a flag in the event payload like `synthetic: true` so the consumer can distinguish? Probably yes. Symmetrical with the held-state clear.
- On `focus` restore, should the engine query the actual current key state? The DOM doesn't expose that — there's no `getKeysDown()` API. So the answer is no, and consumers should treat focus-restore as "all keys released". Document it.
- What about modifier keys? `event.shift` / `ctrl` / `alt` / `meta` are exposed in the engine's normalized event payload. After a blur clear, they're naturally false; on the next real keydown they re-populate from the DOM. Probably fine — but worth verifying when implementing.
- Touch and pen pointer state: on focus loss, do we synthesize a `pointerup` and a `pointerleave`? Touch sessions in particular are weird; the OS may aggressively cancel the gesture independent of focus.

**Trigger to revisit:** First demo where the consumer relies on `onKeyUp` for game logic (release-to-fire, charge-then-shoot, hold-to-aim then release-to-snap-back). The moving-triangle demo never observes the up edge, so the partial fix is enough for tranche 3.

**Reference:** Tranche 3 design spec, Section 2 — "Stuck-key handling" subsection. The held-state-clear-without-keyup compromise is documented there.
