# World-panel a11y: region knob labels are ambiguous across rows

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
