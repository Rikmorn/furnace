# Field reconfigure and parse edges

Tracker for the legs of the field's **reconfigure / parse** path that are exact only under
a precondition nothing enforces. Each section is one previously standalone entry with its
Context, *Trigger to revisit* and *Reference* preserved.

They are merged because all three are the same kind of finding on the same path
(`packages/core/src/field/reconfigure.ts` and `packages/core/src/field/oplog.ts`): the code
is correct for every input the shipped callers produce, and silently wrong — or merely
unpinned — for an input they happen never to produce. None is a live bug, and each says so
in its own words. All three are cited live: the flood-mask and empty-evaluation sections
from `packages/core/src/field/reconfigure.test.ts` (which pins the current behaviour, not
the desired one), the flood-mask section also from `docs/reference/core-modules.md`, and
the `parseOps` section from `docs/reference/editor-architecture.md`.

Sections are ordered by how the precondition is violated: a flood mask that changes the read
set, an empty evaluation result, and an op-log payload whose interior is never re-checked.

## field reconfigure: a flood-masked downstream op replays against end-of-log state

**Context.** `reconfigureGenerator` (`packages/core/src/field/reconfigure.ts`) culls
replay to an affected chunk set — the old span's chunks ∪ the new evaluation's, closed
transitively over downstream ops that intersect it. Only those chunks are rewound to
their pre-span state; every other chunk keeps its END-OF-LOG bytes. That is exact as
long as a replayed op READS only inside its own bounded influence, which holds for all
four brush effects, class-kind masks, region selections and patch ops (independently
verified at the Task 3 spec review, 2026-07-22).

A **flood** selection mask breaks it. `SelectionSpec` `flood-material` / `flood-void`
BFS outward from a seed and are unbounded by construction, so the op's read set is not
its write set. `readsOutsideItsWrites` handles this conservatively — such an op always
joins the affected set, so it is always replayed, and it is reported whenever its output
differs from the PRE-RECONFIGURE bytes (the drift baseline is old-final, not
from-scratch, so "loud in practice" rather than loud by construction) — but that only
covers its WRITES. The flood itself still traverses chunks that were never rewound, and
those chunks hold state produced by ops that originally ran AFTER it. The flood replays
against a future it never saw.

Reproduced (cellSize 0.25, verified 2026-07-22):

- two disconnected dirt rails at `y = z = 10 m` (chunk `cy = cz = 2`, clear of the
  stamp): left `x ∈ [0, 8]`, right `x ∈ [12.5, 28]`
- a hall committed at `[0, 0, 0]`
- op A (after the stamp) = `paint` → rock over `x ∈ [20, 28]`, masked
  `flood-material { seed: [8, 40, 40], classId: 1 }` — paints nothing, because the rails
  are disconnected
- op B (after A) = a bridge `fill` of dirt over `x ∈ [7, 14]`, whose chunks
  (`1..3, 2, 2`) are disjoint from both A's (`4..7, 2, 2`) and the stamp's

Reconfigure the hall 8 → 12. B is correctly NOT absorbed, so its bytes persist; A is
absorbed and replays, its flood now crosses the bridge and paints the right rail.
Right-rail material: `before = 1`, `afterReconfigure = 0`, `fromScratch = 1`. A is
reported as `drifted`, so the divergence is loud — but the report cannot say the new
output is itself wrong.

The mechanical fix is to force the affected set to the whole store as soon as any
downstream op reads unboundedly (or to bound a flood's read set at record time and
intersect that). Both are design decisions with real cost — the first throws away
culling for any log containing one flood-masked op, which is the exact cost D-F3-3
exists to avoid — so this belongs to a planning session, not to executor discretion.
The gap is documented honestly in `reconfigureGenerator`'s TSDoc and in
`docs/reference/core-modules.md` until then.

**Trigger to revisit:** the first flood-masked op that survives into a saved world
alongside a reconfigurable entity (the editor's flood-select tool makes this reachable
the moment a user selects-then-paints and later reopens a stamp), or any F3b/F4 work
that widens `readsOutsideItsWrites`' input set — a generator emitting flood-masked ops
would make `directlyAffected` under-approximate the OLD span's reads the same way.

**Reference:** `docs/reference/core-modules.md` §`@furnace/core/field` (Smart objects —
reconfigure, "Known gap (flood reads)"); `packages/core/src/field/reconfigure.ts`
(`readsOutsideItsWrites`, `closeOverDownstream`, `restorePreState`);
`packages/core/src/field/selection.ts` (`materializeSelection`).

## `reconfigureGenerator`'s empty-evaluation leg is documented but unheld

