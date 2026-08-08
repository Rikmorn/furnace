# `remeshOne` swallows GPU setup failures, so a broken render path fails silently

`remeshOne` (`packages/editor/src/field-host/field-host.ts`) wraps its whole body — the worker
round-trip AND the `applyMesh` call that follows it — in one `try`, whose `catch` reports a
`console.warn` and returns. That was written for the WORKER's failure modes, which are
transient and per-chunk: a job rejected because `dispose` tore the context down mid-flight is
expected and must not be loud. But `applyMesh` sits inside the same `try`, and `applyMesh`
calls into the material layer for every bucket it draws — so a total failure of the render
SETUP is caught by a handler built for a transient per-chunk one.

Measured at foundations T3d Task 3, as a sabotage probe rather than reasoned: making
`field-materials.ts`'s per-class cache write to a private map instead of the substrate's — so
`bucket()` finds neither the class key nor the `c0` fallback and throws on every call —
leaves the **entire editor suite green (1469 pass / 0 fail)**. `bucket()` is provably reached
(instrumented: three call sites fire). The observable result of a completely broken material
cache is an empty viewport plus one `console.warn` per chunk. No test fails, no tool-error
channel message reaches the chrome, and the user is shown a world with no geometry in it and
told nothing.

The coverage half of this is recorded in `field-materials.ts`'s header and in
`docs/reference/field-host-clusters.md` §2.8. What is filed HERE is the other half, which is
not a coverage gap but an **error-contract** question: which failures may a remesh swallow?
The two classes now sharing one handler are different in kind — a worker job that loses a
race with teardown is noise, while a material cache that cannot answer is a broken invariant
that should be loud (the repo's "setup loud, runtime quiet" stance, `docs/reference/engine-conventions.md`
§Failure policy). Plausible shapes: narrow the `try` to the worker call alone and let
`applyMesh` throw; keep one `try` but re-throw anything that is not the known
dispose-race; or route setup failures to `reportToolError` so the chrome says the viewport is
broken. Each has a different blast radius across the nine paths that dirty chunks, which is
why this needs a decision rather than an inline fix — it is above the inline-fix threshold in
`AGENTS.md` (it introduces a design decision, and it changes a failure contract other clusters
depend on).

Worth checking at the same time whether the sibling swallow in `ret.setMaterialTable`'s async
IIFE has the same shape — it catches around `materials.rebuildForTable(c)` for the same
dispose-race reason and would hide the same class of setup failure.

**Trigger to revisit:** the next time anyone touches `remeshOne`'s error handling or the
tool-error contract; at the latest during T3d Task 6, which extracts `world` and therefore
owns `remeshOne`, `applyMesh` and `drainDirty`.

**Reference:** `packages/editor/src/field-host/field-materials.ts` header (the three sabotage
probes and their measured results); `docs/reference/field-host-clusters.md` §2.8;
`docs/reference/engine-conventions.md` §Failure policy.
