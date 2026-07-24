// Kit-render math for the FIELD's instanced kit pieces — pure, GPU-free: the
// single source of truth every consumer that draws or bakes kit instances
// shares (the editor field-host preview, the dungeon field-world loader, and —
// via packPlacementMatrices — F3 explicit placements). Only the formulas live
// here: exact quarter-turn yaw quaternions, the piece-kind → KitStyle
// colour-bucket map, per-instance tint jitter, and the packed-TRS instance
// matrix loops. Each caller keeps its own GPU calls (geometry/mesh creation,
// uploads) and its own per-consumer material cache.
import { mat4 } from "../transform/index.ts";
import { classOf } from "./materials.ts";
import type {
  KitInstance,
  KitPieceId,
  KitStyle,
  MaterialTable,
  PlacementRecord,
} from "./types.ts";

// Per-piece tint jitter (deterministic from the instance variant): scale RGB by
// KIT_TINT_JITTER_BASE + KIT_TINT_JITTER_SPAN·variant.
const KIT_TINT_JITTER_BASE = 0.92;
const KIT_TINT_JITTER_SPAN = 0.16;

// Exact quarter-turn yaw quaternions (rotation about +Y): (0, sin(θ/2), 0,
// cos(θ/2)). No trig — kit yaws are always {0, ±π/2, π}.
const S = Math.SQRT1_2;
const YAW_ZERO = new Float32Array([0, 0, 0, 1]); // 0°
const YAW_PLUS_90 = new Float32Array([0, S, 0, S]); // +90°
const YAW_180 = new Float32Array([0, 1, 0, 0]); // 180°
const YAW_MINUS_90 = new Float32Array([0, -S, 0, S]); // -90° / 270°

/** Kit piece kind → its KitStyle.pieceColors bucket. */
export const PIECE_COLOR_KEY: Record<
  KitPieceId,
  keyof KitStyle["pieceColors"]
> = {
  panel: "panel",
  floorTile: "floor",
  ceilTile: "floor",
  post: "trim",
  rimPostV: "collar",
  rimEdgeH: "collar",
};

/** Exact yaw quaternion for a quarter-turn rotation about +Y (yaw ∈ {0, ±π/2, π}).
 *  Returns SHARED module-level Float32Array instances — consumers must not
 *  mutate the result (Object.freeze is not viable on typed arrays). */
export const yawQuat = (yaw: number): Float32Array => {
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  switch (q) {
    case 1:
      return YAW_PLUS_90;
    case 2:
      return YAW_180;
    case 3:
      return YAW_MINUS_90;
    default:
      return YAW_ZERO;
  }
};

/** Per-instance tint for a kit piece: the class's KitStyle piece colour, jittered
 *  by the instance variant (RGB only; alpha carried through). Non-kit classes
 *  pass through white (defensive — the skinner only emits kit pieces for kit
 *  classes). */
export const pieceColor = (
  table: MaterialTable,
  k: KitInstance,
): [number, number, number, number] => {
  const cls = classOf(table, k.classId);
  if (cls.kind !== "kit") return [1, 1, 1, 1];
  const base = cls.kit.pieceColors[PIECE_COLOR_KEY[k.piece]];
  const j = KIT_TINT_JITTER_BASE + KIT_TINT_JITTER_SPAN * k.variant;
  return [base[0] * j, base[1] * j, base[2] * j, base[3]];
};

/** Pack one chunk's kit instances into a single column-major matrix array (16
 *  floats per instance): each piece's (yaw · box) TRS at its chunk-local
 *  position offset by the chunk's world `origin`. Feeds one bulk
 *  `setInstanceMatrices` upload.
 *
 *  INVARIANT — every matrix here is a quarter-turn yaw about +Y times a per-axis
 *  box scale on an AXIS-ALIGNED UNIT CUBE. That is what lets the `litInstanced`
 *  shader skip the per-instance normal matrix (it reconstructs the world normal
 *  from the upper 3×3 with no inverse-transpose): a per-axis-scaled face normal
 *  of an axis-aligned cube still `normalize()`s back to its correct outward
 *  direction. Callers must NOT feed non-axis-aligned kit geometry
 *  (beveled/rounded/cylindrical) or arbitrary rotations — non-uniform per-axis
 *  scale would then skew the normals with no compiler error and no test to catch
 *  it (GPU-visual only). `packPlacementMatrices` does NOT hold this invariant. */
export const packKitMatrices = (
  kit: KitInstance[],
  origin: [number, number, number],
): Float32Array => {
  const packed = new Float32Array(16 * kit.length);
  const m = mat4.create();
  const t = new Float32Array(3);
  const s = new Float32Array(3);
  kit.forEach((k, i) => {
    t[0] = k.position[0] + origin[0];
    t[1] = k.position[1] + origin[1];
    t[2] = k.position[2] + origin[2];
    s[0] = k.box[0];
    s[1] = k.box[1];
    s[2] = k.box[2];
    mat4.fromRotationTranslationScale(m, yawQuat(k.yaw), t, s);
    packed.set(m, i * 16);
  });
  return packed;
};

/** Pack explicit placement records into a single column-major matrix array (16
 *  floats per instance), the sibling packer to {@link packKitMatrices} for the
 *  F3 placement consumer: each record's baked-in unit quaternion, world position
 *  and per-axis scale composed as one TRS matrix (`T · R · S`) via the SAME
 *  {@link mat4.fromRotationTranslationScale} helper, so instanced placement
 *  meshes share `packKitMatrices`' exact layout and winding. Feeds one bulk
 *  `setInstanceMatrices` upload.
 *
 *  Unlike {@link packKitMatrices}, a placement carries an ARBITRARY rotation
 *  (its quat resolves at placement time, not a quarter-turn), so the
 *  no-normal-matrix shortcut does NOT apply — a placement's instanced material
 *  must supply proper normals (or the archetype mesh must use uniform scale). */
export const packPlacementMatrices = (
  records: readonly PlacementRecord[],
): Float32Array => {
  const packed = new Float32Array(16 * records.length);
  const m = mat4.create();
  const q = new Float32Array(4);
  const t = new Float32Array(3);
  const s = new Float32Array(3);
  records.forEach((r, i) => {
    q[0] = r.quat[0];
    q[1] = r.quat[1];
    q[2] = r.quat[2];
    q[3] = r.quat[3];
    t[0] = r.position[0];
    t[1] = r.position[1];
    t[2] = r.position[2];
    s[0] = r.scale[0];
    s[1] = r.scale[1];
    s[2] = r.scale[2];
    mat4.fromRotationTranslationScale(m, q, t, s);
    packed.set(m, i * 16);
  });
  return packed;
};
