# Fill tool: solid-volume semantics surprise at large sizes (+ the QoL register)

**Context.** Surfaced at the F2a Safari gate (2026-07-16). The Fill effect is a solid
volumetric fill by design — everything inside the (snapped, for kit classes) box becomes
solid material. At small sizes this reads as "place a block"; at large sizes (default
radius 1.25 → 2.5 m cube; max radius → 8 m cube) filling inside a cave *replaces cave
volume with solid masonry*, which reads as deletion: "it deleted the portion of the cave
and left the masonry at the edges of a split cave." Not a bug — a mental-model break.
Undo recovers cleanly (one ⌘Z per fill).

Candidates (F2b brush-chassis work):
1. **Stamps are the real answer** — "add a masonry structure" wants a hollow hall/room
   with an interior, which is exactly the F2b staged stamp generators. Ship those first.
2. **Hollow/shell fill mode** — fill only the boundary band of the box, leave the inside
   air (a cheap effect variant on the chassis).
3. **Louder ghost for kit fills** — render the snapped box ghost FILLED (translucent
   solid, not just edges) so "this entire volume becomes rock" is visible pre-click;
   and/or a tighter default size cap for kit fills.

The user also flagged a general appetite: "there's a lot of quality of life i would like
to do around this" — treat this entry as the seed of the F2b feel/QoL requirements list,
the way `field-dig-tool-feel.md` (resolved in F2a Task 11) seeded F2a's.

**Trigger to revisit:** the F2b "the palette" slice (brush chassis + stamps).

**Reference:** `packages/editor/src/frontend/lib/field-brush.ts` (`snappedKitBox`),
`packages/editor/src/viewport-host/field-host.ts` (tool application + ghost),
spec §3 of `docs/superpowers/specs/2026-07-15-epic3-one-field-f2-tools-and-materials-design.md`
(local, gitignored).
