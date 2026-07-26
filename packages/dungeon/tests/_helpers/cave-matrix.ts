// The P-F3-1 cave population — 3 themes × 2 verticality × 2 seeds = 12 configs, and the region
// every one of them is carved into. SINGLE SOURCE, and the reason this file exists: the walk
// harness (`tests/field-cave-walk.gpu.test.ts`) walks this population while
// `scripts/measure-analyze.ts` measures it, and until Task 8 the two RESTATED the same three
// arrays with nothing detecting a divergence — a matrix edited on one side kept the other
// measuring the old twelve while still labelling its table "the population the bar names".
//
// Deliberately GPU-free and side-effect-free, which is what lets a plain `bun scripts/…` run
// import it. The harness itself cannot be imported: it awaits a WebGPU context at module scope.
//
// Topology note (do NOT over-count diversity): `theme` selects only the SN carve SKIN — it never
// reaches `buildCaveSkeleton` — so these are 4 distinct passage LAYOUTS (2 verticality × 2 seeds)
// × 3 carve skins. For a given (verticality, seed) the walk lanes are identical across themes;
// only the carved collider surface differs.
import { generatorById } from "@furnace/core/field";
import type { Vec3 } from "../../src/region.ts";

/** The extent (m) every config is carved into. */
export const CAVE_EXTENT: Vec3 = [20, 10, 20];
/** The carve region: `min` is the origin, so world coordinates ARE region-local here. */
export const CAVE_REGION = { min: [0, 0, 0] as Vec3, max: CAVE_EXTENT };

const THEMES = ["mined", "organic", "mixed"] as const;
const VERTICALITIES = [0.25, 0.75] as const;
const SEEDS = [1, 7] as const;

/** One cell of the matrix. Deliberately carries no `name`: the harness names a BAKED WORLD and
 *  the measurement names a TABLE ROW, so each side derives its own label from these three axes
 *  rather than sharing a string that means two things. */
export type CaveConfig = {
  theme: string;
  verticality: number;
  seed: number;
  /** Strict params — the cave generator's own schema defaults plus this cell's two overrides.
   *  `evaluate` is setup-loud, so a partial param set is rejected rather than defaulted. */
  params: Record<string, unknown>;
};

/** The 12 configs, in a stable order (theme outermost, then verticality, then seed). Re-reads
 *  the generator's defaults per call, so a schema change lands here without a stale copy. */
export const caveConfigs = (): CaveConfig[] => {
  const defaults = generatorById("cave").defaults;
  return THEMES.flatMap((theme) =>
    VERTICALITIES.flatMap((verticality) =>
      SEEDS.map((seed) => ({
        theme,
        verticality,
        seed,
        params: { ...defaults, theme, verticality },
      })),
    ),
  );
};
