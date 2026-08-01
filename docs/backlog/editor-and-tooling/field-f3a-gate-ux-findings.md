# Field F3a gate — deferred UX findings (the set), slotted F4

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
> **F4.5b update (2026-08-01).** F4.5b "the hands" closed item 2 outright and items 1
> and 3 by half; each carries a dated note naming the source that lands it, and the
> notes are precise about which half is still owed.

**Context.** The F3a "smart objects" Safari gate (2026-07-23) found two mechanism bugs —
fixed in-slice (⌘Z left the drift list standing; the entity highlight boxed the recorded
SELECTION region instead of the stamped footprint) — and this deferred set, kept together
per the W3/F2b precedent (piecemeal polish dilutes). User framing at the gate: "more ux
gaps … might be a backlog or maybe picked up in future stages."

**→ F4 recharter ("seeing & the cockpit pass" — joins `field-f2b-gate-ux-findings.md`
items 1–6 and `editor-interaction-model-redesign.md`; the world-panel set was resolved at
F4.5a — see the note above):**

1. **Mouse-driven region move** — the stamp/reconfigure session's nudge BUTTONS "aren't
   great, i think it should be mouse driven": drag the ghost/region in-viewport instead
   of (or beside) button/arrow nudges. Prior art in-repo: the M5B translate gizmo on
   scene entities. Interacts with the F2b nudge-focus-trap item (same surface).

   **PARTLY LANDED 2026-08-01 (F4.5b Task 5, D-F4.5-9) — the RECONFIGURE half; a CREATE
   session's region still moves by keys alone.** Landed: a committed entity is moved with
   the mouse. Press the already-selected entity and travel past `DRAG_THRESHOLD_PX` and
   it becomes a move; `G` grabs it with no button held; the translate gizmo's arms
   constrain to one axis; `R` turns it, `⏎` drops it, `Esc` reverts. A move IS a
   reconfigure — `beginMoveSession` opens the same session `openEntity` opens — and the
   cursor-to-lattice arithmetic is anchored rather than incremental
   (`viewport-host/field-move.ts`), so a cursor returned to the press point returns the
   region to where it started.
   Stands: `beginMoveSession` takes an `entityId` and `pointerPress` arms a drag only on
   the ALREADY-SELECTED committed entity, so a live CREATE session's ghost — the one this
   item was filed against, the stamp that has not been committed yet — cannot be dragged.
   Its region is set by the two region-draw clicks (Task 9) and thereafter moves only by
   the arrows or the card's d-pad, which still exists in
   `shell/session-card/AdvancedSection.tsx`.
2. **A plain pointer/select tool** — "a flat out pointer that let's me select entities
   and move it around": click a committed entity in-viewport to select it (highlight +
   open its inspector), and move = "regenerate over there" per charter L4. Ties to the
   F2b entity-highlight-discoverability item (5); GPU-id picking exists in the M5B
   viewport as precedent.

   **LANDED 2026-08-01 (F4.5b Tasks 3, 5 and 10, D-F4.5-9/13).** The `pointer` gesture is
   the editor's DEFAULT arm. A click ray-picks on the CPU (`viewport-host/field-pick.ts`)
   — entity footprints, placed props (which select their owning stamp, not themselves)
   and flag markers, arbitrated against a field raycast so a click cannot select through
   rock. The hit selects, outlines in the viewport, syncs the Entities row, and opens
   `shell/SessionCard.tsx` in its REST state on that entity's recipe — the "open its
   inspector" half, with the first control the user commits through promoting REST into a
   live reconfigure. Move is item 1's drag, i.e. "regenerate over there" through the
   reconfigure splice.
   Two deliberate divergences from the item's framing, both recorded in source rather than
   silently taken: the pick is CPU, not GPU-id (Task 0's probe — the host holds its context
   at `sampleCount: 4`, which `frame.renderToTexture` refuses, and the two things most
   worth picking are `drawLines` batches with no mesh at all); and because a CPU pick is
   affordable per CLICK and not per pointermove, there is no hover pre-highlight anywhere
   in the editor.
3. **Box/wand selection behaviour** — "behave oddly" (fresh confirmation of the F2b
   item-1 verdict on selection feedback + gesture ergonomics at this gate). Fold into
   the same selection-feedback overhaul rather than patching per-slice.

   **PARTLY LANDED 2026-08-01 — the FEEDBACK half (F4.5b Task 13, the same landing as
   `field-f2b-gate-ux-findings.md` item 1); the ERGONOMICS half stands.** A cell selection
   now draws one translucent cube per selected cell rather than an outline, so a flood the
   camera is standing inside reads as a shape. What did NOT change is the gesture: the box
   is still two separate clicks (`boxAnchor` on the press, no region branch in
   `onPointerUp`), and the wand/flood modes are one click each. Tasks 8–9 made all of them
   SAY what they are — the status keymap line names the armed gesture and an un-anchored
   corner draws a cross at the cursor — which is legibility, not the ergonomics call this
   item asks for.

**Note for the F3b brainstorm:** if region authoring friction blocks the cave workflow
(picking/moving a cave's region), item 1 may be worth pulling forward into F3b rather
than waiting for F4 — decide there, don't default to it.

**Trigger to revisit:** the F4 recharter brainstorm (with the F2b set), or the F3b
brainstorm for the pull-forward question only.

**Standing balance after F4.5b (2026-08-01):** item 2 is landed; what is still owed out
of this set is dragging a CREATE session's ghost (item 1's second half) and the
box/wand gesture ergonomics (item 3's second half). The note for the F3b brainstorm
above is spent — item 1 was not pulled forward into F3b; it landed in F4.5b instead, for
committed entities.

**Reference:** F3 spec §2.4 (local/gitignored); `packages/editor/src/viewport-host/field-host.ts`
(stamp session, nudge seam; `highlightEntity` was RETIRED at F4.5b Task 3 — entity
emphasis follows `subscribeEntitySelection` now, so grep that instead);
`docs/reference/editor-architecture.md` §11 (M5B — the gizmo + GPU-id picking precedents
this item cited; that section is itself marked superseded by §20, and F4.5b's field pick
went CPU rather than GPU-id, see item 2).
