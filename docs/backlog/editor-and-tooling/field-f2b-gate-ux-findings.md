# Field F2b gate — deferred UX findings (the set), slotted F3/F4

> **F4.5a update (2026-07-30).** The **shell portion of this set has landed** — the
> overlay cockpit rebuilt the chrome these findings were filed against: one full-window
> canvas that nothing reflows, floating palettes, a single burger menu with a complete
> shortcut overlay, toasts + a durable message log in place of the panel status line, a
> world drawer with confirms on every destructive verb, and studio shading by default
> (`docs/reference/editor-architecture.md` §20). **The specifics below are still owed**
> and are still stage input: anything about a control's affordance, wording, feedback or
> gesture survived the rebuild unless it named a surface that no longer exists. This
> file is consumed at the F4.5 seal, not before — do not delete it.

**Context.** The F2b "the palette" Safari gate (three rounds, 2026-07-17→21) rejected
two mechanisms outright — fixed in-slice (drawLines-on-MSAA core bug; Field panel
layout crush) — and produced this deferred set, kept together deliberately (the W3
precedent: piecemeal polish dilutes). User direction at the gate: ship features now,
"look at ui holistically" later. Slotting agreed with the user 2026-07-21:

**→ F4 ("seeing" — recommend rechartering it as *seeing & the cockpit pass*, folding
the standing editor-UX debt: `editor-interaction-model-redesign.md` + this set; the
world-panel set that stood beside them was resolved at F4.5a — its surface is gone and
its one live finding moved to `dungeon/world-spec-no-portal-error-is-unactionable.md`):**

1. **Selection feedback overhaul** — flood selections render only an AABB outline; a
   truncated 200k-cell flood in an open world encloses the camera (invisible from
   inside). Wants cell/chunk-level display — exactly F4's flags-UI surface-tinting
   machinery ("cell-level highlight is F4-adjacent" was the executor's v0 acceptance).
   Box-select got a live preview in-slice; the gesture still reads "a bit odd" — fold
   ergonomics into the same pass.
2. **Status-bar / messaging IA** — count+truncation live in small footer text; tool
   errors share one line; "yet another bar" verdict. In-viewport messaging wants a
   designed home.
3. **Swatch/tool coupling** — material swatches stay active under Dig (which ignores
   material); reads as broken.
4. **Editor AA control** — the FieldHost is fixed `sampleCount: 4`; user: "this being
   an editor i don't think we need the AA always on, more of a controls gap." An AA
   view-flag (needs context re-init or a re-request path — small design question), now
   with a real perf angle: line overlays cost per-pass MSAA resolves (see
   `drawlines-pass-batching.md`).
5. **Entity-highlight discoverability** — clicking an entities row highlights its
   region, but nothing teaches it; user never found committed stamps ("i don't really
   know where they are").
6. **Nudge focus trap** — clicking a nudge button moves focus into the controls scroll
   container; arrow keys then scroll instead of nudging (keydown is canvas-bound).
   User hit it live ("keyboard didn't seem to work, buttons were fine"). Small fix:
   refocus the canvas after nudge-button clicks, or lift the key handling.
   **⌘Z has the identical failure mode and now has a seam ready for it** (F3a):
   field undo/redo is canvas-bound too, so the same lost focus silently disables it.
   `FieldHost.undo()` / `.redo()` exist for exactly this fix — a panel affordance (or
   whatever refocus/lift approach wins) should call them rather than re-deriving the
   step. They have no production caller until then, deliberately, in the same sense as
   `editor-chrome-authoring-gaps.md` § *`GenerationWorkerClient.cancel()` has no production caller*.

**→ F3 (placement pain — mostly already-chartered features):**

7. ~~**Stamp-vs-selection mismatch**~~ — **RESOLVED in F3a (2026-07-23):** size params
   now derive from the active selection's extent (`deriveSizeDefaults`, clamped to
   schema bounds; region-fills-selection rejected — legal sizes are quantized),
   quarter-turn `rotation` + per-wall door offsets shipped on both stamp schemas, and
   the entity highlight boxes the stamped FOOTPRINT rather than the recorded region.
   The two-point tunnel brush shipped in F3b (spec D-F3-14) as the `segment`
   gesture; only its box cross-section stayed deferred
   (`field-tool-follow-ons.md` § *Segment brush: a BOX cross-section*).

8. **Esc does not cancel a pending BOX-select anchor** — surfaced while wiring the
   segment brush's own Esc (F3b Task 13, 2026-07-25), which DOES drop its pending
   anchor. The box gesture's only way out of a half-drawn region is to re-arm the mode
   from the palette. The fix is the same one-liner in `onKeyDown`, deliberately not
   folded into that task: it changes an existing gesture's key handling, and item 1
   above already owns "box-select ergonomics" for the same pass.

9. **A pending segment capsule does not re-fatten on a radius change** (F3b Task 13) —
   `updateSegmentPreview` rebuilds its line batch on pointer MOVE, so turning the wheel
   or pressing `[` / `]` with a still cursor leaves the previewed capsule at the old
   radius until the pointer twitches. The plain brush ghost has no such gap: it is
   rebuilt per frame from `ghostState()`. Fixing it means either moving the capsule
   batch into the frame path (the cost the stored batches exist to avoid) or rebuilding
   it from the radius setters as well. Inline note at `field-host.ts`
   (`updateSegmentPreview`).

10. **An armed-but-unanchored Segment shows no cursor affordance at all** (F3b Task 13)
    — the sphere ghost is suppressed for every armed gesture (mode coherence: LMB will
    not stamp a sphere), and the capsule preview only exists once a first point is
    clicked, so between arming and the first click there is nothing on screen
    indicating where the segment will start or how thick it will be. This follows the
    box gesture's precedent exactly, which is why it shipped as-is; both are item 1's
    "the gesture still reads a bit odd". A start-point ring at the cursor is the
    obvious candidate. Inline note at `field-host.ts` (`renderScene`'s ghost gate).

**Trigger to revisit:** the F4 recharter (items 1–6; joined by
`field-f3a-gate-ux-findings.md`).

**Reference:** F2 spec §3 + §3.7 (local/gitignored); seal-log F2b entry;
`docs/learnings/2026-07-21-invisible-line-overlays.md`;
`packages/editor/src/frontend/components/field/*`, `viewport-host/field-host.ts`.
