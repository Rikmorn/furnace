// packages/dungeon/src/world/region.ts
// What survives the region world's retirement: the three plain shapes the dungeon's own
// modules still share — a world-space vector, and the material descriptor + posture pair the
// MaterialCache is keyed on. No generator, spec, or placement vocabulary remains here.

/** World-space 3-component vector as a tuple. */
export type Vec3 = [number, number, number];

/** RGBA material descriptor for a rendered surface: base colour plus the specular
 *  (rgb + exponent) the lit shaders consume. `MaterialCache` keys its GPU materials on it. */
export type MaterialDescriptor = {
  color: [number, number, number, number];
  specular: [number, number, number, number];
};

/** Whether an instanced group's material lights normally or glows (unlit + bloom) — the
 *  `MaterialCache.getInstanced` discriminant. */
export type MaterialPosture = "lit" | "emissive";
