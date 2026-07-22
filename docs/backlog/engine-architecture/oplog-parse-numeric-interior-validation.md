# `parseOps` cannot check an op's numeric interior

The F3a oplog v2 codec (`packages/core/src/field/artifact.ts`) made `parseOps` a real
trust boundary. It now rejects everything decidable WITHOUT a `MaterialTable`: malformed
JSON, envelope version, a non-integer `id` on any op, an unknown `kind`, every closed
string union on the wire (a brush's `effect` and `shape.kind`, an entity's `action`), and
a patch op's full table-independent structure via `assertPatchStructure` (canonical unique
chunk keys, 512-byte masks, value arrays == popcount).

What remains unchecked is the **numeric interior**, and it splits in two:

**1. Needs a `MaterialTable`.** A patch slice's material class ids, and a brush op's
`material` / class-kind `mask`. `parseOps(text)` takes no table, and adding one changes a
public signature with a live caller (`FieldHost.loadWorld`, which pushes parsed ops
straight into `log.ops`). The load path DOES have a table to hand —
`FieldManifest.materialTable` is embedded in every v2 manifest for artifact
self-containment, and `loadWorld` already reads the manifest beside the oplog. So the fix
is available whenever it is judged worth the signature change: an optional `table`
parameter, or a separate `assertOplogAgainstTable(ops, table)` the editor calls after
parsing (which keeps `parseOps` single-argument and matches the
escape-hatch-as-standalone-function posture).

**2. Needs the applier's bounds maths.** A shape's `center` / `radius` / `halfExtents`
(are they finite numbers? is `radius > 0`? is `halfExtents` a 3-tuple?), a brush's
`smooth` params, and a `GeneratorEntity` record's fields (`entityId`, `seed`, `region`,
`opSpan`). `assertOpValid` covers some of this but needs a table, and it is never reached
for a loaded op anyway.

That last point is the load-bearing one and was mis-stated in the original TSDoc, which
claimed these were "re-checked where the op is applied". **They are not.** Loaded ops
never pass through `logApply`/`logApplyPatch`; the replay path is `applyFieldOp` →
`applyOp`/`applyPatchOp`, both of which trust their input by contract ("logged ops never
throw here"). A non-finite radius therefore reaches `opSampleBounds` and produces a
degenerate or enormous loop, and a malformed `region` reaches `reconfigureGenerator`.
These are narrower than the id/union holes already closed — they need a hand-edited or
bit-rotted file, not merely an old one — but nothing catches them today.

**Trigger to revisit:** whichever comes first — the first mesh-time `classOf` throw whose
root cause turns out to be a loaded oplog; a bug report of a hang or a blank world after
loading; or any decision to accept oplogs from outside the user's own machine (sharing a
world, an LLM-authored log), which converts this from robustness to a security boundary.

**Reference:** `docs/reference/core-modules.md` §field "The oplog wire format (F3a)" —
the checked / not-checked split; `parseOps` and `decodeOp` in
`packages/core/src/field/artifact.ts`; `assertPatchValid` / `assertPatchStructure` in
`packages/core/src/field/ops.ts`.
