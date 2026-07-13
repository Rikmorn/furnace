# `cave.ts`'s legacy cluster (graph path, grotto bake, `regions/` fixtures) is dead in production — retiring it is a public-contract change

**Context.** Surfaced at the W4 sweep. `themes/cave.ts`'s `buildGraphLegacy` has **no
production caller**. The selector (`caveSkeleton`, `cave.ts:446`) is:

```ts
const legacy = p.mouths === undefined && p.capped === undefined;
```

But `mouths` is **required** on `CaveRegionSpec.params` (`world-spec.ts:20` —
`params: { mouths: number; capped?: number }`), `DEFAULT_WORLD`'s cave sets `mouths: 1`
(`world-spec.ts:253`), the committed manifest records `"mouths": 1`, the editor's
`CaveKnobs` is `{ mouths: number }` and cannot produce `undefined`
(`world-draft.ts:38`), and the only production call site — `generateRegion`
(`world-build.ts:163`) — always passes `region.params.mouths`. **Only tests that omit the
param reach it.**

**Retiring it is NOT mechanical.** It also means deleting the `legacyEntrance` branch in
`buildField`, the legacy branch in `caveMouthData`, the `legacy` flag threaded through
`caveSkeleton`, and the `usable`/`sealed` legacy ternaries — and **making `mouths`
required on the exported `CaveParams`, which is a public-contract change**. Plus migrating
the tests that rely on it: `cave.test.ts` (its shared no-`mouths` `params` fixture plus the
spire test), `scatter.test.ts`, `scatter-realize.gpu.test.ts`, and `cave-entrance.gpu.test.ts`,
whose entire subject IS the legacy `-Z` entrance bore.

**The cluster is wider than `buildGraphLegacy` (widened post-gate, 2026-07-13).** The same
retirement should sweep the rest of the Epic-2.1 "field→baked region" remnant, which is
one cluster with this decision:
- `cave.ts` legacy exports **`bakeCavernMesh`** + **`bakedCavernProxy`** (the old
  hand-level grotto — seed `cavern-1`, origin `[0,0,-24]`); consumed ONLY by the pieces
  below, never by the live `cave()`/world path.
- **`packages/dungeon/regions/`** — the tracked `region-cavern.fmesh` / `.scene.json`
  fixtures (baked by the self-described "throwaway one-shot baker"
  `scripts/bake-region.ts`, which also dies).
- Tests: `tests/baked-region.gpu.test.ts` (the only reader of `regions/`),
  `tests/cavern-proxy.test.ts` — their contracts (fmesh/render-only fragment loading;
  field-derived proxy collision) are covered at world level by
  `world-loader.gpu.test.ts` + the world walk-probes.
- The dead **`/regions/` route in `serve.ts`** (nothing fetches it — the game boots via
  `loadWorld` only).
- Comment references to `region-cavern` in `packages/editor/src/daemon/server.ts` +
  `packages/editor/tests/project-assets.test.ts` (history in comments — reword, the
  tests themselves use their own temp fixtures).

**Also record:**
- **Five `// MIGRATION (until B2 Task 9)` markers in `cave.ts` are PAST DUE** (B2 is closed) —
  `cave.ts:204`, `:294`, `:446`, `:494`, `:582`. All five are tied to this decision, which is
  why they were left rather than cleared blind.
- The **`-Z` quadrant reservation is GENUINE** — the hardcoded entrance bore is carved through
  that wall, a reason internal to `cave.ts`. The **`-X` reservation is VESTIGIAL**: it was
  reserved for the hand-authored level, which was deleted in W4.
- **Residual falsehood:** `cave.test.ts:32`'s comment `// 1 entrance + 2..3 branch mouths` is
  wrong. On this path the branch count is fixed at exactly **2** — `cave.ts:233` is
  `Math.min(rng.int(2, 4), DIRS.length)` and `DIRS.length === 2` (only two open cardinals), so
  the draw always clamps to 2.

**Trigger to revisit:** the field-charter brainstorm, or any pass that touches `cave.ts`'s
public params (at which point the `CaveParams` contract change is already on the table).

**Reference:** `packages/dungeon/src/themes/cave.ts` (`buildGraphLegacy`, `caveSkeleton`,
`buildField`, `caveMouthData`), `packages/dungeon/src/world-spec.ts` (`CaveRegionSpec`,
`DEFAULT_WORLD`), `packages/dungeon/src/world-build.ts` (`generateRegion` — the only
production call site).
