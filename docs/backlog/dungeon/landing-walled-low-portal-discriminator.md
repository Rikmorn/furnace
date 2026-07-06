# Dungeon: landing is scoped to descent arrivals — the true discriminator is a WALLED low portal

> Re-homed 2026-07-06: Epic 3 (Generation Cockpit) — applies to the generator's cockpit-era iteration (topology orientation of walled-low-portal climbs).

**Context.** In Slice 2.2.5b-B1 the flat low-end landing (`connect.ts` `walkLineAt`/
`floorBoxes`, `LANDING_LEN`) was scoped **directionally** — emitted only on **descending**
connectors. That direction is a *proxy* for the real condition. An ascending connector's low
end is a free-floor **departure**: adding a landing there steepened the climb and created wedges
(verified GPU failures during Task 1). The lintel-clip class, meanwhile, only exists at a
**walled** low portal — a real doorway with a lintel above it — which in the hand-authored graph
is exactly the descent **arrival** (`world.ts` edge5 → the `landing` room). So B1 uses climb
DIRECTION as a stand-in for "is the low portal walled?", which holds for the current hand-built
topology but is not the general rule.

**Trigger to revisit.** The Slice 2.2.5b-B2 topology generator. The general rule: orient every
climbing edge whose LOW portal is a walled doorway as a **descent** (low portal = `b`/arrival) —
the high portal never needs a landing (clearance approaches it from below), so orientation alone
always suffices. B2 should either (a) adopt this authoring convention when it emits edges, OR
(b) promote "walledness" into the portal contract (a `Connection` flag) so the landing decision
reads the flag directly instead of inferring it from the climb sign.

**Reference.** `packages/dungeon/src/connect.ts` (`walkLineAt`, `floorBoxes`, `LANDING_LEN` —
the directional profile + its TSDoc), `packages/dungeon/src/world.ts` (edge5, the descent whose
walled arrival was, at the time this entry was filed, the only landing consumer — that
hand-authored upper-level showcase, incl. edge5, was retired at the 2026-07-06 Epic 2 closure;
`walkLineAt`/`floorBoxes`/`LANDING_LEN` remain live, just currently unexercised by any edge in
`world.ts`), and the prior-art grounding in
`docs/research/2026-07-03-dungeon-2.2.5b-b1-built-interfaces.md` §2.
Surfaced during Slice 2.2.5b-B1 execution (2026-07-03).
