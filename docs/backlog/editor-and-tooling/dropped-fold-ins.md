---
summary: four small T3 fold-ins planned, never executed and never recorded as dropped — a naked-cast comment, chip primitives, a duplicated world-name regex, a wire type test
---

# The four T3 fold-ins that dropped between plan and exit

The T3 tranche plan named four small fold-ins; none was executed and none was recorded as
dropped — the T3 objectives audit (2026-08-08) surfaced all four as the programme's
cleanest specimen of silent record loss. Filed here so the drop has a trace; each is
small and none blocks anything.

## The four

1. **`field-client.ts`'s `defaultSpawn` naked-cast comment.** The `new Worker(...) as unknown as
   WorkerLike` cast still carries no explanatory comment (the block above it documents a
   different construct). One comment.
2. **`StatusBar` chip primitives → `components/ui/`.** `CHIP_SHAPE`,
   `INTERACTIVE_CHIP_CLASS`, `ChipButton`, `ChipPopover` are still local to
   `StatusBar.tsx`; the ONE-control-library rule (Biome GritQL enforced for native
   controls) argues they belong in `components/ui/`. Mechanical move.
3. **`WORLD_NAME_RE` consolidation.** Two live copies remain — `daemon/worlds.ts`
   (exported) and `frontend/lib/generation.ts`'s `isValidWorldName` (inlined literal) — with nothing
   comparing them. (The header's dangling pointer at `worlds.ts` to the T2-deleted
   `dungeon/src/bake.ts` copy was fixed inline at the audit.)
4. **`VerifyVerdictWire` structural type test.** `analyzer-protocol.ts`'s wire twin of
   dungeon's `VerifyVerdict` is held identical by prose instruction only (~10-line test
   to write; the deliberate no-import stance stays).

## Trigger to revisit

- The next tranche touching any of the four homes takes its item in the same commit
  (the brush-clamp entry's pattern).
- T5's prune otherwise sweeps the batch.

## Reference

- `packages/editor/src/field-host/field-client.ts` ·
  `packages/editor/src/frontend/components/shell/StatusBar.tsx` ·
  `packages/editor/src/daemon/worlds.ts` + `packages/editor/src/frontend/lib/generation.ts` ·
  `packages/editor/src/field-host/analyzer-protocol.ts` +
  `packages/dungeon/src/agent/walk-probe.ts` (`VerifyVerdict`).
