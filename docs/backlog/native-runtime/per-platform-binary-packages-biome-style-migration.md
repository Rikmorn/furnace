# Per-platform binary packages — biome-style migration

Today's plan ships `@furnace/tools` as a single npm package containing the host-platform CLI binary inline. When furnace gains a second platform target (likely Windows after macOS is proven), the right move is to migrate to the biome distribution pattern: thin `@furnace/tools` shim package + `@furnace/tools-<os>-<arch>` per-platform packages as `optionalDependencies`. Verified to work in Bun workspaces during the 2026-05-19 brainstorming (test in `/tmp/bun-optdeps-test/`). Migration is mechanical — the JS shim changes ~5 lines.

**Trigger to revisit:** Second platform binary (Windows almost certainly first) needs to ship.

**Reference:** Section 2 "Artifact model" of `docs/reference/packaging-and-distribution.md`; biome's `@biomejs/biome` npm package layout as the precedent.
