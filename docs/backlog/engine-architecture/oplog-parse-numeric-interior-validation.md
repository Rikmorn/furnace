# `parseOps` checks every string union, but no numeric field

The F3a oplog v2 codec (`packages/core/src/field/artifact.ts`) draws its trust line at
**strings vs numbers**. `parseOps` rejects: malformed JSON, envelope version, a
non-integer `id` on any op, an unknown `kind`, every closed string union that reaches the
wire (`effect`, `shape.kind`, `mask.kind`, `mask.selection.kind`, `smooth.mode`, `action`,
`entity.type`), a present-but-not-a-record optional `mask`/`smooth`, and a patch op's full
table-independent structure via `assertPatchStructure`.

Every remaining hole is a **numeric** field, and they fall into two groups.

## 1. Needs a `MaterialTable` — genuinely blocked at this seam

A patch slice's `materials` class ids, a brush op's `material`, and `mask.classId` /
`selection.classId`. `parseOps(text)` takes no table, and adding one changes a public
signature with a live caller (`FieldHost.loadWorld`, which pushes parsed ops straight into
`log.ops`). The load path DOES have a table to hand — `FieldManifest.materialTable` is
embedded in every v2 manifest for artifact self-containment, and `loadWorld` already reads
the manifest beside the oplog. The fix is available whenever it is judged worth the
signature change: an optional `table` parameter, or a separate
`assertOplogAgainstTable(ops, table)` the editor calls after parsing (which keeps
`parseOps` single-argument and matches the escape-hatch-as-standalone-function posture).

## 2. Table-INDEPENDENT and simply not wired — the cheap half

These need no table at all, and for two of them **the engine already owns the predicate**:

- `smooth.strength` / `smooth.iterations` — `assertSmoothValid` (`ops.ts`, module-local)
  checks integer ranges `[1, 64]` and `[1, 4]`.
- a flood selection's `seed` / `budget` — `assertSelectionSpecValid` (`selection.ts`,
  exported module-level, not on the public index) checks integer seeds and a budget in
  `[1, MAX_SELECTION_BUDGET]`.

Both are reachable only via `assertOpValid`, which a loaded op never reaches. Wiring them
into `decodeOp` (after the discriminator check, which is what makes the cast to the typed
param honest) is a small, obvious follow-up — deliberately not taken in the round-3 fix so
that commit stayed scoped to the reviewed defect.

Nothing owns the rest: a shape's `center` / `radius` / `halfExtents` (finite? is `radius`
positive? is `halfExtents` a 3-tuple?) and a `GeneratorEntity`'s `entityId` / `seed` /
`region` / `opSpan`.

## Why it matters that nothing re-checks downstream

Loaded ops never pass through `logApply` / `logApplyPatch`. The replay path is
`applyFieldOp` → `applyOp` / `applyPatchOp`, both of which trust their input by contract
("logged ops never throw here"), and `assertOpValid` is never reached. So a non-finite
radius reaches `opSampleBounds` and produces a degenerate or enormous loop, and a
malformed `region` reaches `reconfigureGenerator`. These need a hand-edited or bit-rotted
file rather than merely an old one — but nothing catches them today.

**Trigger to revisit:** whichever comes first — the first mesh-time `classOf` throw whose
root cause turns out to be a loaded oplog; a hang or blank world after a load; or any
decision to accept oplogs from outside the user's own machine (sharing a world, an
LLM-authored log), which converts this from robustness into a security boundary. Group 2
is worth taking opportunistically the next time this file is open.

## Related: the error locator

`parseOps`' messages carry a `field oplog:` prefix but never name the FILE. With one
caller reading one oplog per world that is unambiguous, and threading a `source` parameter
through a public signature this entry already treats as costly to change would be
speculative scaffold. It also need not ever cost core API surface: if it does need
closing, the CALLER can wrap at zero cost —
`catch (e) { throw new Error(\`worlds/${name}/oplog.json: ${msg}\`) }` in `loadWorld`.
That is what makes deferring correct rather than merely pragmatic.

**Reference:** `docs/reference/core-modules.md` §field "The oplog wire format (F3a)" — the
checked / not-checked split; `parseOps` and `decodeOp` in
`packages/core/src/field/artifact.ts`; `assertPatchValid` / `assertPatchStructure` /
`assertSmoothValid` in `packages/core/src/field/ops.ts`; `assertSelectionSpecValid` in
`packages/core/src/field/selection.ts`.
