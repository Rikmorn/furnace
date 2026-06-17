/**
 * A deterministic, seeded pseudo-random number generator. Same seed → same
 * sequence on every machine (no `Math.random`/`Date`); the substrate for
 * reproducible procedural generation (`f(seed, pos)`).
 */
export type Rng = {
  /** Next float in `[0, 1)`. */
  float(): number;
  /** Next integer in `[minInclusive, maxExclusive)`. @throws if `max <= min`. */
  int(minInclusive: number, maxExclusive: number): number;
  /** `true` with probability `probability` (default 0.5).
   *  @throws if `probability` is outside `[0, 1]`. */
  bool(probability?: number): boolean;
  /** A uniformly-chosen element of `items`. @throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** A child stream deterministically derived from this seed + `label`, so
   *  subsystems (geometry vs props) draw from isolated, non-desyncing streams. */
  derive(label: string): Rng;
};
