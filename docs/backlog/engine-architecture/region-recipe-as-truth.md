# Region recipe as truth — the canonical region data model (Slice 2.3)

Slice 2.1 introduced the `.fmesh` binary sidecar as the persistence format for a baked
region. The baked mesh is a **cache**, not truth. The design north star (articulated in
the Slice 2.1 spec) is:

```
canonical region = { provenance, field params, ordered edit-ops }
baked mesh      = f(canonical region)  →  content-hash-invalidated cache
```

What this entry tracks:

- Formalising the canonical region data model: `provenance` block (generatorId,
  version, seed, kind), field parameter bundle, and an **ordered edit-op log** that
  layers authored changes over the procedural base (e.g. "place torch at [3, 1, 2]",
  "block doorway at west wall"). The edit-op log is the mechanism that lets the editor
  be the region baker — authors make edit-ops; the baker reruns the field + mesher +
  ops and writes a fresh `.fmesh` + scene document.
- The **content-hash cache-invalidation** rule: a baked mesh is only valid when the
  hash of (field params + edit-ops + mesher version) matches the hash stored in the
  `.fmesh` header (deferred until the header has a `hash` field — currently `VERSION 1`
  carries no hash).
- The **merge story** is explicitly deferred (per the Slice 2.1 design): stable provenance
  IDs + provenance-tagged edit-ops replace a merge-engine. Two edits with different IDs
  don't need merging; the ID is the key.

**Trigger to revisit:** The editor becomes the region baker (the "cockpit" milestone) —
the moment an author authors edit-ops through the editor UI and hits "bake". Before that
point, the bake script is throwaway (as in Slice 2.1) and the canonical model does not
need to be formalised.

**Reference:** Slice 2.1 spec + design (field-as-geometry north star), memory
`project_dungeon_epic2_procgen.md` (the 2.1 brainstorm + slice ladder).

**Disposition note (2026-07-23, F3a seal):** the One Field era realizes this idea for
the FIELD (the op log + generator provenance IS recipe-as-truth — `@furnace/core/field`
serializeOps/parseOps + GeneratorEntity). The old `.fmesh`/`RegionData` model this entry
targets retires at F6's clean cut — review there: either this entry dies with it, or a
residual (non-field regions, if any survive) gets restated against the field model.

**RESOLVED BY THE FIELD, 2026-08-05 (foundations T2) — kept only until its residual is
judged.** The cut this entry was waiting for came early and from the side: the region world,
its `.fmesh`/`RegionData` model and `@furnace/core/scene`'s `settings.region` provenance block
(the partial materialisation this entry pointed at) are **all deleted**. Every bullet above is
now shipped, for the field:

- The canonical model IS `{ provenance, params, ordered edit-ops }` — `oplog.json` is the
  ordered op log, `GeneratorEntity` carries `{ generatorId, params, seed, region, opSpan }`,
  and the density store is its evaluated state. The editor authors ops; the bake reruns nothing
  at runtime (the game loads the derived artifact, per the charter's no-replay-at-runtime rule).
- The **merge story** landed exactly as designed: stable ids + provenance-tagged ops, no merge
  engine. `reconfigureGenerator` splices one entity's span and replays downstream ops.

What remains genuinely open is the **content-hash cache invalidation** rule — a baked mesh is
only valid when the hash of (ops + mesher version) matches a hash stored in the artifact, and
neither the manifest nor the `.fmesh` header carries one today. Nothing has needed it: the bake
is written whole by one process, and the default world's determinism is proven by re-baking
rather than by a hash. **Delete this entry** and open a narrow one for the hash if a stale-bake
class ever shows up (a hand-edited chunk file, a partial upload, a mesher change with no
re-bake).
