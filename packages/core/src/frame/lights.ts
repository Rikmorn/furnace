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
 * - Lights (16 × 80 B each): posRange, dirType, colorInt, spotCos, shadow per
 *   light. The `shadow` lane is `(slot, depthBias, normalBias, _)`; `slot` is
 *   −1 when the light casts no shadow.
 * - Shadow matrices (MAX_SHADOW_CASTERS × 64 B each): per-caster light-space
 *   `mat4x4` (view·proj, raw clip space), indexed by the per-light `shadow.slot`.
 *
 * Total: 64 + 16 × 80 + MAX_SHADOW_CASTERS × 64 = 1600 B.
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
  /**
   * In-shader constant subtracted from the receiver's compare depth to fight
   * acne. This is **normalized [0,1] depth**, so use a *small* value — roughly
   * `0.001`–`0.01` (the WebGPU shadow sample uses `~0.007`). Values near `1`
   * push every receiver in front of the stored depth and disable shadows
   * entirely. Defaults to `0`; the primary acne defense is the engine's
   * slope-scaled hardware bias, with this a per-light nudge on top.
   */
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
  /**
   * In-shader constant subtracted from the receiver's compare depth to fight
   * acne. This is **normalized [0,1] depth**, so use a *small* value — roughly
   * `0.001`–`0.01` (the WebGPU shadow sample uses `~0.007`). Values near `1`
   * push every receiver in front of the stored depth and disable shadows
   * entirely. Defaults to `0`; the primary acne defense is the engine's
   * slope-scaled hardware bias, with this a per-light nudge on top.
   */
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
 * A resolved shadow caster: which light, its slot, and its light-space matrix
 * (view·proj, raw clip space; the receiver shader remaps NDC→shadow-map UV when
 * sampling, and the caster pass uses it as the depth-pass clip transform).
 */
export type ShadowCaster = {
  lightIndex: number;
  slot: number;
  /** Light-space view·proj (clip-space) matrix; column-major, exactly 16 elements. */
  viewProj: Float32Array;
  depthBias: number;
  normalBias: number;
};

/**
 * Max lights per frame in the fixed uniform-array Scene UBO. Forward uniform
 * renderers cap hard and low; 16 is conventional and fits the 64 KiB budget.
 */
export const MAX_LIGHTS = 16;

/**
 * Max shadow-casting lights per frame. The Scene UBO carries one light-space
 * `mat4x4` per slot; a per-light `shadow.slot` (−1 = no shadow) indexes into
 * this fixed array. Kept small (forward uniform renderer) and conventional.
 */
export const MAX_SHADOW_CASTERS = 4;

const FLOATS_PER_VEC4 = 4;
const VEC4_PER_LIGHT = 5; // posRange, dirType, colorInt, spotCos, shadow
const HEADER_VEC4 = 4; // ambientSky, ambientGround, lightCount, _reserved
const HEADER_FLOATS = HEADER_VEC4 * FLOATS_PER_VEC4; // 16
const FLOATS_PER_LIGHT = VEC4_PER_LIGHT * FLOATS_PER_VEC4; // 20
const MAT4_FLOATS = 16;

/** header(64B) + 16 lights × 80B + MAX_SHADOW_CASTERS mat4 × 64B = 1600 B. */
export const SCENE_BYTE_SIZE =
  (HEADER_FLOATS + MAX_LIGHTS * FLOATS_PER_LIGHT) * 4 +
  MAX_SHADOW_CASTERS * MAT4_FLOATS * 4;

/** Float index where the `shadowMatrices` tail begins (after all light records). */
const SHADOW_MATRICES_FLOAT_OFFSET =
  HEADER_FLOATS + MAX_LIGHTS * FLOATS_PER_LIGHT;

/** Float offset of the per-light `shadow` lane (5th vec4) within a light record. */
const SHADOW_LANE_FLOAT_OFFSET = 16;

/** Sentinel slot value meaning "this light casts no shadow". */
const NO_SHADOW_SLOT = -1;

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
 *
 * **Shadow lane exception.** Unlike the type-irrelevant `posRange`/`spotCos`
 * lanes, the `shadow` lane (5th vec4) IS written for every packed light: its
 * `slot` defaults to −1 (no shadow), so the shader can read `shadow.slot`
 * unconditionally and branch on `slot >= 0`. Any `casters` passed overlay the
 * matching light's lane (`slot`, `depthBias`, `normalBias`) and write that
 * caster's `viewProj` into the `shadowMatrices` tail at `slot`. Casters whose
 * `lightIndex` is beyond `lightCount` are skipped (the light was clamped out).
 */
export function _packScene(
  out: ArrayBuffer,
  lights: readonly Light[] | undefined,
  ambient: Ambient | undefined,
  casters: readonly ShadowCaster[] = [],
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
    const o = HEADER_FLOATS + i * FLOATS_PER_LIGHT;
    writeLight(f, o, list[i] as Light);
    // shadow lane (5th vec4): default to no-shadow (slot −1, zero biases).
    f[o + SHADOW_LANE_FLOAT_OFFSET] = NO_SHADOW_SLOT;
    f[o + SHADOW_LANE_FLOAT_OFFSET + 1] = 0;
    f[o + SHADOW_LANE_FLOAT_OFFSET + 2] = 0;
    f[o + SHADOW_LANE_FLOAT_OFFSET + 3] = 0;
  }

  for (const c of casters) {
    if (c.lightIndex >= count) continue;
    // Runtime-quiet: `_packScene` runs on the per-frame render path, so a bad slot
    // must never throw (would crash the render loop). The caster producer
    // (_collectShadowCasters) clamps slots by construction; this guards defensively.
    if (c.slot < 0 || c.slot >= MAX_SHADOW_CASTERS) continue;
    const lo = HEADER_FLOATS + c.lightIndex * FLOATS_PER_LIGHT;
    f[lo + SHADOW_LANE_FLOAT_OFFSET] = c.slot;
    f[lo + SHADOW_LANE_FLOAT_OFFSET + 1] = c.depthBias;
    f[lo + SHADOW_LANE_FLOAT_OFFSET + 2] = c.normalBias;
    const mo = SHADOW_MATRICES_FLOAT_OFFSET + c.slot * MAT4_FLOATS;
    f.set(c.viewProj, mo);
  }

  return { overflowed: list.length > MAX_LIGHTS };
}

/** Write one light's type-specific vec4 lanes starting at float index `o`.
 *  The 5th (`shadow`) lane is written by the caller, not here. */
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
