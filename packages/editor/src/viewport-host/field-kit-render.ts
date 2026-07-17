// Kit render math for the field host — pure, GPU-free, extracted from
// field-host.ts so the formulas are unit-testable (the F2a carry-over): exact
// quarter-turn yaw quaternions, the piece-kind → KitStyle colour-bucket map,
// per-instance tint jitter, and the packed TRS instance-matrix loop. The host
// keeps only the GPU calls (geometry/mesh creation + uploads).
import type {
  KitInstance,
  KitPieceId,
  KitStyle,
  MaterialTable,
} from "@furnace/core/field";
import { classOf } from "@furnace/core/field";
import { mat4 } from "@furnace/core/transform";

// Per-piece tint jitter (deterministic from the instance variant): scale RGB by
// KIT_TINT_JITTER_BASE + KIT_TINT_JITTER_SPAN·variant.
const KIT_TINT_JITTER_BASE = 0.92;
const KIT_TINT_JITTER_SPAN = 0.16;

// Exact quarter-turn yaw quaternions (rotation about +Y): (0, sin(θ/2), 0,
// cos(θ/2)). No trig — the donor skin.ts pattern (yaws are always {0, ±π/2, π}).
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
 *  pass through white. */
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
 *  `setInstanceMatrices` upload. */
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
