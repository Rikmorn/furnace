# `remeshOne` swallows GPU setup failures, so a broken render path fails silently

`remeshOne` (`packages/editor/src/field-host/field-world.ts` since foundations T3d Task 6;
`field-host.ts` before that) wraps its whole body — the worker
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

**THE TRIGGER FIRED AND THE ENTRY STAYS OPEN — 2026-08-08, T3d Task 6.** That task did
extract `world` and now owns `remeshOne`, `applyMesh` and `drainDirty`, exactly as this
entry predicted. It changed NOTHING here, and the reason is a constraint rather than an
oversight: T3d Task 6 is **behaviour-frozen** (zero behaviour changes, every existing pin
passing unmodified), and all three shapes proposed above change what a failing remesh DOES.
So the three functions crossed the boundary verbatim, the `try` still spans the worker call
and `applyMesh` together, and the decision is still owed. What the move DID change is where
to make it: the handler is now module-private inside `field-world.ts`, its `catch` guards on
`substrate.disposed()` rather than a closure `let`, and `reportToolError` is already a dep on
that module's record — so the third shape ("route setup failures to `reportToolError`") is now
a one-line reach rather than a new seam.

**Trigger to revisit:** the next time anyone touches `remeshOne`'s error handling or the
tool-error contract. The T3d hook is spent; this now wants a slice that is allowed to change
behaviour, and the prune tranche is the nearest candidate.

Worth folding in when it is decided: T3d Task 6 measured a SECOND unpinned path of the same
family — `ret.setMaterialTable`'s post-swap `world.redirtyAll()` is asserted by no test at
all, while `ret.init`'s identical call is (`docs/reference/field-host-clusters.md` §2.11).
That is the same async IIFE this entry's last paragraph already says to check.

**Reference:** `packages/editor/src/field-world.ts`'s `remeshOne` (the code);
`packages/editor/src/field-host/field-materials.ts` header (the three sabotage
probes and their measured results); `docs/reference/field-host-clusters.md` §2.8 and §2.11;
`docs/reference/engine-conventions.md` §Failure policy.
