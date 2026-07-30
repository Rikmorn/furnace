# `gizmo.ts` and `camera-control.ts`'s orbit family have no caller

Two modules under `packages/editor/src/viewport-host/` survived the F4.5a deletion sweep
with **zero production consumers**. Both are pure math, both are well tested, and both
were left standing on purpose rather than by oversight — this entry is what makes that a
decision instead of rot.

**`viewport-host/gizmo.ts`** — the translate gizmo's pure core (`pickAxis`,
`closestPointParamOnAxis`, the `Ray`/`Axis` types). Its own docblock still names the
scene viewport host as its driver; that host is deleted. It is **not re-exported from
`viewport-host/index.ts`** and nothing in `src/` imports it. Only
`tests/viewport-host/gizmo.test.ts` reads it.

**`viewport-host/camera-control.ts`'s `orbit` / `zoom` / `dolly` / `pan` /
`fromEyeTarget`** — `field-host.ts` imports exactly `flyLook`, `flyMove`, `toEyeTarget`
and the `OrbitState` type from this module. The other five exports are read only by
`tests/viewport-host/camera-control.test.ts`. The field host has a **fly** camera, not an
orbit one; there is no MMB pan and no scroll-dolly in the editor today.

The case for keeping them is that F4.5b is the slice most likely to want both — entity
manipulation wants a gizmo, and "frame the selection" / a proper orbit mode are standing
gate-UX requests (`field-f3a-gate-ux-findings.md` item 1 asks for mouse-driven region
moves and names the M5B gizmo as in-repo prior art). Deleting tested math a named next
slice is likely to re-derive is the wrong trade.

The case against is the deletion-pass rule and the precedent set in the same task:
`lib/theme.ts` was kept as a "Task 9 will want it" orphan across the whole slice, was
never wanted, and was deleted at Task 13. **Test-only-consumed code is a standing claim
about the future, and the claim has been wrong before.**

Not decided here because the answer depends on F4.5b's actual scope, which is not
chartered yet. Whichever way it goes should be one decision covering both, since they are
the same class.

**Trigger to revisit:** the F4.5b charter settles whether entity manipulation and camera
framing are in scope. If either is, promote the module into the design. If F4.5b closes
without touching them, delete both (git has the history, and the tests document the
contract if it is ever rebuilt).

**Reference:** `packages/editor/src/viewport-host/gizmo.ts`,
`packages/editor/src/viewport-host/camera-control.ts`;
`docs/reference/editor-architecture.md` §11 (the deleted surface that drove the gizmo) and
§20 (the field host's actual camera).
