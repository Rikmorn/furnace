# The studio key light blows out geometry close to the camera

Rock within a metre or two of the eye reads white under studio shading — the same blowout the
camera-eye headlamp had before it, which is expected rather than surprising: the rig is
byte-identical, a light carried at the eye with no distance falloff tuned for close range.

## Context

Observed by the user at the F4.5 holistic gate, alongside the verdict that the P5 premise —
"studio lighting reads on dig-heavy terrain" — **PASSED**. So this is a tuning note on a
feature that works, not a defect that would have failed the gate, and it was deliberately not
taken into the fix round: light tuning wants the user live in front of the viewport, and a
value picked by an agent against a headless capture is a value picked against the wrong
instrument.

The knobs are all in one place (`sceneLights` in `field-render.ts`, the studio rig's home
since T3d — the key light's intensity,
its offset from the eye, and the hemisphere fill's contribution). What makes it a decision
rather than a number is that dimming the key for near geometry costs the far read the mode
exists for; a distance falloff or a small eye offset are the two shapes that do not.

Do not confuse this with the P5 fallback: cavity / AO / matcap shading was the charter's
stop-condition answer if studio shading had read FLAT, and it did not, so that entry was
never filed. Its trigger still stands — this one is about a rig that works being too bright
up close.

**An agent sees it too, since foundations T4c (2026-08-10) — and that sharpens the entry's own
argument rather than changing its verdict.** `viewport.capture` composes through the same
`sceneLights()` rig, on purpose (a capture that lit differently from the viewport would be a
worse verifier than no capture at all — `docs/research/2026-08-09-viewport-capture-technique.md`).
So an agent photographing near-camera geometry gets the same white rock a human does, and may
well report it as a defect in the world rather than in the lighting. Two consequences, neither
of them a reason to take this now: the note is now **agent-visible without being
agent-fixable** — the sentence above ("a value picked by an agent against a headless capture is
a value picked against the wrong instrument") holds exactly as written, and the capture is that
wrong instrument; and the cheapest mitigation is a caller-side one that costs nothing here —
capture from a named pose rather than `user` when the subject is close, since a named view
keeps the human's framing and moves only the angles.

## Trigger to revisit

**It bothers the user in real use** — i.e. the next time it is mentioned unprompted. Cheap to
take then, because the fix is a value the user can watch move. *(An agent reporting it does not
count: see the T4c note above — the instrument is the problem, not the rig.)*

## Reference

- `packages/editor/src/field-host/field-render.ts` — the studio rig (`sceneLights`: key
  light + hemisphere fill, now there); the shading-mode switch remains `field-host.ts`'s
  `setShading` facade.
- `docs/reference/editor-architecture.md` §16.5 (studio shading as the default and why the
  advisor's markers stay unlit under it).
- The F4.5 charter's premises table, P5 — the passed premise and the fallback that therefore
  was not filed.
