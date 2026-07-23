# Input-module pass

Tracker for the deferred work on `@furnace/core/input`. Each entry is a capability
or hygiene gap the current input module leaves open — per-ctx scoping, pointer-lock /
relative motion, configurable `preventDefault`, and stuck-key recovery — and each
shares the "the input module finally gets a dedicated pass, or a specific consumer
forces it" trigger. They are merged so a future input-module tranche has one place to
pick up every pending decision. Sections keep their original order.

## Refactor `input.attach(canvas)` → `input.attach(ctx)`

`packages/core/src/input/attach.ts:28` takes a raw `HTMLCanvasElement` and operates against a module-level singleton `state: State` in `packages/core/src/input/state.ts`. Input emitters (`keyDown`, `keyUp`, `pointerDown/Move/Up`, `wheel`) are created at module-load time, before any ctx exists.

This means tranche 5's per-ctx `stats._recordEmission` instrumentation does NOT apply to input — input emissions don't surface in `snap.events.perEmitter`. Adding per-ctx tracking requires:

1. `input.attach(ctx)` instead of `input.attach(canvas)`. Canvas is read from `ctx.canvas`.
2. Per-ctx emitter creation (drop the module-singleton; store input state on ctx or in a `WeakMap<Context, InputState>`).
3. Multi-context input: each ctx has its own input state + emitters; supports HMR / SPA mounting and multi-canvas apps cleanly.
4. Update hello-world entry (one call site).

This is roughly tranche-3-scope worth of work — touches every file under `packages/core/src/input/`.

**Stage 4A update (2026-06-04) — the "input is a global singleton vs ctx-scoped" finding lands here.** Stage 4A's brainstorm surfaced (and the user agreed to defer) the broader observation that the input module is a global singleton while the rest of the engine is ctx-scoped — one input attachment vs N GPU contexts. That is exactly this refactor. Stage 4A added per-frame edge state to the SAME `State` singleton (`keysPressed`/`keysReleased` sets + `buttonsPressed`/`buttonsReleased` bitmasks, plus the `frame → input` per-frame reset coupling via `_inputEndFrame`). **This does NOT worsen the future migration**: all input state — held keys, pointer, emitters, listeners, AND the new edge fields — is one `State` object, uniformly movable onto `ctx._internal` (or a `WeakMap<Context, InputState>`) in one pass. The ctx-less `_inputEndFrame` reset stays ctx-less for the same reason it is today (the singleton), and would become ctx-scoped alongside everything else when this refactor happens.

**Trigger to revisit:** When per-emitter input event counts become diagnostically useful (debugging input event storms, event-handler perf), OR when multi-context / multi-viewport / split-screen input becomes a real requirement (multi-canvas apps, HMR / SPA mounting, per-viewport input routing), OR when `engine-cascade-teardown.md` lands (input would self-register via `gpu.onDispose`).

**Reference:** Core Tranche 5 (stats expansion) design, §1 — "Minor signature change to events".

## Relative-pointer / pointer-lock mechanism in `core/input`

**Context:** The dungeon first-person controller needs mouselook, which requires
pointer-lock and the per-frame relative motion (`movementX`/`movementY`) that
lock delivers. `@furnace/core/input` doesn't offer either — its `PointerEvent`
carries the absolute pointer position only (no relative delta, no lock helper) —
so the controller reaches outside the engine and wires `requestPointerLock()` +
raw `movementX/Y` against the DOM directly (`packages/dungeon/src/fp-controller.ts`,
`attachMouse`, lines 70–77).

Pointer-lock + relative motion is an input *mechanism*, not game logic, so it's
engine-appropriate surface. It was kept game-side here per scope-to-current-need:
one consumer, one mouselook controller — not enough signal to fix the engine
shape yet.

**Trigger to revisit:** A second consumer needs mouselook, OR the input module
gets a dedicated pass. At that point, consider adding a relative-pointer /
pointer-lock mechanism to `core/input` (e.g. a `lockPointer(ctx)` + a relative
`movementX/Y` field or a dedicated relative-motion emitter) and migrate the
dungeon controller onto it.

**Reference:** `packages/dungeon/src/fp-controller.ts` (`attachMouse`);
`docs/reference/core-modules.md` `@furnace/core/input`.

## Configurable `preventDefault` for tracked input events

Tranche 3 ships normalized `KeyEvent` / `PointerEvent` / `WheelEvent` snapshots, *not* the live DOM events, so consumers have no way to call `event.preventDefault()` themselves. This is fine for the hello-world demo (full-viewport canvas with no surrounding content) but breaks the moment furnace is embedded in a real page:

