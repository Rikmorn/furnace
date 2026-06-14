# Relative-pointer / pointer-lock mechanism in `core/input`

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
