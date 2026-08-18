---
summary: `tools:build` leaves the binary in `crates/target/release/` with no `dist/tools/` staging step that assembles the publish-ready npm layout — shim, binary, templates, README, LICENSE, manifest
---

# `@furnace/tools` publish staging

`bun run tools:build` now just runs `cargo build --release` and leaves the binary at `packages/tools/crates/target/release/furnace`. There is no `dist/tools/` staging step that produces a publish-ready npm layout — shim.js + binary + templates + README + LICENSE + per-platform `optionalDependencies` package.json. The existing TS staging helpers in `packages/core/scripts/internal/publish.ts` (used by core's publish staging) are TS-library-specific (stage source, emit `.d.ts`); tools ships a binary + assets and won't reuse them. Pattern to copy: biome's release tooling.

**Trigger to revisit:** First real npm publish attempt, OR when adding a second platform binary (which makes the biome-style per-platform optionalDependencies pattern load-bearing — see `docs/backlog/native-runtime/windows-native-implementation.md` and the sibling `per-platform-binary-packages.md`).

**Reference:** `docs/reference/packaging-and-distribution.md` §6 *Native shell distribution* (the *What furnace ships* table) and §8 *Build artefacts*. Biome's release tooling at `github.com/biomejs/biome/tree/main/packages/@biomejs/biome`.
