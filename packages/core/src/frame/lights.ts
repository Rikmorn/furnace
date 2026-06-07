/**
 * Scene lighting data model and Scene UBO packer.
 *
 * `Light` and `Ambient` are plain per-frame value types (no handle / lifecycle),
 * mirroring the `Camera` posture. Consumers pass them each frame via
 * `RenderOptions.lights` (Task 4).
 *
 * Scene UBO byte layout (std140-safe, all vec4 lanes):
 * - Header (64 B): ambientSky @0, ambientGround @16, lightCount @32,
 *   _reserved @48.
 * - Lights (16 × 64 B each): posRange, dirType, colorInt, spotCos per light.
 */

/** A 3-component number tuple used for light color / direction / position input. */
type Vec3Tuple = readonly [number, number, number];

/**
 * Per-light shadow config (shadow mapping). Presence on a `directional`/`spot`
 * light = that light casts shadows. Technique-neutral opt-in; the fields are
 * shadow-mapping params. Omitted bias fields fall back to engine defaults.
 */
export type DirectionalShadow = {
  /** Half width/height of the orthographic shadow frustum (world units). */
  orthoHalfExtent: number;
  /** Near plane of the ortho frustum. */
  near: number;
  /** Far plane of the ortho frustum. */
  far: number;
  /** World point the ortho box is centered on / looks at. Default `[0,0,0]`. */
  target?: Vec3Tuple;
  /** Distance back along `-direction` to place the light eye. Default `far/2`. */
  distance?: number;
  /** In-shader constant bias subtracted from the compare depth (acne). */
  depthBias?: number;
  /** Texel-scaled normal-offset bias (acne at grazing angles). */
  normalBias?: number;
};

/**
 * Per-light shadow config for a spot light (perspective frustum from the cone).
 * Presence on a `spot` light = that light casts shadows. Omitted fields fall
 * back to engine defaults.
 */
export type SpotShadow = {
  /** Near plane of the perspective frustum. Default `0.1`. */
  near?: number;
  /** Far plane. Default = the light's `range`. */
  far?: number;
  /** In-shader constant bias subtracted from the compare depth (acne). */
  depthBias?: number;
  /** Texel-scaled normal-offset bias (acne at grazing angles). */
  normalBias?: number;
};

/** A directional light — infinitely far, parallel rays (the sun). */
export type DirectionalLight = {
  type: "directional";
  /** World-space travel direction (sun pointing down = `[0,-1,0]`). The shader
   *  uses `L = -direction`. */
  direction: Vec3Tuple;
  /** Linear RGB. */
  color: Vec3Tuple;
  /** Calibrated so a white surface under one key light peaks ≈1.0 (no 1/π). */
  intensity: number;
  /** Optional shadow-mapping config. Presence enables shadow casting for this light. */
  shadow?: DirectionalShadow;
};

/** A point light — radiates from a position, windowed inverse-square falloff. */
export type PointLight = {
  type: "point";
  position: Vec3Tuple;
  color: Vec3Tuple;
  intensity: number;
  /** Windowed inverse-square cutoff radius (world units). */
  range: number;
};

/** A spot light — a point light constrained to a cone. */
export type SpotLight = {
  type: "spot";
  position: Vec3Tuple;
  /** Cone axis = travel direction. */
  direction: Vec3Tuple;
  color: Vec3Tuple;
  intensity: number;
  range: number;
  /** Radians; full intensity inside this half-angle. */
  innerAngle: number;
  /** Radians; falls to zero by this half-angle. */
  outerAngle: number;
  /** Optional shadow-mapping config. Presence enables shadow casting for this light. */
  shadow?: SpotShadow;
};

/**
 * A scene light. Plain immutable data (no handle / lifecycle) — matches the
 * `Camera` value-type posture. Passed per frame via `RenderOptions.lights`.
 */
export type Light = DirectionalLight | PointLight | SpotLight;

/**
 * Hemisphere ambient term. `intensity` scales both sky/ground (kept a small
 * fraction of the key light so it does not eat HDR headroom).
 */
export type Ambient = { sky: Vec3Tuple; ground: Vec3Tuple; intensity: number };

/**
 * Max lights per frame in the fixed uniform-array Scene UBO. Forward uniform
 * renderers cap hard and low; 16 is conventional and fits the 64 KiB budget.
 */
export const MAX_LIGHTS = 16;

const FLOATS_PER_VEC4 = 4;
const VEC4_PER_LIGHT = 4; // posRange, dirType, colorInt, spotCos
const HEADER_VEC4 = 4; // ambientSky, ambientGround, lightCount, _reserved
const HEADER_FLOATS = HEADER_VEC4 * FLOATS_PER_VEC4; // 16
const FLOATS_PER_LIGHT = VEC4_PER_LIGHT * FLOATS_PER_VEC4; // 16

