# `@furnace/tools` publish staging

`bun run build:tools` now just runs `cargo build --release` and leaves the binary at `packages/tools/crates/target/release/furnace`. There is no `dist/tools/` staging step that produces a publish-ready npm layout — shim.js + binary + templates + README + LICENSE + per-platform `optionalDependencies` package.json. The existing TS staging helpers in `packages/core/scripts/internal/publish.ts` (used by core's publish staging) are TS-library-specific (stage source, emit `.d.ts`); tools ships a binary + assets and won't reuse them. Pattern to copy: biome's release tooling.

**Trigger to revisit:** First real npm publish attempt, OR when adding a second platform binary (which makes the biome-style per-platform optionalDependencies pattern load-bearing — see "Windows native implementation" entry).

**Reference:** `docs/reference/packaging-and-distribution.md` §6 (distribution model). Biome's release tooling at `github.com/biomejs/biome/tree/main/packages/@biomejs/biome`.
