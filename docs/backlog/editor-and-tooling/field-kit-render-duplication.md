# Kit-render math duplicated: field-host.ts + field-world.ts (2nd occurrence)

**Context.** F2a (2026-07-16) ported the kit-instance render math — `yawQuat` quarter
table, piece-color selection, variant tint jitter, packed TRS matrix building over
`mesh.createInstanced` — into BOTH the editor's `field-host.ts` and the dungeon's
`field-world.ts` (deliberately byte-for-byte, flagged in code at both sites). Second
occurrence: the repo rule tolerates duplication until the third.

The third consumer is likely F2b itself (stamp ghost previews render kit pieces too).
When it lands, extract a shared `@furnace/core/field` kit-render helper — which also
unifies the litInstanced normal-shortcut invariant (uniform-scale precondition comment
currently duplicated) and a shared unit-cube geometry.

**Trigger to revisit:** a third kit-render consumer, OR any F2b task touching kit
rendering — whichever fires first.

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (buildKit path),
`packages/dungeon/src/field-world.ts` (kit instance loading), executor flag #2 in the
F2a report.
