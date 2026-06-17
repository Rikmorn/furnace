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
`project_dungeon_epic2_procgen.md` (the 2.1 brainstorm + slice ladder). The
`settings.region` provenance block in `@furnace/core/scene` (`SceneSettings`) is the
partial materialisation of this model in the scene format.
