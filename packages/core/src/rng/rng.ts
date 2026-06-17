import { FurnaceError } from "../errors.ts";
import type { Rng } from "./types.ts";

/** Hash a string/number seed to a 32-bit unsigned int (xmur3 for strings). */
function hashSeed(seed: number | string): number {
  if (typeof seed === "number") return seed >>> 0;
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** sfc32 generator, lanes expanded from one 32-bit seed via splitmix32. All
 *  state stays in 32-bit lanes (no 64-bit/BigInt) so determinism is exact. */
function makeNext(seedInt: number): () => number {
  let z = seedInt >>> 0;
  const splitmix = (): number => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  let a = splitmix();
  let b = splitmix();
  let c = splitmix();
  let d = splitmix();
  return (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Create a deterministic {@link Rng} from a numeric or string `seed`.
 * @param seed - a numeric seed (used as-is, masked to 32 bits) or string (hashed).
 */
export function create(seed: number | string): Rng {
  const seedInt = hashSeed(seed);
  const next = makeNext(seedInt);
  return {
    float() {
      return next();
    },
    int(minInclusive, maxExclusive) {
      if (maxExclusive <= minInclusive) {
        throw new FurnaceError(
          `rng.int: maxExclusive (${maxExclusive}) must exceed minInclusive (${minInclusive})`,
        );
      }
      return minInclusive + Math.floor(next() * (maxExclusive - minInclusive));
    },
    bool(probability = 0.5) {
      if (probability < 0 || probability > 1) {
        throw new FurnaceError(
          `rng.bool: probability must be in [0, 1], got ${probability}`,
        );
      }
      return next() < probability;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new FurnaceError("rng.pick: cannot pick from an empty array");
      }
      // Index is proven in-bounds for a non-empty array; noUncheckedIndexedAccess
      // widens the element to T|undefined, so narrow it back.
      return items[Math.floor(next() * items.length)] as T;
    },
    derive(label) {
      return create(Math.imul(seedInt ^ hashSeed(label), 2654435761) >>> 0);
    },
  };
}