/** Byte size of the Scene UBO: 64 B header + 16 × 64 B lights = 1088. */
export const SCENE_BYTE_SIZE =
  (HEADER_FLOATS + MAX_LIGHTS * FLOATS_PER_LIGHT) * 4;

const LIGHT_COUNT_U32_INDEX = 8; // lightCount.x at byte 32 → u32 element 8
const TYPE_DIRECTIONAL = 0;
const TYPE_POINT = 1;
const TYPE_SPOT = 2;

const DEFAULT_AMBIENT: Ambient = {
  sky: [0.6, 0.65, 0.75],
  ground: [0.2, 0.2, 0.22],
  intensity: 0.05,
};

/**
 * Pack `lights` + `ambient` into the Scene UBO byte layout (see
 * `engine-conventions.md` §Binding contract). Pure: writes into `out` (a
 * `SCENE_BYTE_SIZE` `ArrayBuffer`) and reports whether the light list
 * overflowed `MAX_LIGHTS` (the caller warns once — never throws on the
 * per-frame path). Engine-internal; exported for tests.
 *
 * **Unwritten-lane contract.** `_packScene` writes only the lanes that are
 * live for each light's type (directional: `dirType` + `colorInt`; point:
 * `posRange` + `dirType.w` tag + `colorInt`; spot: `posRange` + `dirType` +
 * `spotCos` + `colorInt`) and only the first `lightCount` light records.
 * Type-irrelevant lanes (e.g. `posRange` for a directional light) and all
 * lanes for indices ≥ `lightCount` are left at `out`'s prior content —
 * the engine reuses a single scratch `ArrayBuffer` frame-to-frame and
 * `_packScene` does **not** zero it. The consuming shader is therefore
 * contracted to branch on each light's `dirType.w` type tag and iterate only
 * `0..lightCount`; it must never read type-irrelevant or beyond-count lanes.
 */
export function _packScene(
  out: ArrayBuffer,
  lights: readonly Light[] | undefined,
  ambient: Ambient | undefined,
): { overflowed: boolean } {
  const f = new Float32Array(out);
  const u = new Uint32Array(out);
  const amb = ambient ?? DEFAULT_AMBIENT;

  // Header: ambientSky (xyz = sky color, w = intensity)
  f[0] = amb.sky[0];
  f[1] = amb.sky[1];
  f[2] = amb.sky[2];
  f[3] = amb.intensity;
  // Header: ambientGround (xyz = ground color, w unused)
  f[4] = amb.ground[0];
  f[5] = amb.ground[1];
  f[6] = amb.ground[2];

  const list = lights ?? [];
  const count = Math.min(list.length, MAX_LIGHTS);
  u[LIGHT_COUNT_U32_INDEX] = count;

  for (let i = 0; i < count; i++) {
    writeLight(f, HEADER_FLOATS + i * FLOATS_PER_LIGHT, list[i] as Light);
  }
  return { overflowed: list.length > MAX_LIGHTS };
}

/** Write one light's 4 vec4 lanes starting at float index `o`. */
function writeLight(f: Float32Array, o: number, light: Light): void {
  // colorInt lane (3rd vec4 = +8): rgb color + w intensity — all lights share this.
  f[o + 8] = light.color[0];
  f[o + 9] = light.color[1];
  f[o + 10] = light.color[2];
  f[o + 11] = light.intensity;

  if (light.type === "directional") {
    // posRange (1st vec4 = +0): unused for directional (no position, no range).
    // dirType (2nd vec4 = +4): xyz direction, w type tag.
    f[o + 4] = light.direction[0];
    f[o + 5] = light.direction[1];
    f[o + 6] = light.direction[2];
    f[o + 7] = TYPE_DIRECTIONAL;
  } else {
    // posRange (1st vec4 = +0): xyz position, w range — point and spot share this.
    f[o + 0] = light.position[0];
    f[o + 1] = light.position[1];
    f[o + 2] = light.position[2];
    f[o + 3] = light.range;

    if (light.type === "spot") {
      // dirType (2nd vec4 = +4): xyz direction, w type tag.
      f[o + 4] = light.direction[0];
      f[o + 5] = light.direction[1];
      f[o + 6] = light.direction[2];
      f[o + 7] = TYPE_SPOT;
      // spotCos (4th vec4 = +12): x innerCos, y outerCos.
      f[o + 12] = Math.cos(light.innerAngle);
      f[o + 13] = Math.cos(light.outerAngle);
    } else {
      // dirType.w = type tag for point (xyz direction unused).
      f[o + 7] = TYPE_POINT;
    }
  }
}
