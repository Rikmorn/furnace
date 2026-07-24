// Placed-prop proxy math for the field host — pure, GPU-free (the field-ghost.ts
// sibling): the catalog collision primitive → proxy-primitive mapping, the
// oriented wireframe corners the placement GHOST draws, the record re-scaling the
// committed PROP LAYER packs through core's packPlacementMatrices, and the
// log → per-archetype record grouping both rebuild from. The host keeps the GPU
// calls (geometry / instanced-mesh creation, uploads) and the catalog transport.
//
// v0 posture: editor props are PROXIES — the collision primitive drawn as a unit
// cube / sphere / cylinder, not the archetype's `.fmesh` variants the dungeon
// loads. Mesh-accurate editor props are backlogged
// (`docs/backlog/editor-and-tooling/field-editor-prop-meshes.md`).
import type { FieldOp, PlacementRecord } from "@furnace/core/field";
import type {
  EntityArchetype,
  EntityCollision,
} from "../frontend/lib/catalog.ts";
import { boxEdges } from "./box-edges.ts";

type Vec3T = [number, number, number];

/** Which unit-sized primitive the editor draws for a collision kind. A capsule
 *  has no primitive of its own, so it draws as a CYLINDER of the capsule's full
 *  height — an honest over-approximation (the cylinder is the capsule's AABB
 *  about the Y axis), not a rounded shape the editor would have to tessellate. */
export type ProxyPrimitive = "cube" | "sphere" | "cylinder";

/** Collision kind → the proxy primitive drawn for it. */
export const PROXY_PRIMITIVE: Record<EntityCollision["kind"], ProxyPrimitive> =
  {
    box: "cube",
    sphere: "sphere",
    capsule: "cylinder",
  };

/** The proxy an archetype the catalog does NOT define falls back to: a 0.5 m
 *  lattice cube. Deliberate — the catalog SEEDS the editor, it never gates it, so
 *  a world whose props name archetypes this project has no catalog for still
 *  SHOWS them (at a nominal size) instead of rendering nothing at all. */
export const FALLBACK_COLLISION: EntityCollision = {
  kind: "box",
  halfExtents: [0.25, 0.25, 0.25],
};

/** The tint an archetype the catalog does not define falls back to — a neutral
 *  slate, distinct from the kit's warm stone. */
export const FALLBACK_TINT: [number, number, number, number] = [
  0.55, 0.58, 0.66, 1,
];

/** Full extents (width, height, depth in metres) of a collision primitive at
 *  record scale 1 — a sphere's diameter, a capsule's `2·(halfHeight + radius)`
 *  height by its diameter, a box's doubled half-extents. */
export const proxyExtents = (c: EntityCollision): Vec3T => {
  if (c.kind === "box")
    return [c.halfExtents[0] * 2, c.halfExtents[1] * 2, c.halfExtents[2] * 2];
  if (c.kind === "sphere") return [c.radius * 2, c.radius * 2, c.radius * 2];
  const diameter = c.radius * 2;
  return [diameter, (c.halfHeight + c.radius) * 2, diameter];
};

/** One record's proxy extents: {@link proxyExtents} times the record's own
 *  scale. A `box` scales PER AXIS (exact for an axis-aligned cuboid); a
 *  `sphere`/`capsule` has no per-axis form, so it takes the MAX scale axis —
 *  exact for scatter's uniform-scale records and a conservative
 *  over-approximation otherwise. Mirrors the dungeon loader's `placementCollider`
 *  posture, so the editor proxy and the game collider agree on size. */
export const proxyScale = (c: EntityCollision, scale: Vec3T): Vec3T => {
  const e = proxyExtents(c);
  if (c.kind === "box")
    return [e[0] * scale[0], e[1] * scale[1], e[2] * scale[2]];
  const m = Math.max(scale[0], scale[1], scale[2]);
  return [e[0] * m, e[1] * m, e[2] * m];
};

/** Records re-scaled so a UNIT-sized proxy primitive (cube `size: 1`, sphere
 *  `radius: 0.5`, cylinder `radius: 0.5, height: 1`) lands at the archetype's
 *  collision extents once packed by core's `packPlacementMatrices` — that packer
 *  applies the record's `scale` alone, so the primitive's own size has to ride in
 *  it. Fresh record objects; `position`/`quat` are shared by reference (the
 *  packer only reads them) and the input is never mutated.
 *
 *  SHADING NOTE — the resulting scale is non-uniform (a box's axes differ; a
 *  cylinder's height differs from its diameter), which normally skews normals
 *  under `litInstanced`'s no-inverse-transpose shortcut. It does NOT here: every
 *  proxy primitive's normals are eigenvectors of its scale (a cube's face normals
 *  are axis-aligned; a cylinder's side normals lie in the equally-scaled XZ plane
 *  and its caps point along Y; a sphere's scale is uniform), so `normalize(M·n)`
 *  still recovers the correct world normal. Swapping in a differently-scaled
 *  primitive would break that silently. */
export const proxyRecords = (
  records: readonly PlacementRecord[],
  collision: EntityCollision,
): PlacementRecord[] =>
  records.map((r) => ({ ...r, scale: proxyScale(collision, r.scale) }));

/** Rotate `(x, y, z)` by a unit quaternion `[x, y, z, w]` — the standard
 *  `v + 2·q_v × (q_v × v + w·v)` form, four ops only. */
const rotateByQuat = (
  q: readonly [number, number, number, number],
  x: number,
  y: number,
  z: number,
): Vec3T => {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
};

/** The 8 world corners of one record's proxy box, ROTATED by the record's
 *  quaternion, in {@link boxEdges}' bit layout (bit0=x, bit1=y, bit2=z) — so the
 *  ghost shows a wall/ceiling prop's actual tilt rather than an axis-aligned
 *  stand-in. Length-24 Float32Array. */
