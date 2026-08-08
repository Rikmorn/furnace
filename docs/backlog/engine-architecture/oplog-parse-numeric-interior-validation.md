# `parseOps` cannot resolve a class id — it has no `MaterialTable`

**NARROWED at T4a (2026-08-08).** This entry opened as "`parseOps` checks every string
union, but no numeric field" and split that gap in two: the fields blocked on a
`MaterialTable`, and the table-independent rest. **The table-independent half is closed**
— see below for what landed. What survives is the one question the seam genuinely cannot
answer, plus the locator note the entry always carried as a deliberate non-decision.

## What T4a closed (do not re-file it)

`parseOps` now runs `assertOpStructure` on every brush op — the table-INDEPENDENT half of
`assertOpValid`, defined so that `assertOpValid` = it + the table legs. That definition, not
care, makes THE PREDICATE a subset of the commit path's, so an op the EDITOR could commit
can never fail to load (the editor is typed). The decoder around it is deliberately
STRICTER — `assertOpValid` takes a typed `BrushOp` and re-checks no union tag and no vector
length, so it accepts a 2-element `center` and an `effect: "carve"` that `parseOps` rejects;
15 of 18 probed payloads diverge, all one-directional. It reuses the engine's own predicates
rather than re-spelling them (`assertShapeValid`, `assertSmoothValid`,
`assertSelectionSpecValid`), so shape centres/endpoints/radii/half-extents, `hollow`,
`smooth.strength`/`iterations` and a flood's `seed`/`budget` are all checked at parse.
`assertSelectionSpecValid` gained the region leg it never had (finite bounds, naming bound
and axis). An entity record's `entityId`/`seed`/`region`/`opSpan` — and its literal-`true`
`frozen`/`baked` flags — are checked by a decoder-local predicate, because nothing validates
an entity op on the commit path either; the op's own `id` joined the same non-negative-integer
predicate. Class ids — a brush's `material`, `mask.classId`, a flood-material spec's
`classId` — are checked to be integers the material channel can STORE
(`[0, MAX_MATERIAL_CLASS_ID]`, now also enforced at `validateMaterialTable`, where the ids
are minted); a patch slice's material ids ride the wire as base64 BYTES, so they satisfy
that half by construction.

Probe: all six worlds in `packages/dungeon/worlds/` parse under the new validation — 4792
ops as written on the wire (3514 `brush`, 1265 legacy `dig`, 7 `entity`, 6 `patch`) — and
`bake:default` re-emits byte-identically.

## What is left: resolution, not arithmetic

"Is this an id at all" is answered. "Does this id name a class in THIS world's table" is
not, and cannot be at this seam: `parseOps(text)` takes no table, and adding one changes a
public signature with a live caller (`FieldHost.loadWorld`, which pushes parsed ops
straight into `log.ops`). So an unresolvable class id still surfaces late, at mesh time,
as `classOf`'s "unknown class id".

The knowledge is available — `FieldManifest.materialTable` is embedded in every v2 manifest
for artifact self-containment, and `loadWorld` already reads the manifest beside the oplog.
Two shapes, whenever it is judged worth the change:

- an optional `table` parameter on `parseOps`; or
- a separate `assertOplogAgainstTable(ops, table)` the caller runs after parsing — which
  keeps `parseOps` single-argument and matches the escape-hatch-as-standalone-function
  posture. `assertOpValid` and `assertPatchValid` already ARE the per-op table legs, so
  this is mostly a loop.

**Trigger to revisit:** the first mesh-time `classOf` throw whose root cause turns out to
be a loaded oplog; or the point at which an agent authoring op streams is expected to get
its class ids wrong often enough that a late error is the wrong feedback.

## Related: the error locator (still deferred, still deliberately)

T4a gave every message an OP locator — a wired predicate's throw is re-thrown as
`field oplog: op <id> — <the predicate's message>` (`atOp` in `artifact.ts`). Messages
still never name the FILE. With one caller reading one oplog per world that is
unambiguous, and threading a `source` parameter through the public signature above would
be speculative scaffold. It also need not ever cost core API surface: if it does need
closing, the CALLER can wrap at zero cost —
`catch (e) { throw new Error(\`worlds/${name}/oplog.json: ${msg}\`) }` in `loadWorld`.
That is what makes deferring correct rather than merely pragmatic.

**Reference:** `docs/reference/core-modules.md` §field "The oplog wire format" — the
checked / not-checked split; `parseOps` / `decodeOp` / `atOp` in
`packages/core/src/field/artifact.ts`; `assertOpStructure` / `assertOpValid` /
`assertPatchStructure` / `assertPatchValid` in `packages/core/src/field/ops.ts`;
`MAX_MATERIAL_CLASS_ID` in `packages/core/src/field/materials.ts`.
