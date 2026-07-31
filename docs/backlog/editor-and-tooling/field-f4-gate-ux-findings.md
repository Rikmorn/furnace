# Field F4 gate — UX findings (deferred to the polish stage)

> **F4.5a update (2026-07-30).** The **shell portion of this set has landed** — the
> overlay cockpit rebuilt the chrome these findings were filed against: one full-window
> canvas that nothing reflows, floating palettes, a single burger menu with a complete
> shortcut overlay, toasts + a durable message log in place of the panel status line, a
> world drawer with confirms on every destructive verb, and studio shading by default
> (`docs/reference/editor-architecture.md` §20). **The specifics below are still owed**
> and are still stage input: anything about a control's affordance, wording, feedback or
> gesture survived the rebuild unless it named a surface that no longer exists. This
> file is consumed at the F4.5 seal, not before — do not delete it.

Findings from the F4 Safari gate (2026-07-27) that are interaction-model work, not
mechanism bugs. Joins the sibling sets (`field-f2b-gate-ux-findings.md`,
`field-f3a-gate-ux-findings.md`, `field-f3b-gate-ux-findings.md`,
`editor-interaction-model-redesign.md`) as polish-stage charter input.

## 1. Selected-flag identification — the frame box is chunk-sized

Click-to-frame moves the camera, but in a cluster nothing says WHICH flag was
selected: the amber frame highlight boxes the flag's CHUNK (frameChunks), which is
enormous next to a 0.18 m marker, and the selected row has no viewport twin. The
user's direction (gate, verbatim intent): "directly clicking on something
highlights the right thing, instead of hundreds of entries in a menu" — i.e. the
primary selection surface should be the VIEWPORT (click a marker → select it,
panel row follows), with the list as the secondary channel. That is the same
pointer-tool direction the f3a set already carries; a cheaper interim is a
selected-marker emphasis (scale/tint pop) + a flag-cell-sized frame box instead of
the chunk AABB.

## 2. Gate item 1 was structurally unrunnable — world management, again

The "load a committed field world" step could not be driven: no world picker
exists, scratch worlds are gitignored-invisible, and the scene-open menu item is
locked in the field context ("the ui is very schizophrenic" — the user, again).
Root causes are ALREADY FILED across the W4/W3 findings and the sibling sets; this
entry adds only the datum that a GATE step was blocked by it. The quiet-by-default
property itself was accepted on the machine evidence (P-F4-3b: 0 pits in 12/12
walked configs, worst 3 candidates; camera-independent).

**Trigger to revisit:** the UX/polish stage charter (rides in with the sibling
sets).

**Reference:** `docs/reference/editor-architecture.md` §19 (markers, Flags panel,
frameChunks); the F4 seal entry in `docs/learnings/seal-log.md`.

## 3. The axis triad's snap tips are under the 24 px target-size minimum (F4.5b Task 6)

The corner triad became a control: six `<button>`s on the axis ends, calling
`FieldHost.snapView`. Their hit targets are **18 px** (the labelled +axis caps) and
**14 px** (the −axis caps), against the **24 px** minimum in WCAG 2.2 SC 2.5.8
(Target Size (Minimum)). This is not a slip — six tips share a 64 px box, so no
arrangement of them inside the current triad reaches 24 px. The exemption the SC
offers for "the target is in a sentence" does not apply.

The options are all UI decisions rather than fixes, which is why this is filed rather
than patched: grow the triad (it costs viewport corner, which D-1 protects), keep the
triad decorative and move the six views into a menu or the command palette T7 builds
(then the tips stop being controls and the SC stops applying), or accept the shortfall
as a redundant affordance ONCE a keyboard/menu route to the same six views exists —
which is the cheapest and is very likely what T7's action registry delivers anyway.

Note this is target SIZE only. The tips are otherwise accessible: real buttons, fixed
tab order, per-view `aria-label`, a hover ring and a `title`.

**Trigger to revisit:** the F4.5c polish stage, alongside T7's action registry — if the
registry exposes the six views, option three closes this at no cost.

**Reference:** `packages/editor/src/frontend/components/AxisTriad.tsx` (`HIT` /
`NEG_HIT`, and the comment that states the constraint); `docs/reference/editor-architecture.md`
§20.5.
