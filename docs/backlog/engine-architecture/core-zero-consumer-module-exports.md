# Core's zero-consumer module-index exports — the T4 projection has named its vocabulary

Named at the foundations programme's disposition sweep (2026-08-04); never filed; filed
at the T3 objectives audit (2026-08-08) as **a T4 planning input**. The programme's core
sweep counted ~110 names exported from module `index.ts` files with zero consumers
anywhere in the workspace. The deletion-pass instinct says prune — but the MCP surface
(T4) might PROJECT some of this vocabulary to agents, which would give zero-consumer
exports their first consumer, so pruning first would delete surface T4 then re-adds.

**T4c Task 6 closed the blocking half.** The door is final at nine tools and every row's
argument document is a projection of the daemon schema that validates it
(`packages/editor/src/daemon/mcp.ts`). So the projected vocabulary is now a written list
rather than an open question.

**RULING (T5 opening discussion, 2026-08-11) — the subtraction rule this entry
originally stated is RETIRED as too extreme.** As first written, the rule was
"everything core exports that the list below does not name is a deletion candidate."
The user overruled: `@furnace/core` is a capability library for consumers we don't
know — zero workspace consumers is not evidence against a public name, and one
consumer's vocabulary (the editor's MCP door) never defines the library's surface. The
repo's own canon agrees (`api-posture.md` guiding principle: low-level unopinionated
GPU-resource tier, bias = generality; `core-modules.md`'s curated `_`-internal
boundary). **T5 therefore runs a classification audit, keep-by-default:**

- **Keep (the default):** the name is capability vocabulary at its module's tier,
  shaped per R1–R9. Zero current consumers is not a strike against it.
- **Cookbook debt:** a Tier-1 capability with no cookbook demo files the missing demo —
  the constructive opposite of deletion.
- **Delete (a per-name argument required):** wrong tier (an R8 violation — a
  convenience folded into core vocabulary), an orphaned higher-tier convenience with a
  scene-style argument (`core/scene`'s deletion precedent: nothing below it ever
  depended on it), or a genuine leak that escaped the `_`-internal convention.

The list below stays useful as **evidence of agent consumption for world-tier names** —
it is NOT the protection list. It also carries the one ordering constraint: if T5's
polish task ships the fourth `session_query` arm from
`agent-cannot-read-generator-params.md`, the `paramSchema` documents become Relayed
vocabulary, so settle that scope before finalizing the audit. The T4c seal's "T5's
deletion set" phrasing and `editor-architecture.md` §27.4's subtraction wording are
superseded by this ruling (both annotated/updated 2026-08-11).

The count above stays spec-era (sweep scope: the T1 core package audit) and must be
**re-derived at pickup** — T3d and T4a/b/c all moved core surface.

## What T4 named — the projected vocabulary

Derived from the nine advertised documents plus the payloads the daemon relays back.
Two routes reach an agent, and both count as "named":

1. **Advertised** — an agent reads the name off an `inputSchema` and sends it.
2. **Relayed** — an agent reads the name off an answer the chrome built.

### Advertised (an agent spells these)

- `@furnace/core/field` — the whole **brush-op vocabulary**, mirrored by
  `packages/editor/src/daemon/op-schema.ts` and derived as a type by
  `packages/editor/src/shared/field-op.ts`: `BrushOp` (the `kind: "brush"` arm of the op
  union), its four `effect` values (`dig`, `fill`, `paint`, `smooth`), the three brush
  shapes (`sphere`, `box`, `capsule` with `center`/`radius`/`halfExtents`/`a`/`b`), the
  five mask kinds (`organic-only`, `kit-only`, `class`, `solid-only`, `selection`), the
  three `SelectionSpec` kinds (`region`, `flood-material`, `flood-void`), `SmoothParams`
  (`strength`, `iterations`, `mode`), `hollow`, and `MAX_SELECTION_BUDGET` — which is
  advertised as a literal ceiling and pinned type-equal to core's constant.
- `@furnace/core/field` — **generator ids**, as the `generate` row's `generatorId`:
  `hall`, `maze`, `cave`, `scatter` (`FIELD_GENERATORS`). Their PARAMS are core's
  `paramSchema` documents and are NOT advertised — see the gap filed at
  `docs/backlog/editor-and-tooling/agent-cannot-read-generator-params.md`, which is the
  one place this projection is incomplete.

### Relayed (an agent reads these back)

- `commitGenerator` / `generatorById` / `logApplyGroup` (`field-mutation.ts`) — the three
  core entry points every agent write goes through. `logApplyGroup` was a **zero-consumer
  export until T4c** and is the worked example of why this entry blocked the prune.
- `raycastField`, `PlacementRecord`, `SelectionSpec`, `FieldStore` (`field-query.ts`) —
  what the spatial read is built out of.
- `GeneratorEntity` fields, projected: `entityId`, `generator`, `seed`, `region`,
  `frozen`, `baked`, plus per-archetype placement counts.
- `@furnace/core/registry` — `FurnaceMeta`, `toJsonSchema`, `parseOrThrow`,
  `defineGenerator`'s emitted `paramSchema`/`defaults`. `parseOrThrow`'s MESSAGE reaches
  an agent verbatim when a generator param is refused, which makes its wording part of
  the agent contract.

### Named by nothing on this door

Everything else. In particular the door projects **no** renderer, camera, material,
shader, binding, post-effect, physics or mesh vocabulary at all — an agent never spells
one and never reads one back. Under the 2026-08-11 ruling that means the door's evidence
says nothing either way about those names: they are judged purely as capability surface
(keep-by-default), never as a deletion block.

## Trigger to revisit

- **T5's classification audit**, immediately. The blocking dependency is discharged:
  re-derive the zero-consumer set against head, then classify each name per the ruling
  above (keep / cookbook debt / delete-with-argument). The door list is consulted as
  evidence, not applied as a filter.

## Reference

- `packages/editor/src/daemon/mcp.ts` (`TOOLS`, `advertise`) — the nine rows and the
  projection; `packages/editor/src/daemon/op-schema.ts` — the mirrored op vocabulary;
  `packages/core/src/*/index.ts`; `docs/reference/core-modules.md`;
  `docs/reference/editor-architecture.md` §27.4.
