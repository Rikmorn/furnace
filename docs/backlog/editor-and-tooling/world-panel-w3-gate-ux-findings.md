# World panel: W3 phase-gate UX findings (six, deferred to 3.5 as a set)

**Context.** The W3 phase gate (2026-07-13) was passed — assemble → bake → walk — but
the user hit real assembly friction. None are mechanism bugs; all were observed live
during the gate. Deferred as a SET to 3.5 Curating (user decision at the seal:
no post-gate fix round; 3.5 owns assembly/curation depth).

1. **"no portal 0" error is unactionable.** `realizeWorldSpec`'s "start region X has
   no portal 0 to spawn at" doesn't say WHY (doors come from connectors — attach a
   region) or what to do. One-line message fix in `world-build.ts`.
2. **The panel never says the empty draft IS a new world.** The user went hunting for
   a "new world" menu/file facility and read the scene picker (document session) as
   the world list. An empty-state line in the panel fixes the mental model.
3. **The Add form reads as a picker, not a creator.** "attach to" listing existing
   regions invites "I can only pick existing ones"; the Add button sits at the bottom
   of a long field row.
4. **Attachments aren't editable after add.** A wrong portal offset costs a leaf-first
   subtree teardown (remove N regions, re-add N). Minimum: pre-validate the parent
   door at Add time; better: editable portal fields on the region row.
5. **Form defaults produce a REFUSED world.** Parent offset default 2 + the default
   pillarHall preset = door lane dead on a colonnade row → stamp-time throw. Defaults
   that fail the happy path are a trap (offset 3 threads every preset's pillar rows).
6. **Generate on an unfinished draft reads as a dead end.** The red failure gives no
   hint that assembling more regions is the fix (same root as 1).

**Trigger to revisit:** the 3.5 Curating brainstorm (it owns the World panel's
curation/assembly depth; fold these into its spec as day-one requirements).

**Reference:** W3 seal (docs/learnings/seal-log.md), the W3 gate conversation;
related entries: now absorbed below — see the *Related polish items (absorbed
2026-07-23)* section.

## Related polish items (absorbed 2026-07-23)

Three adjacent World-panel polish entries, folded in here during the 2026-07-23
backlog consolidation. Like the six findings above, all three are **F4-recharter
input** — they belong to the next World-panel UX / curation pass. **Caveat:** the
World panel itself retires at F6; if these are not addressed by then, they die with
it. Each entry's original content is preserved below.

### World panel: Add region disables itself without saying why

The World panel's Add-region form
(`packages/editor/src/frontend/components/world-panel/AddRegionForm.tsx`) disables the Add
button whenever the selected parent/child algorithm pair has no legal connector — i.e. when
`legalKinds(parent, child)` returns `[]`. That gate is correct (W3 plan refinement 2: a grid
child cannot hang off a cave parent, because the collar must ride the connector's a-end while
derivation only places b-ends), but it is **mute**: the button greys out and nothing on screen
says the pair is illegal or what would be legal instead.

This is reachable on first run. The form's default algorithm is `hall`, so on a draft whose
only region is a cave anchor, the panel opens with Add already disabled — the first thing a
new user meets is a dead button with no explanation. The W3 review closed the *stale-parent*
path into this state (an unknown `parentId` now falls back to the first region), but the
legality gate itself remains unexplained.

Fix: surface the reason where the gate fires — either a line under the form
(`no connector can join cave → hall — attach grids to grids, or hang a cave off either`) or by
disabling the illegal *algorithm* options against the chosen parent rather than the submit
button. The `ReasonTip` wrapper added in the W3 review (a `<span title>` around a disabled
control, since shadcn `Button` sets `disabled:pointer-events-none`) is the cheap version. The
better version is a real affordance, which is UI surface W3 did not spec.

**Trigger to revisit:** the 3.4 / 3.5 World-panel polish pass — or the first time someone
opens the panel, adds a cave, and reports that Add is broken.

**Reference:** `packages/editor/src/frontend/components/world-panel/AddRegionForm.tsx`;
`legalKinds` in `packages/editor/src/frontend/lib/world-draft.ts`.

### World-panel number fields: clearing a knob snaps it to 0

Every numeric knob in the World panel (hall `w/h/d`, maze `cells x/z` + `braid`, cave
`mouths`, portal `offset`/`mouth`, corridor `length`/`rise` — eight call sites) parses its
input through `num()` in
`packages/editor/src/frontend/components/world-panel/fields.tsx`. `<input type="number">`
reports `""` for anything it cannot parse (including a lone `-` mid-typing), and
`Number("") === 0` — which is finite — so **clearing a field sets the knob to 0** rather
than restoring the previous value, and `num`'s `fallback` argument is very nearly dead
code. A 0-cell axis fails loud at stamp time, so this is a UX wart, not a correctness hole,
but it makes editing a knob by select-all-and-retype feel hostile.

The real fix is a shared `NumberField` that buffers the raw string in local state and
commits only on a valid parse (or on blur), keeping the draft numeric while the input is
mid-edit. That is a new shared abstraction — a design decision, not a mechanical fix — and
it would also collapse the eight duplicated numeric-input blocks and the repeated label
scaffolding the panel currently spells out by hand.

**Trigger to revisit:** the next World-panel UX pass (3.4 seeing / 3.5 curating), or the
first time someone reports a knob snapping to 0.

**Reference:** `packages/editor/src/frontend/components/world-panel/fields.tsx` (`num`'s
TSDoc states the actual behaviour).

### World-panel a11y: region knob labels are ambiguous across rows

Each `RegionRow` in the World panel
(`packages/editor/src/frontend/components/world-panel/RegionRow.tsx`) labels its knobs with
bare names — `mouths`, `cells x`, `braid`, `w (cells)`. With two caves in the draft there are
two fields labelled `mouths` and nothing in the accessible name says which region owns which:
a screen-reader user tabbing through hears the same label twice. The seed field dodges this by
hand (`{r.id} seed`), which is the tell — the row, not the field, is what needs the context.

Fix: wrap each row's body in a `<fieldset>` with `<legend>{r.id} ({r.algorithm})</legend>`.
AT then announces the legend as part of every contained control's context, the visual header
the row already renders becomes the legend (no duplication), and `{r.id} seed` can drop back
to plain `seed`. It is a small restructure of the row's markup plus a Tailwind pass on
fieldset's default border/padding, so it wants to ride a deliberate polish pass rather than a
hardening commit.

**Trigger to revisit:** the 3.4 / 3.5 World-panel polish pass.

**Reference:** `packages/editor/src/frontend/components/world-panel/RegionRow.tsx`.