> **Checked at foundations T4c Task 7 (2026-08-10). The trigger did NOT fire in the form it
> predicted, and the entry is NARROWED rather than closed.** The clause read *"a third
> generator-committing path arriving (T4c's MCP verbs would drive both existing ones)"*. **No
> third CORE path arrived** — T4c's `generate` verb
> (`packages/editor/src/field-host/field-mutation.ts`) is a new CALLER of `commitGenerator`,
> which is one of the two paths that already existed, and it is deliberately the one whose
> empty-result guard IS pinned. Nor does it drive both: `generate` reaches `commitGenerator`
> only, and no MCP tool opens a reconfigure session.
>
> **What DID change is reachability, in two unequal steps.** (1) `commitGenerator`'s empty
> leg — the pinned one — is now reachable by an agent, and reached deliberately:
> `generate` does NOT pre-check for an empty result the way the interactive path does
> (`reportEmptyPreview` reads a settled preview, which a session-free verb does not have), so
> core's own rejection is what a caller gets. (2) `reconfigureGenerator`'s UNHELD leg is
> reachable by exactly one narrow route — `action_run {id: "session.confirm"}` over a
> reconfigure session a HUMAN opened, since `session.confirm` is one of the 39 registry rows
> the named-verb door exposes and `confirmSession` routes to `applyReconfigureSession` in
> reconfigure mode. That is a real path and a strange one; it raises no new hazard (the throw
> is caught and reported on the host's own channel) but it does mean the asymmetry this entry
> describes is no longer only a developer-facing one.
>
> Unchanged: the fixture is still the one-line `evaluate` swap under `try/finally`, and the
> pin directly above it in `reconfigure.test.ts` is still the template.

**Context.** `reconfigureGenerator`'s public `@throws`
(`packages/core/src/field/reconfigure.ts`) names two failure classes that live side by side
in `evaluateSpan`: the evaluation being EMPTY, and an evaluated op or placement failing
`assertOpValid`/`assertPatchValid`/`assertPlacementsValid`. T4a Task 5 pinned the second
(`reconfigure.test.ts`, "an evaluated op that fails validation throws with NOTHING
mutated") and left the first unheld.

Both legs are unreachable through the registry — every registered generator emits at least
its shell fill, so no params reach the empty branch — and both are reachable by the same
one-line fixture: swap the registered def's `evaluate` under `try/finally` to return
`{ ops: [], placements: [] }`, the pattern `generators.test.ts` already uses in
"reconfigureGenerator enforces the fact too". The pin that now exists for the validation
leg is the template; this is the same test with a different swapped body.

**The distinction originally argued for holding one and not the other does not survive
reading the source, and is withdrawn here rather than left in a comment.** The claim was
that the `@throws` names the validation clause as a guarantee callers may lean on. It
does — and it names the empty clause in the very same sentence ("...the evaluation is
empty, or an evaluated op or placement fails..."). So both are documented guarantees, and
the real reason only one is held is that Task 5 was closing the validation one. That is a
scope fact, not a principle.

`generators.test.ts` carries the mirror gap: `commitGenerator`'s own empty-result guard IS
pinned there ("an empty evaluated span throws setup-loud; store and log untouched"), using
a synthetic def — which `commitGenerator` accepts directly and `reconfigureGenerator`, which
re-resolves through the registry, does not. So the two committing paths are asymmetric
today for a reason that stopped being true once the `evaluate`-swap pattern was adopted.

**Trigger to revisit:** the next change to `evaluateSpan` or to either path's empty-result
handling; or a third generator-committing path arriving (T4c's MCP verbs would drive both
existing ones); or simply the next session that touches `reconfigure.test.ts`'s setup-loud
block, since the fixture is a copy of the pin directly above it.

**Reference:** `evaluateSpan`'s empty check and its `@throws` in
`packages/core/src/field/reconfigure.ts`; the validation-leg pin and the comment naming
this entry at the end of `reconfigure.test.ts`'s "reconfigureGenerator — setup-loud guards"
block; `commitGenerator`'s equivalent empty-result pin in
`packages/core/src/field/generators.test.ts`.

## `parseOps` cannot resolve a class id — it has no `MaterialTable`

**NARROWED at T4a (2026-08-08).** This entry opened as "`parseOps` checks every string
union, but no numeric field" and split that gap in two: the fields blocked on a
`MaterialTable`, and the table-independent rest. **The table-independent half is closed**
— see below for what landed. What survives is the one question the seam genuinely cannot
answer, plus the locator note the entry always carried as a deliberate non-decision.

### What T4a closed (do not re-file it)

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

### What is left: resolution, not arithmetic

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

### Related: the error locator (still deferred, still deliberately)

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
