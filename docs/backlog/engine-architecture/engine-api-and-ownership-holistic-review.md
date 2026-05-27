# Engine public API and ownership — holistic review

The engine has grown without a systematic pass over its public API surface. Tranche B-1 surfaced one specific instance — the `mesh.cube` / `mesh.plane` factory geometry leak — and articulated the underlying ownership rule in `engine-conventions.md` §Resource ownership:

> Pass a GPU handle in, or get one back, → you own it. Factories that take only values and return a handle keep their internal allocations private and free them on destroy.

B-1 fixed mesh (by deleting the violating factories). This entry tracks the holistic follow-up: audit every other public module against the rule and against the broader "what should be on a public type" question.

## Known audit targets

- **Material** — `pipeline`, `group1`, `ownedBuffers`, `ownedBufferHandles`, `pipelineKey` are on the public `Material` type but only read by engine code (`frame/render.ts`, `frame/render-to-texture.ts`, `material/material.ts`). Move to a boundary type + `_getPipeline` / `_getGroup1` accessors mirroring the pattern any post-B-1 mesh cleanup would use if it kept `mesh.geometry` private. Material doesn't have an active trap because no consumer reaches for these fields, but the asymmetry between "public type" and "internal use" is the same shape as the mesh trap was — best closed before someone writes code against the public type.
- **Mesh (post-B-1)** — `objectBuffer`, `modelMatrix`, `transformDirty` remain on the public `Mesh` type after B-1 deletes the factory leak. TSDoc says "mutate via setters" — implies these should be internal. Decide: public for consumer-readable debugging vs internal boundary.
- **Geometry** — `vertexBuffer`, `indexBuffer`, `vertexCount`, `indexFormat`, `indexCount` are publicly typed and read by the engine (frame.render). Same "consumer or engine?" question as Material. Probably consumer-readable (for introspection / debugging) but worth a deliberate decision.
- **Camera, post effects, render targets, frame helpers** — never audited; likely similar patterns.

## Audit dimensions to apply per module

1. **Public type exposure** — which fields are read by consumers vs only by engine? Anything read only by engine should move to a boundary type with an underscore-prefixed accessor.
2. **Ownership rule compliance** — does every receive-a-handle path correspond to a destroy contract that's structurally enforced (not just documented)? Are there other convenience APIs (besides the now-deleted `mesh.cube` / `mesh.plane`) that hide allocations the consumer might reasonably think they need to manage?
3. **Factory/helper risk surface** — do any convenience factories return handles to internal state that the consumer can then disposable-call separately? (B-1's trap shape, generalised.)
4. **Documentation coverage** — `engine-conventions.md` §Resource ownership (added in B-1) is the criterion. Does every public function's TSDoc point at the conventions section, or at least state ownership explicitly? Are there modules whose TSDoc contradicts the codified rule?

## Process suggestion

Inventory first (one session of read-only audit producing a per-module compliance table); decide-and-execute second (one or more tranches per module that needs cleanup). Keeps the inventory's findings honest and lets the user pick which modules merit the cleanup cost.

Material's cleanup is small enough (~3 fields to move, ~2 accessors to add, ~4 internal call sites to update) that it could ship as a single bundled tranche after the inventory.

**Trigger to revisit:** Before the next major public-API-surfacing feature ships (Scene concept, lights, animation). Land the audit and any cleanup tranches that fall out, so the new feature builds on a clean surface rather than papering over inconsistencies.

**Reference:**
- `docs/superpowers/specs/2026-05-27-tranche-b1-mesh-factory-geometry-ownership-design.md` — B-1 spec that codified the rule and triggered this entry.
- `docs/reference/engine-conventions.md` §Resource ownership — the criterion for the audit (added in B-1).
- Sibling: `destroy-policy-consistency.md` (A-3 candidate, double-destroy uniformity) is part of the same broader "engine API hygiene" theme.
