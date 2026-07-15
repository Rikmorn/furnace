# Field dig-tool feel — bite depth, embedded-eye carving, target preview

**Context.** Surfaced at the F1 Safari gate (2026-07-15). The v0 dig tool works but
authoring a standable space is hard, for three interacting v0 design choices (not bugs
— the executor pre-marked the feel as provisional, `field-host.ts:62` MIGRATION
comment):

1. **No bite offset.** A surface hit centres the dig sphere AT the hit point, so half
   of every stroke lands in already-open air — each click removes a shallow
   hemisphere-dish, which reads as "flat blobs". Candidate: centre at
   `hit.point + dir * (~0.7 × radius)` so a click takes a full-radius bite into rock.
2. **Embedded-eye carving is fixed-depth.** The fly camera is noclip; with the eye
   inside rock the tool digs at a constant `FIRST_DIG_DISTANCE_M` (4 m) ahead — depth
   never varies with aim ("the z axis seems the same"). Candidate: when embedded, carve
   from the eye forward (`origin + dir × ~radius`) so tunnelling-ahead feels like
   mining, not stamping a far plane.
3. **No target preview.** Nothing shows WHERE the next dig lands, so distance is
   unjudgeable while flying. Candidate: a ghost marker/ring at the computed dig centre
   every frame (frame.drawLines — the grid batch machinery is already in the host).
   This is the seed of F2's brush preview volume.

Also from the gate: default radius 0.75 m makes standable (≥ ~2 m clearance) spaces
many strokes of work — consider a larger default or a quick-size gesture (wheel already
nudges radius).

**Trigger to revisit:** the F2 "tools & materials" slice (brush chassis + palette —
these are its first feel requirements), or earlier if a later F1 gate round blocks on
them.

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`dig`,
`FIRST_DIG_DISTANCE_M`, the MIGRATION feel marker),
`docs/superpowers/specs/2026-07-14-epic3-one-field-charter-design.md` §5 (staged
preview / brush chassis), `docs/learnings/2026-07-15-one-field-f1-the-medium.md`.
