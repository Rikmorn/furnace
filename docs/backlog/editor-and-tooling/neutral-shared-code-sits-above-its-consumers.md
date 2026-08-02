# Two layering back-edges: `ui/` reaching app chrome, and `viewport-host/` reaching `frontend/lib/`

Two independent places where a lower layer imports UP into a higher one. Same verdict in
both — the shared thing belongs in a neutral module, not in the consumer that happens to own
it today — so they are filed together and would be fixed the same way.

## 1. `components/ui/segmented.tsx` → `components/tips.tsx`

`components/ui/` is the control library: D-24 makes it the one place a raw `<input>` or
`<select>` may be written, and the rule only means something if the directory is a LEAF.
Every other file in it imports from `../../lib/` and nothing else. `ui/segmented.tsx`
imports `../tips.tsx` — app-layer chrome, which itself imports `./ui/tooltip.tsx`.

No cycle today, because `tips.tsx` pulls `ui/tooltip.tsx` rather than `ui/segmented.tsx`.
What it costs is a footgun the type cannot express: `Segmented`'s `hint` prop is optional,
and supplying one outside a `TooltipProvider` makes `ActionTip` throw. A control-library
component that throws depending on where it is mounted is not a leaf.

The fix is to move `ActionTip` (and the rest of the tooltip trio) into `frontend/lib/` or a
neutral `components/tips/` that `ui/` may depend on — F4.5c Task 8 already moved this trio
once, out of `components/field/` and into `components/tips.tsx`, so this is finishing that
move rather than starting a new one.

## 2. `viewport-host/` → `frontend/lib/`

`viewport-host/` is the engine-facing half of the editor and `frontend/` is the React half;
the import arrow is supposed to run frontend → viewport-host. Four files reverse it, across
ten import statements reaching eight distinct modules:

| importer | modules it reaches in `frontend/lib/` |
| --- | --- |
| `field-host.ts` | `analyzer-client`, `catalog`, `field-brush`, `field-client`, `field-entity`, `field-protocol`, `field-size` |
| `field-placements.ts` | `catalog` |
| `field-flags.ts` | `analyzer-protocol` |
| `field-move.ts` | `field-brush` |

Every one of the eight is neutral — protocol types, a catalog reader, brush geometry, a
size derivation. None is React. They live under `frontend/lib/` because that is where they
were first needed, not because they belong to the frontend, and the arrow they create means
`viewport-host` cannot be read as the lower layer even though it is one.

## Context

Both were noticed during F4.5b/c reviews and both were left because a directory move is a
diff nobody can review alongside a behavioural change. Neither is urgent: the code is
correct and the tests pass. What they cost is that "which way do imports run here?" has no
answer a newcomer can rely on, and each new shared module gets placed by precedent.

## Trigger to revisit

A CYCLE appearing — `ui/` reaching anything that reaches `ui/segmented.tsx`, or a VALUE
import from `frontend/lib/` into `viewport-host/` (the one edge there today,
`lib/engine.ts:1`, is type-only and erased, so it closes no loop) — which turns a
readability problem into a bundler problem; or the next task whose scope is already a move
(an extraction, a rename pass), which is the only kind of commit these belong in.

## Reference

- `packages/editor/src/frontend/components/ui/segmented.tsx:22` — the one import out of
  `ui/` that does not go to `lib/`; `components/tips.tsx` is the target.
- `packages/editor/src/viewport-host/field-host.ts`, `field-placements.ts`,
  `field-flags.ts`, `field-move.ts` — the four importers in the table above.
- `packages/editor/scripts/one-control-library.grit` — the D-24 rule whose scope claim
  (`components/ui/` is where these elements are ALLOWED to be written) assumes the
  directory is a leaf.
