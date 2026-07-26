# `@furnace/core/field` cannot be consumed without the whole engine (Rapier included)

`@furnace/core/field` is, by its own module graph, a small pure module: chunk storage, the op log, the generators, the mesher, the walkability advisor. Nothing in it needs a GPU or a physics engine. But it cannot be imported without pulling *all* of core in, because `packages/core/src/field/artifact.ts` value-imports `encodeMeshBlob` from `@furnace/core/scene`, and the scene graph reaches gpu / mesh / material / physics / post behind it — so Rapier's wasm-bindgen glue ships with a field-only consumer.

Measured 2026-07-26, `bun build --target=browser` over a throwaway entry importing only `@furnace/core/field`. The **module counts are the robust evidence**; byte counts move with the entry's import form, so the exact entry is given:

```ts
// probe entry
import * as field from "@furnace/core/field";
console.log(typeof field.analyzeChunk);
```

| build | modules | `rapier` | bytes |
| --- | --- | --- | --- |
| as-is | **208** | present (×7) | ~2.91 MB |
| `--external "@furnace/core/scene"` | **31** | absent | ~15 KB |

Bytes are indicative only: a namespace import defeats tree-shaking and a single named import shakes harder, so the same finding reproduces anywhere in the ~2.90–3.06 MB / ~8–177 KB band depending on the entry. The 208-vs-31 module split and the presence-vs-absence of `rapier` do not move.

The effect in-repo today is that both editor workers (`field-worker.js` and `analyzer-worker.js`) ship ~2.65 MB on the daemon-served bundle, of which most is code neither worker's realm ever calls. Pre-existing — the `artifact.ts` import predates F4 — and surfaced by F4 tranche-B work while correcting a wrong mechanism claim in `packages/editor/tests/frontend-no-engine-leakage.test.ts`'s exemption comment (that comment now names the real lever and points here).

Not fixed inline because the fix is a real design decision, not an edit: `encodeMeshBlob` is a scene-format concern that the field's BAKE path legitimately needs, so the options are to move the encoder somewhere both can reach without the scene graph, to split `field/artifact.ts` behind its own sub-path export, or to accept the coupling and say so. Each changes the published module layout in `docs/reference/packaging-and-distribution.md`.

**Trigger to revisit:** anyone needing a field-only consumer with a bundle budget (a headless field tool, a server-side baker, a second worker), or a published-artifact size concern for `@furnace/core`. Also worth revisiting if the editor's worker bundles start costing real load time — they are downloaded per worker spawn.

**Reference:** `packages/core/src/field/artifact.ts` (line 1, the `@furnace/core/scene` import); `packages/core/package.json` `exports`; the exemption comment in `packages/editor/tests/frontend-no-engine-leakage.test.ts`.