- ArrowDown / ArrowUp / Space / PageDown scroll the page if the canvas doesn't cover the viewport.
- Right-click opens the browser context menu over the canvas.
- Cmd+S / Ctrl+S triggers the browser save dialog mid-game.
- Tab navigates focus away from the canvas.
- Mouse wheel scrolls the surrounding page.

The engine has to handle this — pushing it onto every consumer is hostile, and there's nothing to push it to anyway since we're hiding the DOM event.

Implementation sketch — most likely shape:

```ts
input.attach(canvas, {
  preventDefault: {
    keys: "all" | KeyCode[] | (e: KeyEvent) => boolean,
    pointer: "all" | PointerButton[] | (e: PointerEvent) => boolean,
    wheel: boolean | (e: WheelEvent) => boolean,
    contextMenu: boolean,         // suppress the right-click menu over canvas
  }
});
```

The engine calls `preventDefault()` inside its own raw DOM listener, *before* normalizing into our `KeyEvent` / `PointerEvent`. The predicate-function form lets consumers do scoped suppression (e.g. "only suppress arrows when our menu is closed").

Open design questions:
- Defaults: do we ship `{ preventDefault: "all" }` as the default (game-mode-first) or `{}` (browser-friendly-default)? Tier-1 hello-world doesn't need either; the choice matters more once we have real consumers. Probably default-off — opt-in suppression is less surprising.
- For wheel: passive vs non-passive listeners. Calling `preventDefault` on a wheel event requires `{ passive: false }` at addEventListener time. That has a perf footprint Chrome will warn about; we'd add it only when wheel suppression is enabled.
- `KeyboardEvent` listener target is `window`, but `preventDefault` semantics there are weird for some keys (browser shortcuts). Document which keys *cannot* be suppressed by web pages (Cmd+W, Cmd+Q, etc. — these are out of reach).
- Programmatic capture (`pointer.setPointerCapture`) is a separate but related concern — useful for drag operations that need to keep receiving pointermove after leaving the canvas. Same design surface (attach option vs runtime call). Probably belongs in a sibling backlog entry.

**Trigger to revisit:** First time the engine is consumed in a real page (not the full-viewport hello-world), OR the first demo that uses Space / arrows for gameplay AND has any surrounding page content. The "scroll on Space" bug bites hard the second a player tries to jump.

**Reference:** Tranche 3 design spec, Section 2 — "preventDefault story" subsection captures the tranche-3-omission decision.

## Stuck-key recovery: synthesize key-up events on focus loss

When the page loses focus while a key is held (alt-tab, window-switch, browser modal opens, etc.), the DOM never fires a `keyup` event. Without intervention, the engine's `keysDown` set stays "stuck" — `input.isKeyDown('ArrowLeft')` returns `true` forever, even after the user returns to the page having released the key.

Tranche 3 ships a partial fix: on `window`'s `blur` event the engine clears `keysDown` and resets pointer button state. This keeps the snapshot honest. But it does **not** synthesize the missing `keyup` events — consumers subscribed to `input.onKeyUp` see the key transition from "held" to "not held" without ever receiving the up-edge. Same gap for pointer buttons held during a window-switch.

Open design questions:
- Synthesize missing `keyup` / `pointerup` events at blur time, with a flag in the event payload like `synthetic: true` so the consumer can distinguish? Probably yes. Symmetrical with the held-state clear.
- On `focus` restore, should the engine query the actual current key state? The DOM doesn't expose that — there's no `getKeysDown()` API. So the answer is no, and consumers should treat focus-restore as "all keys released". Document it.
- What about modifier keys? `event.shift` / `ctrl` / `alt` / `meta` are exposed in the engine's normalized event payload. After a blur clear, they're naturally false; on the next real keydown they re-populate from the DOM. Probably fine — but worth verifying when implementing.
- Touch and pen pointer state: on focus loss, do we synthesize a `pointerup` and a `pointerleave`? Touch sessions in particular are weird; the OS may aggressively cancel the gesture independent of focus.

**Trigger to revisit:** First demo where the consumer relies on `onKeyUp` for game logic (release-to-fire, charge-then-shoot, hold-to-aim then release-to-snap-back). The moving-triangle demo never observes the up edge, so the partial fix is enough for tranche 3.

**Reference:** Tranche 3 design spec, Section 2 — "Stuck-key handling" subsection. The held-state-clear-without-keyup compromise is documented there.
