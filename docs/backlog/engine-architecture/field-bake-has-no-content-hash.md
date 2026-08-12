---
summary: a baked field stores no hash of (ops + mesher version), so nothing can detect that a bake is stale
---

# A field bake carries no content hash, so nothing can detect a stale bake

**Filed 2026-08-11 (foundations T5 register prune), as the surviving residual of
`region-recipe-as-truth.md` — an entry deleted in the same commit that created this one, so
the name below is a record of where this came from and not a live pointer.** That entry
tracked the whole "canonical region =
{ provenance, params, ordered edit-ops }, baked mesh = an invalidatable cache of it"
model. Foundations T2 shipped every part of it *for the field* — `oplog.json` is the
ordered op log, `GeneratorEntity` carries `{ generatorId, params, seed, region, opSpan }`,
the density store is the evaluated state, and the merge story landed as designed (stable
ids + provenance-tagged ops, no merge engine; `reconfigureGenerator` splices one entity's
span and replays downstream ops). One bullet did not ship, and it is this one. The parent
entry's own closing instruction was to delete it and open a narrow entry for the hash;
this is that entry.

The rule that is missing: **a baked mesh is only valid when the hash of (ops + mesher
version) matches a hash stored in the artifact.** Nothing stores one. Verified 2026-08-11:
`FieldManifest` (`packages/core/src/field/types.ts`) is
`{ version, kind, cellSize, playerStart, playerYaw, chunks, meshes, materials?, kit?,
materialTable?, placements? }` — no hash field anywhere, and the `.fmesh` header the
`mesh-blob` codec writes carries none either.

Nothing has needed it. The bake is written whole by one process, and the default world's
determinism is proven by re-baking rather than by comparing a hash. That is exactly why
this stayed a bullet inside a larger entry for a year rather than becoming work: there is
no *observed* stale-bake failure to fix, only a class of failure the design left
undetectable.

**Trigger to revisit:** a stale-bake class actually showing up — a hand-edited chunk file,
a partial upload, or a mesher change with no re-bake. Any one of those produces an artifact
whose meshes no longer follow from its ops, and today the loader cannot tell.

**Reference:** `packages/core/src/field/types.ts` (`FieldManifest`);
`packages/core/src/field/artifact.ts` (what the bake writes);
`packages/core/src/mesh-blob/` (the `.fmesh` header, which has a `version` and no hash);
`docs/reference/engine-architecture.md` §15 (why the field is the content model now, and
what went with `@furnace/core/scene`).
