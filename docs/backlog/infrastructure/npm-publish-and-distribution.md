---
summary: publishing `@furnace/tools` and `@furnace/core` to npm: release flow, `dist/tools/` staging, and the biome-style per-platform binary migration
---

# npm publish & distribution

Tracker for the deferred npm-publish / distribution work for the shippable packages
(`@furnace/tools`, `@furnace/core`) and the native CLI binary. Three entries that
previously lived in three different backlog directories (infrastructure/,
editor-and-tooling/, native-runtime/) are merged here — with **infrastructure/** as
the cross-directory home — because they are one story: the overall publish flow, the
`dist/tools/` publish-staging step it needs, and the biome-style per-platform-binary
migration that a second platform target forces. All three fire on "first real npm
publish / first external consumer" or "second platform binary ships." Order: overall
flow → publish staging → per-platform migration.

## npm publish flow for @furnace/tools and @furnace/core

Both packages are `"private": true` today; nothing publishes. Before consumers can `bun add @furnace/tools` or `bun add @furnace/core` outside the workspace, we need: versioning strategy (single-version monorepo vs per-package; SemVer cadence vs lockstep), a release script that builds the binary + bundles core's TS → ESM + populates `packages/tools/templates/` correctly + flips `private: false`, npm token/scope setup (`@furnace` is taken on npm — need to claim or rename), changelog generation. The `files` allowlist in `packages/tools/package.json` (added in `18e3c9a`) is the first step. When a second platform target ships, this work folds into the biome-pattern migration (the *Per-platform binary packages — biome-style migration* section below).

**Trigger to revisit:** First external consumer wants to use furnace outside the workspace, OR before public release.

**Reference:** biome's release tooling at <https://github.com/biomejs/biome> as a precedent. The native-shell distribution design spec §2 ("Artifact model") covers what shipping looks like.

## `@furnace/tools` publish staging

`bun run tools:build` now just runs `cargo build --release` and leaves the binary at `packages/tools/crates/target/release/furnace`. There is no `dist/tools/` staging step that produces a publish-ready npm layout — shim.js + binary + templates + README + LICENSE + per-platform `optionalDependencies` package.json. The existing TS staging helpers in `packages/core/scripts/internal/publish.ts` (used by core's publish staging) are TS-library-specific (stage source, emit `.d.ts`); tools ships a binary + assets and won't reuse them. Pattern to copy: biome's release tooling.

**Trigger to revisit:** First real npm publish attempt, OR when adding a second platform binary (which makes the biome-style per-platform optionalDependencies pattern load-bearing — see "Windows native implementation" entry).

**Reference:** `docs/reference/packaging-and-distribution.md` §6 (distribution model). Biome's release tooling at `github.com/biomejs/biome/tree/main/packages/@biomejs/biome`.

## Per-platform binary packages — biome-style migration

Today's plan ships `@furnace/tools` as a single npm package containing the host-platform CLI binary inline. When furnace gains a second platform target (likely Windows after macOS is proven), the right move is to migrate to the biome distribution pattern: thin `@furnace/tools` shim package + `@furnace/tools-<os>-<arch>` per-platform packages as `optionalDependencies`. Verified to work in Bun workspaces during the 2026-05-19 brainstorming (test in `/tmp/bun-optdeps-test/`). Migration is mechanical — the JS shim changes ~5 lines.

**Trigger to revisit:** Second platform binary (Windows almost certainly first) needs to ship.

**Reference:** Section 2 "Artifact model" of `docs/reference/packaging-and-distribution.md`; biome's `@biomejs/biome` npm package layout as the precedent.