export const proxyCorners = (
  record: PlacementRecord,
  collision: EntityCollision,
): Float32Array => {
  const [sx, sy, sz] = proxyScale(collision, record.scale);
  const out = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    const [wx, wy, wz] = rotateByQuat(
      record.quat,
      ((i & 1) === 0 ? -sx : sx) / 2,
      ((i & 2) === 0 ? -sy : sy) / 2,
      ((i & 4) === 0 ? -sz : sz) / 2,
    );
    out[i * 3] = record.position[0] + wx;
    out[i * 3 + 1] = record.position[1] + wy;
    out[i * 3 + 2] = record.position[2] + wz;
  }
  return out;
};

/** A prebuilt drawLines batch (vertices + per-vertex colors) — the host's
 *  `LineBatch` shape. */
type LineBatch = { vertices: Float32Array; colors: Float32Array };

/** ONE merged line batch for a preview's placement ghosts: every record's
 *  oriented proxy box as 12 edges, concatenated into a single `drawLines`
 *  payload (a scatter emits hundreds of records — one call, not one per prop).
 *  Archetypes the catalog does not define draw at {@link FALLBACK_COLLISION}.
 *  Null for an empty record list, so the caller can skip the draw. */
export const placementGhostBatch = (
  records: readonly PlacementRecord[],
  catalog: ReadonlyMap<string, EntityArchetype>,
  color: [number, number, number, number],
): LineBatch | null => {
  if (records.length === 0) return null;
  const batches = records.map((r) =>
    boxEdges(
      proxyCorners(
        r,
        catalog.get(r.archetypeId)?.collision ?? FALLBACK_COLLISION,
      ),
      color,
    ),
  );
  const vertices = new Float32Array(
    batches.reduce((n, b) => n + b.vertices.length, 0),
  );
  const colors = new Float32Array(
    batches.reduce((n, b) => n + b.colors.length, 0),
  );
  let vi = 0;
  let ci = 0;
  for (const b of batches) {
    vertices.set(b.vertices, vi);
    vi += b.vertices.length;
    colors.set(b.colors, ci);
    ci += b.colors.length;
  }
  return { vertices, colors };
};

/** Every placement record in a log grouped by archetype id — the committed prop
 *  layer's rebuild source, read from `log.ops` so undo/redo (which splice ops out
 *  and back) and world loads stay accurate with no separate bookkeeping. Groups
 *  appear in first-seen log order and each group's records in log order; the
 *  record objects are the LOG's (read-only to the caller — the packer and the
 *  tint loop only read). One group = one instanced draw, and its record count IS
 *  that draw's instance count. */
export const groupPlacements = (
  ops: readonly FieldOp[],
): Map<string, PlacementRecord[]> => {
  const groups = new Map<string, PlacementRecord[]>();
  for (const op of ops) {
    if (op.kind !== "placement") continue;
    for (const record of op.records) {
      const existing = groups.get(record.archetypeId);
      if (existing === undefined) groups.set(record.archetypeId, [record]);
      else existing.push(record);
    }
  }
  return groups;
};

/** The JSON-Schema property key a generator uses to name a catalog archetype.
 *  Keyed on the PROPERTY, not on a generator id, so any future archetype-driven
 *  generator picks the catalog options up for free. */
const ARCHETYPE_PARAM = "archetypeId";

/** A generator's param schema with its `archetypeId` property given an `enum` of
 *  the catalog's ids — which is what turns the stamp form's free-text field into
 *  a picker (the inspector's kind resolver reads `enum` first). Returns the
 *  schema UNCHANGED when it has no `archetypeId` property or the catalog is
 *  empty: the catalog seeds, it never gates. The input is never mutated — the
 *  touched nodes are copied, the rest shared (the host already hands out clones).
 */
export const withArchetypeOptions = (
  paramSchema: Record<string, unknown>,
  ids: readonly string[],
): Record<string, unknown> => {
  if (ids.length === 0) return paramSchema;
  const properties = paramSchema["properties"];
  if (typeof properties !== "object" || properties === null) return paramSchema;
  // Boundary cast: `paramSchema` is the loosely-typed core edge; the runtime
  // check above proves `properties` is a non-null object, always index-readable
  // as a record (values stay unknown).
  const props = properties as Record<string, unknown>;
  const archetype = props[ARCHETYPE_PARAM];
  if (typeof archetype !== "object" || archetype === null) return paramSchema;
  return {
    ...paramSchema,
    properties: {
      ...props,
      [ARCHETYPE_PARAM]: { ...archetype, enum: [...ids] },
    },
  };
};

/** The scatter params an archetype seeds a fresh stamp session with: the
 *  generator's own schema defaults overlaid with the archetype's authored
 *  `scatter` hints and its id. Returns the defaults UNCHANGED when the schema has
 *  no `archetypeId` property (a non-archetype generator) or the catalog is empty
 *  (a project with no `catalog/entities.json` authors scatter on schema defaults).
 *  The archetype chosen is the one the defaults already name, falling back to the
 *  catalog's first — so a schema default that has left the catalog still opens on
 *  something real. */
export const seedArchetypeParams = (
  defaults: Record<string, unknown>,
  archetypes: readonly EntityArchetype[],
): Record<string, unknown> => {
  if (!(ARCHETYPE_PARAM in defaults)) return defaults;
  const wanted = defaults[ARCHETYPE_PARAM];
  const chosen = archetypes.find((a) => a.id === wanted) ?? archetypes[0];
  if (chosen === undefined) return defaults; // empty catalog — nothing to seed
  return { ...defaults, ...chosen.scatter, [ARCHETYPE_PARAM]: chosen.id };
};
