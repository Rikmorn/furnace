# `camera-control.ts`'s orbit family has no caller

**RESOLVED for the gizmo half (F4.5b Task 5, 2026-07-31): `viewport-host/gizmo.ts`
is PROMOTED.** The trigger below fired the way the "keep it" case predicted —
F4.5b chartered entity manipulation, and the field host's translate gizmo now
calls `pickAxis`, `closestPointParamOnAxis`, `isViewParallel`, `gizmoSpan` and
`axisLines`. The module gained the handle GEOMETRY at the same time (span
derivation + the line batch), so the drawn arm and the pickable arm come from one
derivation, plus an `innerLen` dead zone at the origin. `field-move.ts` and
`field-host.ts` both import it; it is still deliberately not re-exported from
`viewport-host/index.ts` (the chrome has no business with handle math).

**Still open — `viewport-host/camera-control.ts`'s `orbit` / `zoom` / `dolly` /
`pan` / `fromEyeTarget`.** `field-host.ts` imports exactly `flyLook`, `flyMove`,
`toEyeTarget` and the `OrbitState` type from this module. The other five exports
are read only by `tests/viewport-host/camera-control.test.ts`. The field host has
a **fly** camera, not an orbit one; there is no MMB pan and no scroll-dolly in the
editor today.

The case for keeping them: "frame the selection" and a proper orbit mode are
standing gate-UX requests (`field-f3a-gate-ux-findings.md`).

The case against is the deletion-pass rule and the precedent set in F4.5a:
`lib/theme.ts` was kept as a "Task 9 will want it" orphan across the whole slice,
was never wanted, and was deleted at Task 13. **Test-only-consumed code is a
standing claim about the future, and the claim has been wrong before.** The gizmo
half is the counter-example — one of the two bets paid, which is the honest
scoreboard for this class of decision.

**Trigger to revisit:** F4.5b Task 6 owns the camera work and is where the orbit
family is either wired in or deleted. If F4.5b closes without touching it, delete
(git has the history, and `camera-control.test.ts` documents the contract if it is
ever rebuilt).

**Reference:** `packages/editor/src/viewport-host/camera-control.ts`;
`packages/editor/src/viewport-host/gizmo.ts` (the promoted half);
`docs/reference/editor-architecture.md` §11 (the deleted surface that drove the
gizmo, and the banner recording the promotion) and §20 (the field host's actual
camera).
