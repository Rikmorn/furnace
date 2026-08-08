# `furnace.*` vendor keys lost their shared type — re-typed at T4

Filed at the T3 objectives audit (2026-08-08); disposition by user ruling: **re-file for
T4**, where the type's real consumer arrives.

## Context

The foundations design required "`furnace.*` vendor keys under one shared type". T1b
built `fieldFurnaceMeta`; T2 deleted it as an orphan of the scene system's death (a
sound deletion of the unconsumed artifact — but the CLAUSE was never retired, and the
audit classified the gap as a silent regression). At head the defining side writes
untyped literals — `.meta({ default: 8, furnace: { unit: "cells" } })` in
`generators.ts:431`, `scatter.ts:82`, `cave.ts:1256` — and the only type in the
workspace is the CONSUMER's private `SchemaNode.furnace`
(`packages/editor/src/frontend/inspector/types.ts:28`). A misspelt vendor key on the
defining side fails silently: the editor simply doesn't render the hint.

## Trigger to revisit

- **T4 MCP planning** (the ride): the JSON-Schema projection serializes `.meta()`
  through `toJsonSchema`'s furnace-hoisting, so the projection is the type's first
  consumer with teeth — define the shared type in `core/registry` beside `z`, type the
  defining sites, and let the editor's `SchemaNode.furnace` narrow from it.

## Reference

- `packages/core/src/registry/registry.ts` (`toJsonSchema`'s furnace hoist);
  `packages/core/src/field/generators.ts:431` (one of the untyped sites);
  `packages/editor/src/frontend/inspector/types.ts:28` (the consumer's private type).
