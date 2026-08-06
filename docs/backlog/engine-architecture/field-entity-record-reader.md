# field: no public reader for a generator entity record by id

`@furnace/core/field` has no way to READ a committed entity's record. Every verb that
produces one hands it back — `commitGenerator` returns `{dirty, entity}`,
`reconfigureGenerator` returns `{dirty, entity, drift}`, and `setGeneratorFrozen` /
`bakeGeneratorEntity` each return the record they wrote — so a caller that stays live
across the whole session never notices. The gap is on the RELOAD path, which is the
editor's normal path: after a save and reopen, the caller holds `log.ops` (from
`parseOps`) and nothing else, and must scan it for `kind === "entity"` with a matching
`entity.entityId` to answer "is this entity frozen?".

That is the in-core `findEntityOp` helper (`packages/core/src/field/reconfigure.ts`),
reimplemented at the consumer. It is small, but it re-derives an invariant the module
owns — that `entityId` equals the entity op's own log id, and that exactly one entity op
carries it — and it hands out the log's own record object rather than a copy, so a
consumer that mutates what it reads rewrites provenance without an undo entry. Every
existing verb deliberately returns a clone for exactly that reason.

The shape is not obvious enough to settle inline: a single `entityById(log, id)` reader,
a `listEntities(log)` enumerator (which the editor also wants, for the entities list), or
both. Whether an unknown id throws setup-loud like the verbs or returns `undefined` like
a lookup is a real decision — the verbs' setup-loud stance exists because they MUTATE,
which a reader does not. New public API surface, so it fails the AGENTS.md inline-fix
threshold on two counts.

**Trigger to revisit:** the first consumer that renders entity protection state — an
editor entities-list row showing a frozen badge or a baked marker, or a freeze toggle
that must seed its own checked state after a reload. Slotted for the F3a editor task
that wires freeze/bake into the chrome.

**Reference:** `docs/reference/core-modules.md` §`@furnace/core/field` (Smart objects —
freeze / bake; Staged generators, for the layout invariant);
`packages/core/src/field/reconfigure.ts` (`findEntityOp` — the in-core locator a
consumer would be duplicating); `packages/core/src/field/types.ts`
(`GeneratorEntity.frozen` / `.baked`).

**Status check (2026-07-23, F3a seal):** core did NOT gain the public reader; the editor
host re-derives (host-internal `entityRecord` + `listEntities`, plus the panel-side
`shared/field-entity.ts`) — the predicted duplication now has two consumers. The trigger
(a third consumer, or F3b's placement work needing entity iteration in core) stands.
