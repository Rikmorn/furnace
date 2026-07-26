# `markUnreachable` still floods UNDIRECTED, now that a directed graph exists

`detectPits` (D-F4-18) introduced the directed edge rule the module always lacked: climb-band edges both ways, one-way high→low fall edges. `markUnreachable` keeps its original **undirected climb-band-only** flood, which means it answers "can the agent WALK there without ever falling", not "can the agent get there". Its own TSDoc has always named this ("falling is ignored"), and demote-not-delete is what made it safe — but the honest answer is now one line away: `detectPits`' ENTERABLE set (climb band ∪ fall targets) is exactly "everywhere the agent can reach", and it is a strict superset of what the flood reaches.

The two were deliberately NOT merged in Task 7.2, because they answer different questions and the merge is a behaviour change, not a refactor:

- **What would change.** Fewer demotions. Anything reachable only by dropping in — a cavern floor below a ledge, a shelf under an overhang — currently reads `unreachable === true` and is hidden by default; under the directed set it would read reachable and become visible. On the F3b default cave `markUnreachable` demotes 19 of 558 flags today (2026-07-26), so the delta is small there and unmeasured elsewhere.
- **Why it is not obviously right.** The undirected flood is CONSERVATIVE for a demotion: it hides less than the truth and never hides a real finding behind a modelled fall the mover cannot survive. Directed reachability is more accurate about the mover but makes the demotion depend on the fall model — and that model has no distance limit, so "reachable" would include the floor of a 50 m shaft.
- **Cost.** The two passes would share one flood instead of running two (`detectPits` already computes ENTERABLE), so a merged shape is cheaper than today's pair, not dearer.

**Related, now guarded structurally:** pit flags must never be demoted by `markUnreachable` — its flood cannot enter a pit by construction, so it would tag every one `true` and hide it behind the documented default filter. The pass therefore SKIPS `kind === "pit"`, leaving the tag `undefined` (the "show it" state), so mixing both sets into one list — the natural shape for a panel — is a no-op rather than a silent hiding. Tested and sabotage-verified.

**The type-correct version is tranche B's call, not core's:** a `PitFlag | CellFlag` discriminated union would let `markUnreachable`'s signature refuse a pit outright, rather than skipping one at runtime. It was NOT taken here because `FieldFlag` is the type the whole flag surface is written against (panel, filters, serialization), so splitting it ripples into consumer code this tranche does not own. Revisit when the tranche-B panel settles its own flag model — if that model keeps one array, the runtime skip is doing real work and the union is the better spelling of it.

**Trigger to revisit:** the F4 tranche-B UI work, when the flag panel decides what "hidden by default" means and someone has to explain why a visible cavern floor's flags are greyed out; or any consumer that adds a fall-damage model, which changes the answer for both passes at once.

**Reference:** `packages/core/src/field/reachability.ts` (`climbNeighbours`, `fallTargets`, `markUnreachable`, `detectPits`); measured numbers in `packages/core/tests/field-analyze-budget.test.ts` (`[f4-budget]` lines).
