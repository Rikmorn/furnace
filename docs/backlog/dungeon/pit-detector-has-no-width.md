---
summary: detectPits ignores free width, so a 0.25 m well between two prop colliders is flagged as a trap the 0.60 m capsule cannot even enter
---

# The pit detector has no width — sub-capsule wells read as traps

**Context.** `detectPits` (D-F4-18) floods the same headroom-free, width-free node set
`markUnreachable` uses: a standable column is a floor anchor, full stop. Its TSDoc already
documents that headroom is ignored in both directions. P-F4-3b (2026-07-26) produced a concrete
repro of the *width* half.

The default cave with authored catalog scatter reports exactly one pit region: **one column, at
cell `[38,2,54]`, all four XZ neighbours solid at its own level** — a well **0.25 m across**,
formed between two voxelized prop colliders. The capsule is 0.60 m wide. It cannot fall in, so
the region is not enterable and the flag is a false positive against the real mover. The detector
is self-consistent: `fallTargets` only asks whether the neighbour column is air at our level and
where the descent lands, and a 1-cell shaft satisfies both.

Cheap partial mitigations exist and all have costs worth thinking about before picking one:
- **Post-filter on region size / free width.** Drop (or demote to `info`) regions whose columns
  all measure below the `narrow` bar. Cheap, but it silently hides a genuinely narrow trap.
- **Width in the node set.** Require a floor anchor to have `2r + skin` of free width to count as
  a node. Principled, but it changes `markUnreachable` too — and that pass's unsoundness is
  currently one-directional ON PURPOSE (over-connecting only ever demotes LESS).
- **Leave it to stage 2.** The advisor is advisory; a walk probe settles marginal geometry. This
  is the current posture and costs nothing.

The measurement script prints the well diagnosis for any 1-column region, so the class is visible
rather than inferred: `scripts/measure/explain.ts` reports the four neighbour walls and names the
capsule width it is compared against.

**Trigger to revisit.** Sub-capsule wells become a routine share of the pit findings in the F4
panel — i.e. someone is regularly dismissing pit rows that turn out to be 1-cell prop gaps. A
handful in a stress-density bake is not that. Also revisit if the node set gains a width or
headroom notion for any other reason, since the two passes must keep reading one node set.

**Reference.** `packages/core/src/field/reachability.ts` (`detectPits` @remarks — the headroom and
resolution caveats this extends; `fallTargets` / `climbNeighbours` are the edge rules);
`packages/dungeon/scripts/measure/explain.ts` (`explainPit`, the well diagnosis);
`packages/dungeon/scripts/measure-analyze.ts` (re-runnable repro: the authored-props default cave
row). Related: `docs/backlog/dungeon/scatter-props-pinch-passages.md`.
