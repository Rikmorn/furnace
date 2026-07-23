# Field F2b gate — deferred UX findings (the set), slotted F3/F4

**Context.** The F2b "the palette" Safari gate (three rounds, 2026-07-17→21) rejected
two mechanisms outright — fixed in-slice (drawLines-on-MSAA core bug; Field panel
layout crush) — and produced this deferred set, kept together deliberately (the W3
precedent: piecemeal polish dilutes). User direction at the gate: ship features now,
"look at ui holistically" later. Slotting agreed with the user 2026-07-21:

**→ F4 ("seeing" — recommend rechartering it as *seeing & the cockpit pass*, folding
the standing editor-UX debt: `world-panel-w3-gate-ux-findings.md` +
`editor-interaction-model-redesign.md` + this set):**

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
   `generation-cancel-has-no-caller.md`.

**→ F3 (placement pain — mostly already-chartered features):**

7. ~~**Stamp-vs-selection mismatch**~~ — **RESOLVED in F3a (2026-07-23):** size params
   now derive from the active selection's extent (`deriveSizeDefaults`, clamped to
   schema bounds; region-fills-selection rejected — legal sizes are quantized),
   quarter-turn `rotation` + per-wall door offsets shipped on both stamp schemas, and
   the entity highlight boxes the stamped FOOTPRINT rather than the recorded region.
   `field-two-point-tunnel-brush.md` still rides the F3b cave arc (spec D-F3-14).

**Trigger to revisit:** the F4 recharter (items 1–6; joined by
`field-f3a-gate-ux-findings.md`).

**Reference:** F2 spec §3 + §3.7 (local/gitignored); seal-log F2b entry;
`docs/learnings/2026-07-21-invisible-line-overlays.md`;
`packages/editor/src/frontend/components/field/*`, `viewport-host/field-host.ts`.
