---
summary: `@furnace/tools` ships the host binary inline in one package; platform #2 forces the biome pattern — thin shim package plus `@furnace/tools-<os>-<arch>` optionalDependencies
---

# Per-platform binary packages — biome-style migration

Today's plan ships `@furnace/tools` as a single npm package containing the host-platform CLI binary inline. When furnace gains a second platform target (likely Windows after macOS is proven), the right move is to migrate to the biome distribution pattern: thin `@furnace/tools` shim package + `@furnace/tools-<os>-<arch>` per-platform packages as `optionalDependencies`. Verified to work in Bun workspaces during the 2026-05-19 brainstorming (test in `/tmp/bun-optdeps-test/`). Migration is mechanical — the JS shim changes ~5 lines.

**Trigger to revisit:** Second platform binary (Windows almost certainly first) needs to ship — `docs/backlog/native-runtime/windows-native-implementation.md` is the entry that fires it.

**Reference:** `docs/reference/packaging-and-distribution.md` §6, subsection *Per-platform CLI binary distribution (deferred, biome's pattern)* — which already records the umbrella/subpackage shape and the per-platform target table, so this entry is the deferred WORK, not the design. Biome's `@biomejs/biome` npm package layout as the precedent.
