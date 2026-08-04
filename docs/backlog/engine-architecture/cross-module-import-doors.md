# Cross-module import doors — the deferred T1a clause

The foundations spec (§4 T1a, 2026-08-04) called for an architecture-test clause
enforcing "cross-module imports go through `index.ts` or `internal.ts` only" and
claimed exactly one offending deep import existed (`field/types.ts:1` →
`../physics/types.ts`). Re-derived at T1a execution (2026-08-04): the tree carries
**~190 cross-module deep imports** across nearly every module. The spec's audit
evidently swept only `field/` — both of its cited examples are field files.

The offenders are not exotic; they are the codebase's working convention:

- ~130 type-only imports of sibling modules' `types.ts` / `context-types.ts` /
  `handle.ts` (e.g. `material/types.ts` → `../binding/types.ts`,
  `physics/types.ts` → `../gpu/context-types.ts`).
- ~60 value imports of implementation files: `camera/*` → `../transform/mat4.ts`
  / `vec3.ts`, `frame/render.ts` → `../post/*.ts` (×5) + `../mesh/*.ts` +
  `../material/material.ts` + `../binding/binding.ts`, `gpu/context.ts` →
  `../stats/state.ts` + `../resources/manager.ts`, `post/*` →
  `../shader/shader.ts` + `../binding/layout.ts`, `scene/loader.ts` →
  `../mesh/mesh.ts`, and the underscore-accessor plumbing
  (`material`/`post`/`binding` → `../shader/shader.ts`, five files →
  `../binding/binding.ts`).

A rule contradicted by 190 sites of practice needs redesign, not a pin (decided
with the user at T1a execution; T1a shipped the other four clauses). Design
questions for the redesign:

1. **Which files are doors?** Is a sibling's `types.ts` a sanctioned third door
   (types are erased; the coupling argument is weaker), or does everything route
   through `index.ts`/`internal.ts` re-exports?
2. **Value vs type imports** — one rule for both, or a strict rule for value
   imports and a looser one for `import type`?
3. **The underscore plumbing** — the `_layoutOf`/`_bufferOf`-style cross-module
   accessors currently deep-import implementation files (`shader/shader.ts`,
   `binding/binding.ts`). If `internal.ts` is the door, `shader/` and `binding/`
   grow `internal.ts` seams like `stats`/`log`/`resources` already have.
4. **Migration shape** — big-bang re-point vs ratchet (pin today's edge list,
   fail only new edges, burn down per-module).

The scanner to build on already exists: `scanImportEdges()` in
`packages/core/tests/architecture.test.ts` returns every import edge with
resolved `toFile`/`toModule` — the deferred clause is a ~10-line filter over it.
The one-line `field/types.ts:1` fix (`Vec3Tuple` is exported from
`physics/index.ts`) was deliberately NOT made at T1a — it belongs with this
design, not ahead of it.

**Trigger to revisit — SCHEDULED (user decision, 2026-08-04): immediately after
foundations T2 lands.** Scene's deletion removes a chunk of the graph, so the
design runs against the post-T2 tree, starting by re-deriving this inventory
(do not trust the ~190 above). Leading shape going in: legitimize sibling
`types.ts` imports as a third door (types are erased leaves — that reclassifies
~130 of the sites as fine), grow `internal.ts` seams in `shader/` and `binding/`
for the underscore plumbing (~half the remaining value imports), and land the
clause as a RATCHET — pin the residual edge list, fail only new ones, burn down
per-module. New modules conform from birth meanwhile (T1b's `core/registry`
imports zod + errors only).

**Reference:** `packages/core/tests/architecture.test.ts` (the four landed
clauses + the scanner); `docs/reference/api-posture.md` §R8 enforcement note
(the tier partition this clause would have joined, and the record of its
deferral).
