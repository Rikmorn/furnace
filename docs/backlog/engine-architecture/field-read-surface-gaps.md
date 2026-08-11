# Field read-surface gaps

Tracker for the field's **read** surface — what a caller can ask the world, what the answer
costs, and what it does not actually mean. Each section is one previously standalone entry,
keeping its Context, *Trigger to revisit* and *Reference*.

They are merged because each is about reading rather than mutating: `analyzeWorld` pays a
per-chunk cost it does not need, `markUnreachable` answers a weaker question than the data
now supports, and one record the field stores has no public reader at all. Two of the three
are scale-triggered (they are invisible at toy world sizes and are exactly the kind of thing
an F5-scale slice trips over); the reader gap is triggered by a consumer wanting to round-trip
a generator entity, and is cited live from `packages/core/src/field/reconfigure.ts` and
`delete-entity.test.ts` as the reason an undo path reads the way it does.

## `analyzeWorld` re-validates the whole `extraSolid` map once per chunk

`analyzeChunk` validates every buffer in `AnalyzeOptions.extraSolid` on entry (`assertExtraSolidValid` walks the whole map, checking each length is `CHUNK_SAMPLES`). That check is correct and deliberately setup-loud — a packed bitset otherwise reads as a plausible partial flag subset — but `analyzeWorld` calls `analyzeChunk` once per allocated chunk, so validation is **O(chunks × extras entries)** rather than O(extras).

Harmless today and measured so: the F3b cave is 108 chunks, and `voxelizePlacements` over 6400 props emits 49 buffers → ~5.3k length checks, lost in the noise of a 3.9 ms `analyzeWorld` (`packages/core/tests/field-analyze-budget.test.ts`). It only bites where both factors grow together, which they do — a world with N chunks of field tends to have props spread over O(N) chunks, making the term quadratic in world size. A 10k-chunk world with a 10k-entry extras map is ~10⁸ checks (~hundreds of ms) spent proving the same buffers valid ten thousand times.

Not fixed inline because the fix is not the trivial one it looks like: hoisting the check into `analyzeWorld` does not stop `analyzeChunk` re-running it, so it needs an internal already-validated path (a module-private `analyzeChunkChecked` or a validated-view parameter). That is a small design decision about trusting an internal seam inside code reviewed and settled in F4 Task 2, not a mechanical edit.

**Trigger to revisit:** the first `analyzeWorld` run over a world large enough for the `[f4-budget]` line to show validation time — practically, when a bake exceeds ~1k chunks with placements spread across most of them, or when the analyzer worker (D-F4-9) starts running whole-world passes rather than dirty-chunk ones. Measure before changing: the per-chunk incremental path (the actual live-editing shape) passes a small extras slice and is unaffected either way.

**Reference:** `packages/core/src/field/solidity.ts` (`assertExtraSolidValid`, `validatedView`) + `analyze.ts` (`analyzeWorld`); producer `packages/core/src/field/placement-collision.ts`; budget numbers in `packages/core/tests/field-analyze-budget.test.ts`.

## `markUnreachable` still floods UNDIRECTED, now that a directed graph exists

`detectPits` (D-F4-18) introduced the directed edge rule the module always lacked: climb-band edges both ways, one-way high→low fall edges. `markUnreachable` keeps its original **undirected climb-band-only** flood, which means it answers "can the agent WALK there without ever falling", not "can the agent get there". Its own TSDoc has always named this ("falling is ignored"), and demote-not-delete is what made it safe — but the honest answer is now one line away: `detectPits`' ENTERABLE set (climb band ∪ fall targets) is exactly "everywhere the agent can reach", and it is a strict superset of what the flood reaches.

The two were deliberately NOT merged in Task 7.2, because they answer different questions and the merge is a behaviour change, not a refactor:

- **What would change.** Fewer demotions. Anything reachable only by dropping in — a cavern floor below a ledge, a shelf under an overhang — currently reads `unreachable === true` and is hidden by default; under the directed set it would read reachable and become visible. On the F3b default cave `markUnreachable` demotes 19 of 558 flags today (2026-07-26), so the delta is small there and unmeasured elsewhere.
- **Why it is not obviously right.** The undirected flood is CONSERVATIVE for a demotion: it hides less than the truth and never hides a real finding behind a modelled fall the mover cannot survive. Directed reachability is more accurate about the mover but makes the demotion depend on the fall model — and that model has no distance limit, so "reachable" would include the floor of a 50 m shaft.
- **Cost.** The two passes would share one flood instead of running two (`detectPits` already computes ENTERABLE), so a merged shape is cheaper than today's pair, not dearer.

