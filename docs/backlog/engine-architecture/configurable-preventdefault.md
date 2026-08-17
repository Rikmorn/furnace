---
summary: the engine hands consumers normalized event snapshots rather than live DOM events, so nothing can suppress page scroll, the context menu or browser shortcuts once furnace is embedded in a real page
---

# Configurable `preventDefault` for tracked input events

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
