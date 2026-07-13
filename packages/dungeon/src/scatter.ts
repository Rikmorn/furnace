import type { Rng } from "@furnace/core/rng";
import { mat4, quat, vec3 } from "@furnace/core/transform";
import type {
  InstanceData,
  InstanceGroup,
  MaterialDescriptor,
  ScatterLayerSpec,
  Vec3,
} from "./region.ts";
import type { MeshData } from "./surface-nets.ts";

/** One scatter placement: a point on the surface plus that point's face normal. */
export type Sample = { position: Vec3; normal: Vec3 };

/** A surface that scatter can area-weight-sample: a triangle count, a per-triangle
 *  area, and a barycentric point+normal sampler. One code path for caves (mesh
 *  triangles) and grid halls (a flat rect adapter — see {@link rectsSurface}). */
export type SampleableSurface = {
  triCount: number;
  /** Area of triangle `t`, in world units squared. */
  area(t: number): number;
  /** A barycentric (√-debiased) point + face normal on triangle `t`, given two
   *  `[0,1)` draws. */
  sample(t: number, r1: number, r2: number): Sample;
};

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Adapt a Surface-Nets `MeshData` into a `SampleableSurface` (one triangle per
 *  index triple; face normal from the winding). */
export function meshSurface(md: MeshData): SampleableSurface {
  const P = md.positions;
  const I = md.indices;
  const vtx = (v: number): Vec3 => [
    P[3 * v] as number,
    P[3 * v + 1] as number,
    P[3 * v + 2] as number,
  ];
  const tri = (t: number): [Vec3, Vec3, Vec3] => [
    vtx(I[3 * t] as number),
    vtx(I[3 * t + 1] as number),
    vtx(I[3 * t + 2] as number),
  ];
  return {
    triCount: I.length / 3,
    area(t) {
      const [a, b, c] = tri(t);
      const n = cross(sub(b, a), sub(c, a));
      return 0.5 * Math.hypot(n[0], n[1], n[2]);
    },
    sample(t, r1, r2) {
      const [a, b, c] = tri(t);
      const u = Math.sqrt(r1);
      const v = r2;
      const w0 = 1 - u;
      const w1 = u * (1 - v);
      const w2 = u * v; // PBR §13.6 uniform barycentric (√ removes corner bias)
      const position: Vec3 = [
        a[0] * w0 + b[0] * w1 + c[0] * w2,
        a[1] * w0 + b[1] * w1 + c[1] * w2,
        a[2] * w0 + b[2] * w1 + c[2] * w2,
      ];
      return { position, normal: norm(cross(sub(b, a), sub(c, a))) };
    },
  };
}

/** A flat axis-aligned floor rectangle: the XZ-extent `[minX,maxX] × [z0,z1]` at
 *  height `y`. The scatter anchor primitive for flat-floored themes (grid halls) —
 *  see {@link rectsSurface}. */
export type FloorRect = {
  minX: number;
  maxX: number;
  z0: number;
  z1: number;
  y: number;
};

/** One flat floor rect as a `SampleableSurface` — the per-rect building block
 *  {@link rectsSurface} composes. Samples uniformly across the rect at height `y`;
 *  the surface normal is always +Y so `scatter`'s floor slope-mask accepts it. */
function rectSurface(rect: FloorRect): SampleableSurface {
  const w = rect.maxX - rect.minX;
  const d = rect.z1 - rect.z0;
  const halfArea = (w * d) / 2;
  return {
    triCount: 2, // two equal halves keep the area-CDF + binary search well-formed
    area: () => halfArea,
    sample: (_t, r1, r2) => ({
      position: [rect.minX + r1 * w, rect.y, rect.z0 + r2 * d],
      normal: [0, 1, 0],
    }),
  };
}

/** A SET of disjoint floor rects as ONE area-weighted `SampleableSurface` (each rect
 *  contributes the two triangles of {@link rectSurface}, so the area CDF spreads
 *  samples across the rects in proportion to their area). Grid halls scatter over an
 *  anchor set — the interior minus pillar surrounds minus door lanes — not a single
 *  floor rect. An empty set is a zero-triangle surface (`scatter` returns no
 *  instances). */
