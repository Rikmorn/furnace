---
summary: the dungeon's `editor-extensions.ts` re-exports far more than the editor's six live `ext.*` members across three boundary casts — the rest have zero consumers, and the module header's browser-bundlable rationale does not cover them; a deliberate recorded deferral, not an oversight
---

# `editor-extensions.ts` re-exports more than the editor consumes

**Context.** Surfaced at the W4 sweep. `packages/dungeon/src/editor-extensions.ts` is the
editor's project-first bundle entry. The editor's LIVE `ext.*` surface is **six** members
across **three** boundary casts (re-counted 2026-07-26, F4 tranche B — was five across two):

- main thread (`WorldPanel.tsx`'s boundary cast): `realizeRegion`, `MaterialCache`, `worldDir`
- generation worker (`generation-protocol.ts`'s `WorkerEngine`): `runWorld`, `bakeWorldFiles`
- analyzer worker (`analyzer-protocol.ts`'s `AnalyzerEngine`, F4): `analyzerVerify`

These re-exports have **zero consumers**: `caveDressing`, `caveProxy`, `DEFAULT_WORLD`,
`validateWorldSpec`, **`AGENT`**, and the type re-exports (`BakeFile`, `WorldManifest`,
`WorldRegionEntry`, `WorldConnectorEntry`, plus F4's `AnalyzerVerifyOptions` / `VerifyLane` /
`VerifyLaneOutcome` / `VerifyOutcome` / `VerifyReason` / `VerifyVerdict`). (`DEFAULT_WORLD`
and `BakeFile` each appear once more in the editor — both in *comments*, not imports.
`AGENT` is a NEW zero-consumer value re-export: the editor gets the same agent profile as
DATA, by fetching and parsing `catalog/agent.json`, because the advisor's premise must not
depend on the project shipping a bundle entry. The F4 verdict types are likewise unreachable
— the editor declares its own structural twin, `VerifyVerdictWire`, for the reason the
`WorldSpecLike` / `BakeFileLike` mirrors already exist.)

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
`generation-session-as-generic-facility.md` — the same seam, from the contract side).

**Reference:** `packages/dungeon/src/editor-extensions.ts` (the seam),
`packages/editor/src/frontend/components/WorldPanel.tsx` (gone) (main-thread cast — three members),
`packages/editor/src/frontend/lib/generation-protocol.ts` (gone) (`WorkerEngine` — two members),
`packages/editor/src/field-host/analyzer-protocol.ts` (`AnalyzerEngine` — one member),
`docs/reference/editor/bundling.md` (the `export * as extensions` seam, as built).
