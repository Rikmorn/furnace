# Analyzer re-analysis halo assumes every bounded probe reach stays under one chunk

**Context.** The editor's analyzer worker re-runs stage 1 over a set derived from the
edited chunks: the 26-neighbour halo, plus every allocated chunk BELOW the dirty one in
its own XZ column and the 4 cardinal ones (`reanalysisKeys` in
`packages/editor/src/viewport-host/analyzer-protocol.ts`). The column term exists because
two reads in `packages/core/src/field/analyze.ts` are unbounded in Y — `ceilingAbove`
(own column) and `scanRise`'s `isSolid` (the 4 cardinal columns, bounded only by that
ceiling). Everything else the column pass reads is BOUNDED, and the halo is what covers
those.

The halo's sufficiency for the bounded probes is **not intrinsic** — it holds only while
every bounded reach stays under `CHUNK_DIM` (16). Those reaches are derived from the
agent profile divided by `cellSize` (`metricsFor`), so they scale as `1/cellSize`. At
today's 0.25 m lattice with `catalog/agent.json` the maxima are comfortable:

| reach | expression | at 0.25 m |
| --- | --- | --- |
| Y, headroom (`airRun`) | `clearCells = ceil(clearance / c)` | 8 |
| Y, lip wall probe | `stepCells + wallProbeUp − 1` | 4 |
| XZ, pinch (`faceDistance`) | `pinchCells = ceil((2·radius + skin) / c)` | 3 |
| XZ, lip wall probe | `1 + wallCellsXZ = 1 + ceil(radius / c)` | 3 |

At `cellSize` 0.05 the same profile gives `clearCells` 36, and a lip-wall probe reaching
27 cells above the anchor (`stepCells` 8 + `wallProbeUp` 20, less one) — both past 16,
i.e. **two chunks** — and the halo would silently under-cover, with no test catching it. This is pre-existing: it is a property of D-F4-9's amendment (which
named the halo) rather than of the cardinal-column correction made in `265ff166`.

One refinement worth recording, derived while filing this and worth re-verifying before
acting on it: the *unbounded column term* already absorbs any reach along the anchor's
own or cardinal columns at ANY lattice, because it includes every allocated chunk below
without a depth limit. That narrows the true exposure to the two probes the column term
cannot help with — `wallBeyondLip` (the only probe that is both diagonal in XZ and
extended in Y, so it escapes both the halo and the cardinal columns) and `faceDistance`
(a same-level lateral read, which no below-column term covers). `wallBeyondLip` is the
binding one first; `faceDistance` only crosses 16 cells below ~0.04 m.

A cheap guard exists if this ever matters — assert the derived cell counts stay under
`CHUNK_DIM` in the analyzer's own validation path, so a too-fine lattice fails
setup-loud instead of quietly under-covering. **Deliberately not built now:** at the
shipping lattice the margin is 2× and the guard would be dead code with a maintenance
cost.

**Trigger to revisit:** any change to the field lattice below ~0.1 m, or any increase to
`clearance` / `stepHeight` / the wall probe (`WALL_PROBE_M`) that pushes a bounded reach
past 16 cells. Recompute the table above whenever `catalog/agent.json` or
`DEFAULT_CELL_SIZE` moves.

**Reference:** `packages/core/src/field/analyze.ts` (`metricsFor` — `clearCells`,
`pinchCells`, `wallCellsXZ`, `wallProbeUp`, `stepCells`; `airRun`, `wallBeyondLip`,
`faceDistance`, `scanRise`); `packages/core/src/field/solidity.ts` (`ceilingAbove`, the
uncapped scan the column term answers); `packages/editor/src/viewport-host/analyzer-protocol.ts`
(`READ_COLUMNS`, `reanalysisKeys` — the halo term is the 27-cube loop);
`packages/core/src/field/chunks.ts` (`CHUNK_DIM`, `DEFAULT_CELL_SIZE`).
