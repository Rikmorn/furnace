# World connector bore sizing + cave∩connector overlap pinch (W1 Task-8 probe, 2026-07-11)

The W1 inter-region traversal probe (`packages/dungeon/tests/world-traversal.gpu.test.ts`)
found the default world (two caves + one organic tunnel) was **not traversable** on the full
collider set: the player capsule wedged at the cave-A↔tunnel seam and could not reach cave B.

**Root cause (diagnosed).** The connector bore was `TUNNEL_RADIUS = 0.95` while the cave bore it
joins is `themes/cave.ts TUNNEL_R = 1.6` ("sized for capsule + step-up headroom"). The connector
and the cave each voxelize their OWN bore, and their proxies OVERLAP for several metres where the
cave's mouth bore overshoots into the gap. In that overlap the capsule needs air in BOTH proxies,
so the walkable cross-section collapses to the NARROWER bore. At 0.95 — barely taller than the
1.8 m capsule and, once voxelised on the 0.5 m lattice with no cell column centred on the bore
axis, shorter than it — the capsule was pinched against the ceiling and wedged, even though the
cave (1.6) and the connector each walked fine in isolation.

**Fix applied (the probe's one connector.ts iteration).** `TUNNEL_RADIUS 0.95 → 1.6` — size the
connector bore to match the region bore it joins. Forward + reverse centre-lane traversal now
clean; both off-centre wall-hug lanes cross the seams without wedge/launch. Probe green.

## Follow-ups

- **ACTIONABLE — re-bake the committed world fixture.** `packages/dungeon/worlds/default/manifest.json`
  still records `connectors[].radius: 0.95`, and the game loader (`world-loader.ts`
  `createConnectorProxyBody`) re-expands the connector proxy from that BAKED radius, NOT the
  constant. So the shipped game still loads a 0.95 tunnel and still wedges — only the in-memory
  probe sees 1.6. The fixture must be re-baked (via the proper browser-bake path — cross-engine
  noise/placement determinism, per the Pr-2 lesson) before the W1 world is walkable in-game.
  **Trigger:** before gating/shipping the W1 world in the game (Task 9/10 or a dedicated re-bake).

- **DURABLE (charter) — overlapping voxel proxies pinch.** Radius-matching is a mitigation, not
  the invariant fix. Two independently-voxelised organic proxies co-existing at a seam will pinch
  the shared passage whenever their bores differ or the lattice has no column on the bore axis.
  The durable fix is a shared-lattice / carve-union composition (one authoritative field in the
  overlap), which is the post-3.2.3 world/region composition charter direction.
  **Trigger:** world/region composition charter (`connector-geometry-stitching.md`, the 3.4
  "built places, organic carves" carve-union probe).

- **Traversal-quality — off-centre lanes grind slowly.** The ±0.55 wall-hug lanes traverse
  without wedging but grind through the cave's shovable dressing (dynamic spires) and the bumpy
  off-centre voxel floor, needing ~1800 sim frames vs ~800 for the centre lane. Not a wedge; a
  feel issue. Folds into `generated-wing-traversal-quality.md`.

**Reference:** `packages/dungeon/src/connector.ts` (`TUNNEL_RADIUS` comment),
`packages/dungeon/tests/world-traversal.gpu.test.ts`, `connector-geometry-stitching.md`,
`generated-wing-traversal-quality.md`.