export function rectsSurface(rects: FloorRect[]): SampleableSurface {
  const surfs = rects.map(rectSurface);
  const at = (t: number): SampleableSurface => {
    const s = surfs[t >> 1];
    if (!s) throw new Error(`scatter: rect surface ${t >> 1} out of range`);
    return s;
  };
  return {
    triCount: 2 * surfs.length,
    area: (t) => at(t).area(t & 1),
    sample: (t, r1, r2) => at(t).sample(t & 1, r1, r2),
  };
}

/** Build the area CDF once, then draw `n` area-weighted samples from `surf`.
 *  Pure given `rng` — draws in a fixed order (CDF pick, then two barycentric
 *  floats per sample), so the same seed yields byte-identical placements. */
export function _sampleSurface(
  surf: SampleableSurface,
  n: number,
  rng: Rng,
): Sample[] {
  const cdf = new Float64Array(surf.triCount);
  let total = 0;
  for (let t = 0; t < surf.triCount; t++) {
    total += surf.area(t);
    cdf[t] = total;
  }
  if (total === 0) return []; // zero-triangle / zero-area surface → no samples (avoid NaN OOB reads)
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng.float() * total;
    let lo = 0;
    let hi = surf.triCount - 1; // binary search the CDF
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if ((cdf[m] as number) < r) lo = m + 1;
      else hi = m;
    }
    out.push(surf.sample(lo, rng.float(), rng.float()));
  }
  return out;
}

/** A circular XZ exclusion region a scatter layer must avoid (e.g. doorways,
 *  the spawn point, prop footprints). `center.y` is ignored — masking is 2D. */
export type KeepOut = { center: Vec3; radius: number };

const UP: Vec3 = [0, 1, 0];
/** `dot(normal, UP)` at/below this → a ceiling. Single source for both the
 *  ceiling slope mask ({@link passesTarget}) and the ceiling hang anchor. */
const CEILING_COS = -0.6;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Slope mask: which surface orientations a layer's `target` accepts, by the
 *  cosine between the face normal and world up. */
function passesTarget(n: Vec3, target: ScatterLayerSpec["target"]): boolean {
  const c = dot(n, UP);
  if (target === "floor") return c >= 0.6;
  if (target === "wall") return Math.abs(c) <= 0.5;
  if (target === "ceiling") return c <= CEILING_COS;
  return true; // "any"
}

/**
 * Quaternion (x,y,z,w) that aligns the archetype's local +Y onto surface normal
 * `n`, then spins by `yaw` about the archetype up so +Y still maps onto `n`
 * (the yaw is applied first, in the +Y-up frame, then the align rotation — so
 * yaw never tilts +Y off `n`). Implements the gl-matrix `rotationTo` half-way
 * construction for +Y→`n` (there is no `quat.rotationTo` in `@furnace/core`),
 * with the antiparallel (`n = -Y`, the ceiling case) handled as a 180° turn
 * about +Z. `n` MUST be unit length.
 */
export function _orient(
  n: Vec3,
  yaw: number,
): [number, number, number, number] {
  const a = vec3.fromValues(0, 1, 0);
  const b = vec3.fromValues(n[0], n[1], n[2]);
  const d = vec3.dot(a, b);
  const align = quat.create();
  if (d < -0.999999) {
    // antiparallel (+Y vs -Y): a 180° turn about any axis ⊥ +Y. Use +Z.
    quat.fromAxisAngle(align, vec3.fromValues(0, 0, 1), Math.PI);
  } else if (d > 0.999999) {
    quat.identity(align);
  } else {
    const c = vec3.cross(vec3.create(), a, b);
    quat.normalize(
      align,
      quat.fromValues(c[0] as number, c[1] as number, c[2] as number, 1 + d),
    );
  }
  const yawQ = quat.fromAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), yaw);
  const out = quat.multiply(quat.create(), align, yawQ); // apply yaw (about +Y) first, then align +Y→n
  return [
    out[0] as number,
    out[1] as number,
    out[2] as number,
    out[3] as number,
  ];
}

function jitterTint(
  t: NonNullable<ScatterLayerSpec["tint"]>,
  rng: Rng,
): [number, number, number, number] {
  const j = (base: number) =>
    Math.max(0, Math.min(1, base + (rng.float() * 2 - 1) * t.jitter));
  return [j(t.rgb[0]), j(t.rgb[1]), j(t.rgb[2]), 1];
}

