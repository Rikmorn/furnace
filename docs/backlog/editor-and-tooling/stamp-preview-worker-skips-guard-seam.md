---
summary: `handleStampPreview` calls `def.evaluate` directly and hand-rolls the ctx pairing, skipping core's single `evaluateGenerator` guard seam — so the ctx rule has two spellings in two packages and `emits` has none on the preview side; blast radius is bounded, the fix is an a/b/c design choice
---

# The stamp-preview worker evaluates generators OUTSIDE core's guard seam

Surfaced by F4 Task 6 (`GeneratorDef.emits`, D-F4-15). Core has ONE evaluate seam,
`evaluateGenerator` (`packages/core/src/field/generators.ts`), which enforces both of a
`GeneratorDef`'s declarative facts before returning: `contextFree` (evaluate must get a
`ctx` when it reads the field) and now `emits` (the result must not carry a channel the
declaration forbids). `commitGenerator` and `reconfigureGenerator` both go through it, so
every path that puts a result into the op log is covered.

The editor's stamp preview does not. `handleStampPreview`
(`packages/editor/src/field-host/field-protocol.ts` ~:297) calls `def.evaluate(...)`
**directly** and hand-rolls the ctx pairing inline (`def.contextFree ? undefined : { store }`),
so it skips both guards. It cannot use the seam today: `evaluateGenerator` is deliberately
**not** on the public field index — it is in-core surface, reached from core's own tests only
by source path.

**Blast radius today is small and bounded:** preview writes to a scratch store and posts a
ghost mesh, never to the op log, so a lying def shows a wrong ghost and the subsequent commit
still throws setup-loud. The real cost is that the ctx rule now has **two spellings in two
packages** — core's guard and the preview's inline conditional — which is the parallel-path
smell, and `emits` has none on the preview side at all.

Fixing it is a design decision, not a mechanical edit: either (a) promote `evaluateGenerator`
to the public field index (new public API surface — and the current comment says its
in-core-ness is intentional), or (b) give core a preview-shaped public entry point that wraps
the seam, or (c) accept the duplication and pin the preview's ctx conditional with a test that
fails when core's rule changes.

**Trigger to revisit:** the next task that touches `handleStampPreview`'s evaluate call or
adds a third `GeneratorDef` declarative fact — a third fact makes the duplication a real
maintenance hazard rather than a tidiness one. Also fold in if the field module gets a
public-surface pass.

The concrete third-fact candidate is already visible: **`usesSeed`**. `hallGenerator.evaluate`
opens with `void seed` — hall's structure is params-determined (the donor contract), and its
TSDoc reserves the seed for future skin variants, so nothing consumes it *today*. Meanwhile
`packages/editor/src/frontend/components/field/StampInspector.tsx` (gone) (:133-169) renders the seed
input and the ⚄ re-roll button **unconditionally**, with no generator-dependent guard
(verified). So the editor offers a control that changes nothing on hall — the same class of
gap the editor's `placesArchetypes` schema sniff existed to paper over, and the same class of
fix `emits` is. (That sniff is GONE: F4 tranche B Task 12 deleted it for
`placesProps(def.emits)` in `field-placements.ts`. Named here only as the precedent — do not
grep for it.) Surfaced
by the F4 Task 6 review; deliberately NOT built, since D-F4-15 scoped exactly one fact. Note
it is a genuinely *harder* fact than `emits`: `emits` is checkable against the result, whereas
"does evaluate read `seed`" is not observable from one call — it would be a declaration on
trust, or inferred from evaluating twice at different seeds. If `usesSeed` lands, it lands
through the same seam this entry is about — do the two together.

**Status check (2026-07-30, F4.5b Task 1):** `GeneratorDef.usesSeed` **HAS landed** in core
(`types.ts`; `false` on hall, `true` on maze/cave/scatter) — so the trigger above ("adds a
third `GeneratorDef` declarative fact") has FIRED, and the duplication is now the maintenance
hazard this entry predicted rather than a tidiness one. Exactly as predicted, it is a
declaration on trust: core carries no enforcement for it, deliberately (an ignored seed is
harmless; a consumed-but-undeclared one shows up as a re-roll that visibly does nothing).
What did NOT land is the seam fix — `handleStampPreview` still re-spells core's ctx rule.

**Status check (2026-07-31, F4.5b Task 10):** the CONSUMING half has now landed too.
`FieldGeneratorInfo` carries `usesSeed` (`field-host.ts`, straight through from the registry
in `listGenerators`), and the session card — `shell/SessionCard.tsx`, which replaced the
deleted `StampInspector.tsx` — renders the seed row and the ⚄ re-roll ONLY when it is true,
pinned in both directions (`tests/field-host-session-params.test.ts` on the projection,
`tests/chrome/session-card.test.tsx` on the gating). So the dead control this entry predicted
is gone. **What survives is only the SEAM question** in the paragraphs above:
`handleStampPreview` still re-spells core's ctx rule, and the a/b/c choice is still open and
still a design decision. Nothing about `usesSeed` is outstanding.

**Reference:** `packages/core/src/field/generators.ts` (`evaluateGenerator`, the two guards),
`packages/core/src/field/index.ts` (what the field module does and does not export),
`packages/editor/src/field-host/field-protocol.ts` (`handleStampPreview`),
`packages/core/src/field/types.ts` (`GeneratorDef.emits` TSDoc, which states the guard is the
committer's and that direct `evaluate` calls skip it).
