// packages/core/src/field/rng.ts — the field module's Pr-2-safe integer RNG.
//
// Moved here out of generators.ts (F3b Task 2) so the cave and scatter
// generators can share it WITHOUT importing generators.ts — generators.ts
// imports the cave/scatter defs to register them in FIELD_GENERATORS, so a
// generator importing the RNG back out of generators.ts would be a cycle.
// A leaf module with no field imports breaks it.
//
// Distinct from `@furnace/core/rng` (the general float sfc32 stream): this is
// the INTEGER-ONLY lineage (FNV-1a seed hash → Math.imul mixer) the generators
// need for cross-engine determinism (Pr-2) — spec-exact in JS on every engine,
// no transcendentals, no float-seeded tables.

/** FNV-1a 32-bit over the seed string (the donor pieces.ts variant-hash
 *  pattern) — VERBATIM donor port. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32-shape uint32 stream: Math.imul + shifts only. Every operation is
 *  integer (spec-exact in JS on every engine) — the Pr-2-safe RNG for grid
 *  content. VERBATIM donor port. */
export function makeIntRng(seedWord: number): () => number {
  let state = seedWord >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// ─── float adapters over the integer stream (Pr-2: only + - * /) ───
// Shared by the cave and scatter generators; the mapping to [0, 1) is an EXACT
// power-of-two division (divisor 0x1000000, NOT 0xFFFFFF), so a draw is half-open
// [0, 1) and never reaches 1.0 — the property braid=1 / density edges rely on.

/** A uint32 stream draw mapped to `[0, 1)` via an exact power-of-two division. */
export const rand01 = (rng: () => number): number => (rng() >>> 8) / 0x1000000;

/** A float in `[lo, hi)` from one stream draw. */
export const randRange = (rng: () => number, lo: number, hi: number): number =>
  lo + rand01(rng) * (hi - lo);

/** An integer in `[lo, hiExclusive)` from one stream draw. */
export const randInt = (
  rng: () => number,
  lo: number,
  hiExclusive: number,
): number => lo + (rng() % (hiExclusive - lo));