function surfaceArea(surf: SampleableSurface): number {
  let area = 0;
  for (let t = 0; t < surf.triCount; t++) area += surf.area(t);
  return area;
}

/** Blue-noise thinning: keep `samples` in order, dropping any within `r` (XZ) of
 *  an already-kept one. Backed by an array-keyed spatial hash looked up by cell
 *  key only (never iterated for output) — output order is `samples` order, so
 *  the result is deterministic. */
function spaceOut(samples: Sample[], r: number): Sample[] {
  // Cell size == r so any point within r of a candidate is at most one cell away
  // in each axis (|Δ| < r == cell) — the 3×3 neighbour scan below is then exact.
  // (A smaller r/√2 cell would put conflicts up to TWO cells away, which a 3×3
  // scan would miss.) Buckets hold multiple points since a cell's diagonal > r.
  const cell = r;
  const grid = new Map<string, Sample[]>(); // KEYED LOOKUP ONLY — never iterated
  const placed: Sample[] = [];
  for (const c of samples) {
    const ci = Math.floor(c.position[0] / cell);
    const cj = Math.floor(c.position[2] / cell);
    let ok = true;
    for (let di = -1; di <= 1 && ok; di++)
      for (let dj = -1; dj <= 1 && ok; dj++) {
        const bucket = grid.get(`${ci + di},${cj + dj}`);
        if (bucket)
          for (const q of bucket) {
            const dx = c.position[0] - q.position[0];
            const dz = c.position[2] - q.position[2];
            if (Math.hypot(dx, dz) < r) {
              ok = false;
              break;
            }
          }
      }
    if (!ok) continue;
    const key = `${ci},${cj}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(c);
    else grid.set(key, [c]);
    placed.push(c);
  }
  return placed;
}

const EMBED = 0.05; // sink slightly along -normal so items are seated, not floating
const DROP_MARGIN = 0.02; // dynamic props spawn this far above the surface so they never
//                            start interpenetrating; they free-fall a few cm and settle.

/** Per-instance variation in a FIXED draw order (yaw, scale, tint), then anchor the
 *  point to the surface. Floors/walls sink slightly into the surface along -normal;
 *  a ceiling instead HANGS below, its top tucked into the rock and its body dangling
 *  into the room (so a -Y normal doesn't bury the item up into the ceiling). */
function seat(s: Sample, spec: ScatterLayerSpec, rng: Rng): InstanceData {
  const yaw = rng.float() * Math.PI * 2;
  const scale =
    spec.scale.min + rng.float() * (spec.scale.max - spec.scale.min);
  const tint = spec.tint
    ? jitterTint(spec.tint, rng)
    : ([1, 1, 1, 1] as [number, number, number, number]);
  // Unit archetypes span ±0.5 along each local axis; after orient the +Y axis aligns
  // to the normal, so the item's half-height along the normal is 0.5*scale. For a
  // ceiling, push the CENTRE down the normal (into the room) by ~half the height so the
  // top tucks just into the surface and the body hangs below; otherwise sink slightly
  // into the surface (-EMBED). Note +normal*(-EMBED) is bit-identical to the old
  // -normal*EMBED, so the floor/wall path is unchanged.
  const onCeiling = dot(s.normal, UP) <= CEILING_COS; // surface normal points down → a ceiling
  // A `dynamic` prop must rest ON the surface (lifted), not sink into it: spawn its centre
  // half-its-height + a margin along the normal, then let physics settle it.
  const anchorAlongNormal = (): number => {
    if (spec.collision === "dynamic") return 0.5 * scale + DROP_MARGIN;
    if (onCeiling) return 0.5 * scale - EMBED;
    return -EMBED;
  };
  const anchor = anchorAlongNormal();
  const position: Vec3 = [
    s.position[0] + s.normal[0] * anchor,
    s.position[1] + s.normal[1] * anchor,
    s.position[2] + s.normal[2] * anchor,
  ];
  return { position, rotation: _orient(s.normal, yaw), scale, tint };
}

/**
 * Resolve one scatter layer over a surface into seated, varied instances.
 *
 * Pipeline: area-weight oversample (6× the target count) → cheap masks (slope
 * `target`, optional `density` field, `keepOut` exclusions, in that fixed order)
 * → blue-noise min-distance thinning at `spec.spacing.min` → per-instance
 * variation (yaw / scale / tint). Deterministic given `rng`: draws come from a
 * per-layer `rng.derive("scatter:" + spec.name)` stream (so adding or removing a
 * layer cannot reshuffle another's placements), and variation is drawn only for
 * accepted points in a fixed order. Returns `[]` for a zero-area surface.
 *
 * `spec.cluster` is NOT honoured this slice — a layer that sets it just gets
 * ungrouped scatter (two-level clustering is out of scope here).
 */
export function scatter(
  surf: SampleableSurface,
  spec: ScatterLayerSpec,
  rng: Rng,
  keepOut: KeepOut[],
): InstanceData[] {
  const srng = rng.derive(`scatter:${spec.name}`);
  const area = surfaceArea(surf);
  if (area === 0) return [];
  const target = Math.max(
    1,
    Math.round(area / (Math.PI * spec.spacing.min ** 2)),
  );
  const cands = _sampleSurface(surf, target * 6, srng);

  // Masks (slope → density → keep-out), in a fixed order. The density draw is
  // taken only when `spec.density` is set, preserving the draw sequence.
  const masked = cands.filter((c) => {
    if (!passesTarget(c.normal, spec.target)) return false;
    if (spec.density && srng.float() > spec.density(c.position)) return false;
    for (const k of keepOut) {
      const dx = c.position[0] - k.center[0];
      const dz = c.position[2] - k.center[2];
      if (Math.hypot(dx, dz) < k.radius) return false;
    }
    return true;
  });

  return spaceOut(masked, spec.spacing.min).map((s) => seat(s, spec, srng));
}

/** Resolve + bake a set of scatter layers on one surface into GPU-ready
 *  `InstanceGroup`s (one group per layer). Each layer's material is appended to
 *  `materials` (deduplicated by descriptor) and referenced by index. `offset` is
 *  added to every instance position before baking — pass the region origin to bake
 *  WORLD transforms (cave), or omit (`[0,0,0]`) to bake LOCAL transforms that a
 *  later placement step transforms (rooms). Pure given `rng`: one derived stream
 *  per layer (`scatter()` derives again by spec.name, so layers never reshuffle
 *  each other). Layers that resolve to zero instances are dropped. */
export function instanceGroupsFromLayers(
  surface: SampleableSurface,
  specs: ScatterLayerSpec[],
  rng: Rng,
  keepOut: KeepOut[],
  materials: MaterialDescriptor[],
  offset: Vec3 = [0, 0, 0],
): InstanceGroup[] {
  const groups: InstanceGroup[] = [];
  for (const spec of specs) {
    const data = scatter(surface, spec, rng, keepOut);
    if (data.length === 0) continue;
    const matKey = JSON.stringify(spec.material);
    let materialIndex = materials.findIndex(
      (m) => JSON.stringify(m) === matKey,
    );
    if (materialIndex < 0) {
      materialIndex = materials.length;
      materials.push(spec.material);
    }
    const transforms = new Float32Array(16 * data.length);
    const tints = new Float32Array(4 * data.length);
    const m = mat4.create();
    const q = quat.create();
    const tv = vec3.create();
    const sv = vec3.create();
    for (const [i, d] of data.entries()) {
      q.set(d.rotation);
      tv.set([
        d.position[0] + offset[0],
        d.position[1] + offset[1],
        d.position[2] + offset[2],
      ]);
      sv.fill(d.scale);
      mat4.fromRotationTranslationScale(m, q, tv, sv); // column-major
      transforms.set(m, i * 16);
      tints.set(d.tint, i * 4);
    }
    groups.push({
      geometry: spec.geometry,
      material: materialIndex,
      posture: spec.posture,
      transforms,
      tints,
      collision: spec.collision,
      placements: spec.collision
        ? data.map((d) => ({
            ...d,
            position: [
              d.position[0] + offset[0],
              d.position[1] + offset[1],
              d.position[2] + offset[2],
            ] as Vec3,
          }))
        : undefined,
    });
  }
  return groups;
}
