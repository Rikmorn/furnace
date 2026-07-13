# `editor-extensions.ts` re-exports more than the editor consumes

**Context.** Surfaced at the W4 sweep. `packages/dungeon/src/editor-extensions.ts` is the
editor's project-first bundle entry. The editor's LIVE `ext.*` surface is exactly **five**
members:

- main thread (`WorldPanel.tsx`'s boundary cast): `realizeRegion`, `MaterialCache`, `worldDir`
- worker (`generation-protocol.ts`'s `WorkerEngine`): `runWorld`, `bakeWorldFiles`

These re-exports have **zero consumers**: `caveDressing`, `caveProxy`, `DEFAULT_WORLD`,
`validateWorldSpec`, and the four type re-exports (`BakeFile`, `WorldManifest`,
`WorldRegionEntry`, `WorldConnectorEntry`). (`DEFAULT_WORLD` and `BakeFile` each appear once
more in the editor — both in *comments*, not imports.)

The editor has **no `@furnace/dungeon` dependency** and cannot import the types at all; it
declares its own structural mirrors (`WorldSpecLike`, `BakeFileLike`). The module header's
rationale — that the re-exports "prove the graph is browser-bundlable" — does not cover them:
**type re-exports are erased and force nothing into a bundle**, and `themes/cave.ts` is
already pulled into the graph by `world-build.ts`, so `caveDressing`/`caveProxy` prove nothing
the existing import doesn't.

W4 did **not** trim them because the 3.3 spec explicitly enumerated them as "the world seam
stays" — so this is a **deliberate, recorded deferral, not an oversight**. Recording it here
so the next boundary pass doesn't have to re-derive which members are load-bearing.

**Trigger to revisit:** the next pass on the project-first boundary contract (couples to
`generation-session-editor-facility.md` — the same seam, from the contract side).

**Reference:** `packages/dungeon/src/editor-extensions.ts` (the seam),
`packages/editor/src/frontend/components/WorldPanel.tsx` (main-thread cast — three members),
`packages/editor/src/frontend/lib/generation-protocol.ts` (`WorkerEngine` — two members),
`docs/reference/editor-architecture.md` §13.2 (the as-built seam).
