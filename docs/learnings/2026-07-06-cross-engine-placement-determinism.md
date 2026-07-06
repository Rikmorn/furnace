# Cross-engine placement determinism — bun/JSC ≠ node/V8 (Slice 3.1 Pr-2)

*The same seed produces a **different world placement** under JSC (Safari/bun) than under
V8 (Chrome/node). Field-derived geometry (mesh bytes, scatter, voxel proxies) is
cross-engine identical; placement is not. So you cannot bake a world in one engine by
regenerating it in another.*

## The finding

Pr-2 (the 3.1 determinism probe) FNV-1a-hashed a fully generated wing under bun (JSC)
and node (V8) for three seeds. **All three hashes diverged** between engines, while each
engine was self-consistent across runs and both ran the **same esbuild bundle** — so it
is a genuine engine-level numeric divergence, not a build or source difference.

Root-caused to **transcendental `Math`**: `Math.cos` / `Math.sin` / `Math.atan2` of the
join yaw in `connect.ts placePiece`'s world-frame transform, plus the same functions in
the placement search's accept/reject comparisons (where a sub-ULP difference flips a
candidate from accepted to rejected and changes the whole embedding). The ES spec leaves
these transcendentals **implementation-defined** to the last bits, and JSC and V8 differ
there.

What is **cross-engine identical**: the cave Surface-Nets mesh bytes and the scatter
instance transforms/tints. Those are generated in the region's **local frame** with no
join-yaw transform applied — so they never touch the divergent `Math`. Field-sign voxel
proxies (`voxelsFromField`) are likewise integer-grid membership, engine-agnostic.

## Consequence

The plan's original Decision 2 — "the daemon regenerates the world from the seed and
writes it" — is **not engine-robust**: the daemon runs under bun/node, the preview the
user curated ran under the browser (Safari=JSC, Chrome=V8), and a daemon-side
regeneration would place the world differently from what the user saw. The slice adopted
the spec §0.2 **browser-uploads-payload fallback**: the browser bakes the wing in its own
engine (reproducing its own preview exactly) and uploads the file set; the daemon only
validates root-containment and writes. The daemon carries zero generator knowledge.

## How to apply

- **Any daemon-side regeneration, OR any load-time re-expansion, that must byte-match a
  world produced by a *different* engine is unsafe for placement / world-frame geometry.**
  If output must be reproduced across an engine boundary, transport the produced bytes —
  don't re-run the generator on the other side.
- **Mesh CONTENT and field-sign proxies are safe to regenerate cross-engine** — they're
  local-frame / integer-grid and never hit the divergent transcendentals. (This is why
  the baked wing's `.fmesh` sidecars carry local vertices and the cave voxel proxy
  re-expands at load from provenance: both are engine-robust. Only the *placement* — the
  per-piece world transform — must be transported, which the baked scene docs already do
  by storing each entity's resolved world position.)
- If a future slice ever needs cross-engine-identical placement, it must replace the
  transcendental path with a fixed-point / integer or lookup-based yaw so the result is
  bit-reproducible — not rely on `Math`.

## Reproducer

`packages/dungeon/scripts/hash-world.ts` (added in commit `8f6cd84`) — run under `bun` and
`node`, compare the `WORLDHASH` lines. Recorded results at that commit:
`p1-6-0` = `4101…` (JSC) vs `92cc…` (V8), etc.