**Related, now guarded structurally:** pit flags must never be demoted by `markUnreachable` — its flood cannot enter a pit by construction, so it would tag every one `true` and hide it behind the documented default filter. The pass therefore SKIPS `kind === "pit"`, leaving the tag `undefined` (the "show it" state), so mixing both sets into one list — the natural shape for a panel — is a no-op rather than a silent hiding. Tested and sabotage-verified.

**The type-correct version is tranche B's call, not core's:** a `PitFlag | CellFlag` discriminated union would let `markUnreachable`'s signature refuse a pit outright, rather than skipping one at runtime. It was NOT taken here because `FieldFlag` is the type the whole flag surface is written against (panel, filters, serialization), so splitting it ripples into consumer code this tranche does not own. Revisit when the tranche-B panel settles its own flag model — if that model keeps one array, the runtime skip is doing real work and the union is the better spelling of it.

**Trigger to revisit:** the F4 tranche-B UI work, when the flag panel decides what "hidden by default" means and someone has to explain why a visible cavern floor's flags are greyed out; or any consumer that adds a fall-damage model, which changes the answer for both passes at once.

**Reference:** `packages/core/src/field/reachability.ts` (`climbNeighbours`, `fallTargets`, `markUnreachable`, `detectPits`); measured numbers in `packages/core/tests/field-analyze-budget.test.ts` (`[f4-budget]` lines).

## field: no public reader for a generator entity record by id

`@furnace/core/field` has no way to READ a committed entity's record. Every verb that
produces one hands it back — `commitGenerator` returns `{dirty, entity}`,
`reconfigureGenerator` returns `{dirty, entity, drift}`, and `setGeneratorFrozen` /
`bakeGeneratorEntity` each return the record they wrote — so a caller that stays live
across the whole session never notices. The gap is on the RELOAD path, which is the
editor's normal path: after a save and reopen, the caller holds `log.ops` (from
`parseOps`) and nothing else, and must scan it for `kind === "entity"` with a matching
`entity.entityId` to answer "is this entity frozen?".

That is the in-core `findEntityOp` helper (`packages/core/src/field/reconfigure.ts`),
reimplemented at the consumer. It is small, but it re-derives an invariant the module
owns — that `entityId` equals the entity op's own log id, and that exactly one entity op
carries it — and it hands out the log's own record object rather than a copy, so a
consumer that mutates what it reads rewrites provenance without an undo entry. Every
existing verb deliberately returns a clone for exactly that reason.

The shape is not obvious enough to settle inline: a single `entityById(log, id)` reader,
a `listEntities(log)` enumerator (which the editor also wants, for the entities list), or
both. Whether an unknown id throws setup-loud like the verbs or returns `undefined` like
a lookup is a real decision — the verbs' setup-loud stance exists because they MUTATE,
which a reader does not. New public API surface, so it fails the AGENTS.md inline-fix
threshold on two counts.

**Trigger to revisit:** the first consumer that renders entity protection state — an
editor entities-list row showing a frozen badge or a baked marker, or a freeze toggle
that must seed its own checked state after a reload. Slotted for the F3a editor task
that wires freeze/bake into the chrome.

**Reference:** `docs/reference/core-modules.md` §`@furnace/core/field` (Smart objects —
freeze / bake; Staged generators, for the layout invariant);
`packages/core/src/field/reconfigure.ts` (`findEntityOp` — the in-core locator a
consumer would be duplicating); `packages/core/src/field/types.ts`
(`GeneratorEntity.frozen` / `.baked`).

**Status check (2026-07-23, F3a seal):** core did NOT gain the public reader; the editor
host re-derives (host-internal `entityRecord` + `listEntities`, plus the panel-side
`shared/field-entity.ts`) — the predicted duplication now has two consumers. The trigger
(a third consumer, or F3b's placement work needing entity iteration in core) stands.
