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
>
> **F4.5b update (2026-08-01).** F4.5b "the hands" closed items 2, 3 and 5 outright and
> item 6 by half; each carries a dated note naming the source that lands it. Item 4 was
> closed at F4.5a and is annotated for the same reason. Items 1 and 6 are the two that
> are PART landed — read their notes for which half is still owed.

**Context.** The F2b "the palette" Safari gate (three rounds, 2026-07-17→21) rejected
two mechanisms outright — fixed in-slice (drawLines-on-MSAA core bug; Field panel
layout crush) — and produced this deferred set, kept together deliberately (the W3
precedent: piecemeal polish dilutes). User direction at the gate: ship features now,
"look at ui holistically" later. Slotting agreed with the user 2026-07-21:

**→ F4 ("seeing" — recommend rechartering it as *seeing & the cockpit pass*, folding
the standing editor-UX debt: `editor-interaction-model-redesign.md` + this set; the
world-panel set that stood beside them was resolved at F4.5a — its surface is gone and
its one live finding moved to `dungeon/world-spec-no-portal-error-is-unactionable.md`):**

1. **Selection feedback overhaul** — ✅ **the DISPLAY half landed 2026-08-01 (F4.5b
   Task 13)**; the gesture-ergonomics half stands. A `cells` materialization now draws
   one translucent `--primary` cube per selected cell (`field-selection-cells.ts` +
   the host's instanced layer), so a flood the camera is standing inside reads as a
   shape instead of as an outline nobody can see from within. SHELL-FIRST and capped at
   `SELECTION_DISPLAY_CAP = 65 536`: cells with all six face neighbours selected are
   buried and are the first thing the cap discards, and an over-cap draw says so
   through `SelectionInfo.displayed` (the status chip prints "showing 65,536 of N
   cells"). Region selections keep the honest AABB box — a region IS its box.
   Measured: 26–34 ms to enumerate a 196 608-cell flood, on a click-time rebuild.
   STILL OWED from this item: the box-select gesture that "reads a bit odd". Tasks 8–9
   made that gesture LEGIBLE without changing it — the status line now reads `click ×2
   spans a region` (`armedKeymap`, `shell/StatusBar.tsx`) and an un-anchored corner
   draws a cross at the cursor (`cursorAffordance`, `viewport-host/viewport-cursor.ts`)
   — but the MECHANISM is untouched: `boxAnchor` is set on the press and `onPointerUp`
   has no region branch, so press-drag-release is still not a box select.
2. **Status-bar / messaging IA** — count+truncation live in small footer text; tool
   errors share one line; "yet another bar" verdict. In-viewport messaging wants a
   designed home.

   **LANDED 2026-08-01, in two parts.** The designed home arrived at F4.5a:
   `frontend/lib/notify-store.ts` + `shell/Toasts.tsx` + `shell/LogPalette.tsx` are the
   toast/durable-log pair, and every host refusal routes there rather than sharing one
   footer line (`hooks/useFieldHostState.tsx` bridges `host.subscribeToolError` straight
   into `notify.error`).
   F4.5b Task 13 moved the last of that footer text onto the status bar as a CHIP —
   `SelectionChip` in `shell/StatusBar.tsx` prints `sel N cells`, and its popover
   separates the two limits the old line ran together: "flood truncated at N cells" (what
   was SELECTED) versus "showing N of M cells" (what is DRAWN, the Task-13 display cap).
   Clear and Reselect render from the action registry, so the chip cannot offer a verb the
   Edit menu does not. There is still A BAR — the 28 px status bar is part of D-1's shell
   budget rather than an extra one — so what was answered is "a designed home", not the
   bar count.
3. **Swatch/tool coupling** — material swatches stay active under Dig (which ignores
   material); reads as broken.

   **LANDED 2026-08-01 (F4.5b Task 8).** The dead control is gone by construction:
   `TOOL_OPTIONS` in `frontend/components/shell/tool-params.tsx` declares the param list
   PER EFFECT — `dig: ["radius", "mask"]`, `smooth` with no material at all, and
   `material` only under `fill` and `paint` — and that ONE table feeds both surfaces that
   render params (the top strip and its ⋯ popover), so the swatches cannot reappear under
   Dig in one of them. `availableParams` drops the material param again when the project
   catalog holds fewer than two classes.
4. **Editor AA control** — the FieldHost is fixed `sampleCount: 4`; user: "this being
   an editor i don't think we need the AA always on, more of a controls gap." An AA
   view-flag (needs context re-init or a re-request path — small design question), now
   with a real perf angle: line overlays cost per-pass MSAA resolves (see
   `drawlines-pass-batching.md`).

   **LANDED at F4.5a (2026-07-30) — recorded here 2026-08-01 because this item names a
   control gap the shell rebuild actually closed, and an unmarked item reads as owed.**
   `hooks/useView.tsx` carries `sampleCount: 1 | 4` with a `setSampleCount` action,
   `shell/ViewPopover.tsx` renders it as an `antialiasing` checkbox, and
   `shell/CanvasHost.tsx` re-inits the GPU context when it changes — which is the
   "context re-init" half of the design question this item raised, answered rather than
   avoided. Deliberately NOT persisted: a cold start is always AA-on. The perf angle is
   untouched and still stands on its own entry
   (`docs/backlog/engine-architecture/drawlines-pass-batching.md`).
5. **Entity-highlight discoverability** — clicking an entities row highlights its
   region, but nothing teaches it; user never found committed stamps ("i don't really
   know where they are").

   **LANDED 2026-08-01 (F4.5b Tasks 3, 4 and 6).** The editor now BOOTS with the pointer
   armed (`gesture = "pointer"` in `viewport-host/field-host.ts`), so the first click a
   user makes on a committed stamp selects it — the default arm is the teaching. The
   selection is ONE fact across two surfaces (`subscribeEntitySelection`): a viewport pick
   styles the Entities row and scrolls it into view
   (`components/field/EntitiesList.tsx`), and a row click writes the same state and draws
   the viewport box — `highlightEntity` was retired at Task 3 and the box follows
   SELECTION now. `F` then flies to it: `frameSelection` fits the selected entity's
   stamped footprint. "I don't really know where they are" has a verb.
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

   **PARTLY LANDED 2026-08-01 (F4.5b Task 7) — the ⌘Z half; the ARROW half stands.**
   Landed: the action registry (`frontend/lib/actions.ts`) declares `edit.undo` /
   `edit.redo` and runs them as `ctx.host.undo()` / `.redo()` from a WINDOW listener
   (`hooks/useGlobalKeybindings.ts`), which has no focus hole — so the twins this item
   reserved the seam for now have their production caller, and `session.escape` /
   `session.confirm` got the same lift for the same reason — `FieldHost.undo`'s TSDoc
   cites THIS file by path, `escape`'s names "the standing F2b finding", and
   `confirmSession`'s makes the same focus argument for a grab started from a menu.
   Stands: the ARROWS are canvas-only BY DESIGN — the ownership rule at the top of
   `actions.ts` keeps viewport-steering keys on the canvas, `arrowNudgeSteps`
   (`viewport-host/input-map.ts`) is read only from the canvas keydown in
   `field-host.ts`, and no registry action claims an arrow. The nudge d-pad, now inside
   the session card's Advanced disclosure
   (`shell/session-card/AdvancedSection.tsx`), still does not refocus the canvas after a
   click, so the original symptom reproduces verbatim. What changed AROUND it: arrows are
   no longer the primary way to move a region (Task 5's drag / `G` grab — see
   `field-f3a-gate-ux-findings.md` item 1).
   *Correction to the text above:* the sibling section it cites is gone —
   `editor-chrome-authoring-gaps.md` no longer has a `GenerationWorkerClient.cancel()`
   entry, because the generation worker was deleted with the world-assembly surface at
   F4.5a. The analogy is dead; the point it made (a seam kept deliberately caller-less)
   is what this item's landing above discharges.

**→ F3 (placement pain — mostly already-chartered features):**

7. ~~**Stamp-vs-selection mismatch**~~ — **RESOLVED in F3a (2026-07-23):** size params
   now derive from the active selection's extent (`deriveSizeDefaults`, clamped to
   schema bounds; region-fills-selection rejected — legal sizes are quantized),
   quarter-turn `rotation` + per-wall door offsets shipped on both stamp schemas, and
   the entity highlight boxes the stamped FOOTPRINT rather than the recorded region.
   The two-point tunnel brush shipped in F3b (spec D-F3-14) as the `segment`
   gesture; only its box cross-section stayed deferred
   (`field-tool-follow-ons.md` § *Segment brush: a BOX cross-section*).

8. ~~**Esc does not cancel a pending BOX-select anchor**~~ — **RESOLVED in F4.5b Task 7
   (2026-07-30):** the cancel ladder (`escapeLadder`, D-12) took it as rung one, and it
   clears BOTH pending anchors rather than only the armed gesture's — so the box and the
   segment answer Esc the same way, from the canvas binding and from the app-level
   `escape()` verb alike. Task 9 added the pending stamp ARM as its own sub-rung behind
   the anchors.

9. ~~**A pending segment capsule does not re-fatten on a radius change**~~ —
   **RESOLVED in F4.5b Task 9 (2026-07-31):** the second option, and it needed a split
   rather than a move. The RAYCAST is what made the rebuild a pointer-MOVE job, so the
   resolved far endpoint is now stored (`segmentPreviewEnd`) and the batch built from it
   by `rebuildSegmentPreview` — cheap enough to run from the radius paths, which all
   became one funnel (`applyRadius`, shared by `setDigRadius`, the wheel and `[` / `]`).
   **No automated guard covers the rebuild**: the batch is write-only overlay state with
   no seam, the same gap `gizmoVisible` was disclosed under in Task 5.

10. ~~**An armed-but-unanchored Segment shows no cursor affordance at all**~~ —
    **RESOLVED in F4.5b Task 9 (2026-07-31):** the ring shipped for the segment, and the
    box got a DIFFERENT mark rather than the same one. A box corner has no radius, so a
    radius-sized ring there would advertise a brush width that decides nothing about
    what the click does; it shows a ghost of the anchor CROSS the click is about to
    leave instead. The decision table is pure (`cursorAffordance` in `field-ghost.ts`)
    and exhaustively pinned; the DRAWING of it, like item 9's rebuild, has no seam.
    Colour follows the mark, so neither changes colour when the click lands.

**Trigger to revisit:** the F4 recharter (items 1–6; joined by
`field-f3a-gate-ux-findings.md`). Items 7–10 are all resolved; the file stays for
items 1–6 and is consumed at the F4.5 seal.

**Standing balance after F4.5b (2026-08-01):** items 2, 3, 4 and 5 are landed; what is
still owed out of this set is the box-select GESTURE (item 1's second half) and the
arrow-nudge focus trap (item 6's second half). The file still deletes at the F4.5 seal,
not before.

**Reference:** F2 spec §3 + §3.7 (local/gitignored); seal-log F2b entry;
`docs/learnings/2026-07-21-invisible-line-overlays.md`;
`packages/editor/src/frontend/components/field/*`, `viewport-host/field-host.ts`.
