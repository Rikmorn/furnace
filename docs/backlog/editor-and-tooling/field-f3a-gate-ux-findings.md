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
2. **A plain pointer/select tool** — "a flat out pointer that let's me select entities
   and move it around": click a committed entity in-viewport to select it (highlight +
   open its inspector), and move = "regenerate over there" per charter L4. Ties to the
   F2b entity-highlight-discoverability item (5); GPU-id picking exists in the M5B
   viewport as precedent.
3. **Box/wand selection behaviour** — "behave oddly" (fresh confirmation of the F2b
   item-1 verdict on selection feedback + gesture ergonomics at this gate). Fold into
   the same selection-feedback overhaul rather than patching per-slice.

**Note for the F3b brainstorm:** if region authoring friction blocks the cave workflow
(picking/moving a cave's region), item 1 may be worth pulling forward into F3b rather
than waiting for F4 — decide there, don't default to it.

**Trigger to revisit:** the F4 recharter brainstorm (with the F2b set), or the F3b
brainstorm for the pull-forward question only.

**Reference:** F3 spec §2.4 (local/gitignored); `packages/editor/src/viewport-host/field-host.ts`
(stamp session, nudge seam, highlightEntity); `docs/reference/editor-architecture.md`
§M5B (gizmo + GPU-id picking precedents).
