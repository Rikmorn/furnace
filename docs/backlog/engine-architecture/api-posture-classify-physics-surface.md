# Classify the @furnace/core/physics surface in api-posture.md

**Filed 2026-06-03** during Stage 2 (surfaced by the rigid-mesh classification pass). Pre-existing Stage-1 gap — engine-doc hygiene, not blocking.

## Context

`docs/reference/api-posture.md` §"Classification of the current surface" classifies every
`@furnace/core` public export by kind (Resource / Value-type / Descriptor / Factory /
Core-mutator / Command / Lifecycle-op / …). Stage 2 added the `rigidMesh.*` exports to that
table, but the **Stage-1 `@furnace/core/physics` surface was never classified** and is still
absent:

- **Resource:** `World`, `Body` (+ `PhysicsWorldHandle`, `PhysicsBodyHandle`)
- **Descriptor:** `WorldDescriptor`, `BodyDescriptor`, `ShapeDescriptor`
- **Factory:** `physics.createWorld`, `physics.createBody`
- **Core-mutator:** `physics.getBodyTranslation`, `physics.getBodyRotation`, `physics.step`,
  `physics.drainCollisions`
- **Lifecycle-op:** `physics.destroyWorld`, `physics.destroyBody`
- **Value-type / event record:** `CollisionEvent`

The omission is conspicuous now because the classified `rigidMesh` composite wraps these
unclassified primitives (`rigidMesh.create` is "Factory — builds + owns a `Body` + a `Mesh`",
but `Body`/`createBody` themselves aren't in the table).

## Why deferred

Pure documentation completeness — no code or behaviour is wrong, and `api-posture.md` is a
reference doc, not a gate. Classifying the physics surface is a small, mechanical pass best
done deliberately (so the kind assignments are chosen coherently against R1–R9) rather than
bolted on mid-Stage-2 as silent scope creep.

## Trigger to revisit

Next time `api-posture.md` or the `@furnace/core/physics` surface is touched (e.g. Stage 3/4
extends the physics API with cylinder/capsule shapes), classify the existing physics exports
in the same pass. Mirror the existing rows' format; verify each assignment against the R9
failure-policy stances (`createWorld`/`createBody` = cold-path Factory; `step`/`getBody*` =
hot-path Core-mutator; `destroyWorld`/`destroyBody` = Lifecycle-op).

## Reference

- Surfaced: Stage 2 Task 7 (docs) implementer + spec/code-quality reviews.
- `docs/reference/api-posture.md` §"Classification of the current surface".
- `docs/reference/core-modules.md` `@furnace/core/physics` section (the signature inventory to classify against).
