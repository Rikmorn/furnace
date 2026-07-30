# Source-comment references to backlog entries dangle after the 2026-07-25 prune

**Context.** The `editor-and-tooling` prune (37 → 15, AGENTS.md >20 rule) merged 28 entries
into 6 thematic docs. The plan's zero-dangling-refs gate was scoped `--include="*.md"`, so
every `.md` reference was retargeted, but **references living in source comments were not in
the gate's scope** — and the hygiene pass carried a hard "zero `src/` diffs" invariant, so
they were deliberately left alone rather than fixed out-of-mandate.

Five source sites still name a backlog file that no longer exists:

| site | dangling name | now lives in |
| ---- | ------------- | ------------ |
| `packages/editor/src/frontend/lib/catalog.ts:184` | `field-editor-prop-meshes.md` | `field-tool-follow-ons.md` § *Editor props render as collision PROXIES, not the archetype's actual meshes* |
| `packages/editor/src/viewport-host/field-placements.ts:13` | `field-editor-prop-meshes.md` | same as above |
| `packages/editor/src/viewport-host/field-host.ts:520` | `field-reconfigure-ghost-exactness.md` | `field-tool-follow-ons.md` § *Reconfigure ghost previews against CURRENT field state, not the entity's pre-span state* |
| `packages/core/src/field/generators.ts:216` | `enum-field-stringifies-numeric-members.md` | `editor-chrome-authoring-gaps.md` § *EnumField stringifies enum members and never coerces back — numeric enums are dead on arrival* |
| `packages/editor/tests/field-host-headless.test.ts:141` | `field-host-worker-injection-seam` (bare, no `.md`) | `editor-test-harness-fragility.md` § *FieldHost's worker seam exists now — what host coverage still cannot reach is a stamp session* |

**Two fixed, 2026-07-30 (F4.5a Task 10).** The pair in `FieldPanel.tsx` (:131, :164, both
`entity-row-params-stale-across-load.md`) travelled with the `sameEntities` comparator into
`packages/editor/src/frontend/hooks/useFieldHostState.tsx` when the entity seams moved to the
shell provider — the trigger below firing exactly as written — and were retargeted at
`editor-chrome-authoring-gaps.md` § *An entity row's expanded params can show the PREVIOUS
world's values after a load* in the same commit.

Separately, **one dangling ref predates this work**: `docs/reference/ui-foundation.md` cites
`docs/backlog/editor-and-tooling/svelte-editor-inspector-surfaces.md`, which did not exist on
master `c6f61851` either. Not caused by the prune; fix it in the same sweep.

**Why it wasn't fixed here.** The hygiene pass's invariants were "zero `src/` diffs" and a
Done gate restricting the diff to `tests/` + `biome.json` + `docs/backlog/editor-and-tooling/`.
Editing six source files to retarget comments would have broken both. This is exactly the
AGENTS.md inline-fix threshold failing its "in a file you are already touching" condition.

**Trigger to revisit:** the next session that touches any of the six source files (fix that
file's comment in passing), OR — preferred — one dedicated ≤10-line sweep commit, since the
whole set is mechanical and the refs rot silently (nothing tests a path inside a comment).

**Reference:** AGENTS.md § "Keeping docs current" (the *"Renamed a file… grep for the old path
before committing"* rule this entry exists to satisfy), the prune commit `a531088c`,
`docs/backlog/editor-and-tooling/` merged docs.
