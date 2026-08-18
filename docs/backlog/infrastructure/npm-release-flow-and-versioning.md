---
summary: nothing publishes — both shippable packages are `private: true`, and a first publish needs a versioning strategy, a release script, an npm scope and changelog generation decided together
---

# npm publish flow for `@furnace/tools` and `@furnace/core`

Both packages are `"private": true` today; nothing publishes. Before consumers can `bun add @furnace/tools` or `bun add @furnace/core` outside the workspace, we need: versioning strategy (single-version monorepo vs per-package; SemVer cadence vs lockstep), a release script that builds the binary + bundles core's TS → ESM + populates `packages/tools/templates/` correctly + flips `private: false`, npm token/scope setup (`@furnace` is taken on npm — need to claim or rename), changelog generation. The `files` allowlist in `packages/tools/package.json` (added in `18e3c9a`) is the first step. When a second platform target ships, this work folds into the biome-pattern migration (`per-platform-binary-packages.md`).

**Trigger to revisit:** First external consumer wants to use furnace outside the workspace, OR before public release.

**Reference:** biome's release tooling at <https://github.com/biomejs/biome> as a precedent. `docs/reference/packaging-and-distribution.md` §4 *What consumers receive* and §6 *Native shell distribution* are the tracked statement of what shipping looks like.
