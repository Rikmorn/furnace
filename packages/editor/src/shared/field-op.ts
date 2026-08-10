// AN OP A CALLER WROTE — the field mutation vocabulary as it crosses the agent door.
//
// The neutral floor's fourth daemon-facing member (after `wire.ts` and `capture.ts`), here
// for exactly their reason: the daemon must VALIDATE this shape and may not touch anything
// that imports the engine, while the host must ACCEPT it and is nothing but engine. A shape
// both ends name has to sit under both, and `src/shared/` is the only floor that is.
//
// TYPE-ONLY IMPORT OF CORE, which is erased — `shared/field-entity.ts`'s precedent, and the
// property `tests/frontend-no-engine-leakage.test.ts` scans this directory to keep. What
// that buys is the thing a hand-mirrored copy could not: `BrushOpInput` is DERIVED from
// core's own `BrushOp`, so a fifth effect, a fourth shape kind or a sixth mask arrives here
// by construction rather than by somebody remembering. The daemon's zod schema is the one
// hand-written half (zod is banned from this floor), and it is pinned against this type at
// COMPILE time rather than by review — see `daemon/op-schema.ts`.
import type { BrushOp } from "@furnace/core/field"; // type-only: erased

/**
 * One brush op as a CALLER hands it over — core's {@link BrushOp} minus the `id`.
 *
 * THE `id` IS THE OMISSION AND THE WHOLE POINT. In core the field is required, because a
 * logged op HAS one; but ids are the LOG's to mint, and a caller writing a batch has no
 * standing to name them. `field.logApplyGroup` says so in as many words — it stamps ids on
 * COPIES from its own counter and treats whatever the caller passed as a placeholder — so a
 * type that asked for one would be asking for a number that is guaranteed to be discarded,
 * and an agent would reasonably conclude it meant something.
 *
 * WHY `Omit` AND NOT A RESTATEMENT. Every field below the omission is core's, unchanged and
 * unnarrowed: the three shape kinds, the five masks, the four effects, `material`, `smooth`,
 * `hollow`. The mask union was the one candidate for narrowing — `{kind:"selection"}` embeds
 * a `SelectionSpec`, which reads like host-private machinery — and it survived on inspection:
 * that spec is three plain JSON shapes (a region box, a material flood, a void flood), all of
 * them composable by a caller that can name coordinates. Nothing in this vocabulary requires
 * a live viewport to construct, so nothing in it is withheld.
 *
 * WHAT IT DOES NOT ADMIT is core's other two op kinds. `PatchOp` carries typed arrays of
 * per-cell writes (a compaction and generator-emission form, base64 on the wire) and
 * `PlacementOp` carries prop records; neither is a thing a caller AUTHORS, and both reach the
 * log through the paths that produce them. `logApplyGroup` takes `BrushOp[]` for the same
 * reason, so this omission is core's rather than ours.
 */
export type BrushOpInput = Omit<BrushOp, "id">;
