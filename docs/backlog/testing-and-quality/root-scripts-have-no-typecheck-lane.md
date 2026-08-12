---
summary: nothing in `bun run typecheck` invokes the root tsconfig, so root `scripts/` is never type-checked by the gate
---

# Root `scripts/` is never type-checked by the gate

Filed 2026-08-12 during the docs-system slice, which created the root `scripts/` directory.
Corrected the same day after measuring — the first framing ("scripts/ is in no typecheck
target") was wrong.

## Context

`bun run typecheck` fans out to the **five package tsconfigs**. Root `scripts/` is in none of
them. But the **root** `tsconfig.json` declares no `include`, so it globs the whole repo —
`scripts/` included. The gap is not coverage, it is that nothing invokes it.

**Proven, not assumed** (2026-08-12): appending `const x: number = "s"` to `scripts/sitrep.ts`
and running `bunx tsc --noEmit -p tsconfig.json` reports
`scripts/sitrep.ts: error TS2322`. The root project does check these files. `bun run typecheck`
simply never runs it.

Measured wall-clock, same day (dated snapshots — re-derive before acting):

| lane | time |
| --- | ---: |
| a scoped `scripts/tsconfig.json` (extends root, `include: ["**/*"]`) | 0.97 s |
| the whole repo via the root project | 8.4 s |
| current `bun run typecheck` (five package lanes, sequential) | 27.3 s |

So a `scripts/tsconfig.json` is **not needed for capability** — it is needed only to scope
the lane to ~1 s instead of re-checking the whole repo at 8.4 s. Either shape closes the gap;
the scoped one is the house pattern (core and cookbook each name their own `scripts/**/*`).

Adding `include` to the **root** tsconfig instead would be the wrong move: it currently globs
everything, so naming an include narrows it repo-wide.

**Side-finding worth carrying to the build-speed slice:** one root project run type-checks the
entire repo in 8.4 s, against 27.3 s for the five sequential package lanes. They are not
equivalent — the package configs differ (jsx, types, paths) — but a 3× gap on the same
compiler is a lead worth pulling.

## Trigger to revisit

Next time anything is added to root `scripts/`, or whenever the build-speed slice is taken —
whichever comes first. Cheap enough to take opportunistically in any tranche already touching
the root `package.json`.

## Reference

- Root `package.json` — the `typecheck` script and its five lanes.
- Root `tsconfig.json` — no `include`, hence the repo-wide glob.
- `packages/core/tsconfig.json` — the house pattern (`include` naming `scripts/**/*`).
