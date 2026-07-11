# Connector `boreAxis` is float-dust-fragile for join-placed A-ends

**Context.** `packages/dungeon/src/connector.ts` `boreAxis(portal)` detects the bore's
cardinal axis with `portal.facing[0] !== 0 ? 0 : 2`. A region placed by `join`
(`connect.ts`) has its door facing produced by `rotateY(cardinal, k·π/2)`, which leaves
float dust in the near-zero component — e.g. `[6.12e-17, 0, −1]` instead of exact
`[0, 0, −1]`. That non-zero X dust makes `boreAxis` return 0 (X) when the real axis is 2
(Z), so `tunnelGrid` would clip the grid on the wrong axis (caps not excluded / tube
clipped mid-length).

**Why W1 doesn't bite.** In `realizeWorldSpec` the connector's `a`-end is cave-a, placed
at yaw 0 (identity), so `boreAxis` reads an EXACT cardinal facing. `organicTunnel` reads
`boreAxis` only from the A-end portal. The first world where a connector's A-end is itself
a join-placed (rotated) region — a multi-hop chain — would pick the wrong axis.

**Fix (when triggered).** Use the dominant component instead of `!== 0`:
`Math.abs(facing[0]) > Math.abs(facing[2]) ? 0 : 2`. Identical for exact cardinals,
robust to float dust. Add a test that builds `organicTunnel` from a join-rotated A-end
portal and asserts the correct bore axis / open tube ends.

**Trigger to revisit.** W2 (or any world) introduces a connector whose A-end region is
placed by `join`/at a non-zero yaw (multi-hop region chains).

**Reference.** `packages/dungeon/src/connector.ts` (`boreAxis`, `tunnelGrid`);
`packages/dungeon/src/connect.ts` (`join`, `rotateY`); surfaced in the W1 Task-3
code-quality review (2026-07-11).
