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

- **RESOLVED — committed world fixture re-baked (commit 564bbd2).** The committed
  `packages/dungeon/worlds/default/manifest.json` had baked `connectors[].radius: 0.95`, and the
  game loader (`world-loader.ts` `createConnectorProxyBody`) re-expands the connector proxy from
  that BAKED radius, not the constant — so the shipped game would have kept loading a 0.95 tunnel
  and wedging. Re-baked at 1.6 via `scripts/bake-default-world.ts` (a deterministic BUN bake), NOT
  the browser path. **Pr-2 does not apply here**: the game LOADS the baked placement and never
  recomputes it, and the connector COLLISION proxy re-expands in-engine at load from the manifest's
  `radius`/`overshoot` (`organicTunnel(c.a, c.b, c.seed, {radius: c.radius, overshoot: c.overshoot})`)
  via the same `capsuleCavern`/`voxelsFromField` sign-test path the caves already use. The only
  V8-baked connector artifact is the render mesh (`tunnel-1-0.fmesh`), which is render-only — no
  cross-engine PLACEMENT regeneration is involved. Same provenance class as the committed
  `region-cavern.*` fixture, so a bun bake is correct. **Residual:** the connector proxy has only
  been walked headless in V8 (bun-webgpu); a Safari in-engine walk is owed at the user's browser
  gate — low risk, as it is the same sign-test collision path the caves have used, Safari-stable
  since 2.2.1.

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

---

**W2 update (2026-07-12).** The BUILT side of this class is now **resolved by construction**.
D-W2-4 gives a grid-built region ONE authoritative fine occupancy grid, and a `collar-bore`
into it does not overlap a second proxy — it CARVES that grid (`prepareCarve` →
`suppressedFaces` → patch → `fineProxy`), so the overlapping-proxy pinch is structurally
impossible on the built side. The W2 premise probe (`tests/collar-bore.gpu.test.ts`) walks the
carve-opening ↔ bore seam clean on-axis, reversed, and off-centre.

The **organic↔organic** mitigation stance is unchanged and still stands (radius-match
`TUNNEL_RADIUS` = the cave bore + overshoot interpenetration). The remaining **carve-union**
direction therefore now applies to **organic seams only** — a shared-lattice union between two
field regions, which W2 deliberately did not attempt (approach C, phase-scale).

Separately, W2 measured an off-axis organic-cave-INTERIOR floor undulation (~0.80 m, > the
0.4 m step-up) that trips the traversal launch guard — filed as
`organic-cave-mouth-offaxis-rimride.md`. It is the tracked voxel-KCC-on-organic-terrain class,
not a connector-overlap defect (a capsule spawned inside the bore crosses the very same mouth
clean).
