// Placed-prop proxy math for the field host — pure, GPU-free (the field-ghost.ts
// sibling): the catalog collision primitive → proxy-primitive mapping, the
// oriented wireframe corners the placement GHOST draws, the record re-scaling the
// committed PROP LAYER packs through core's packPlacementMatrices, and the
// log → per-archetype record grouping both rebuild from, and the two
// attributions of that same log — per ENTITY for the entities list's prop rows,
// per RECORD for the viewport pick's "which stamp placed the prop I hit". The
// host keeps the GPU calls (geometry / instanced-mesh creation, uploads) and the
// catalog transport.
//
// v0 posture: editor props are PROXIES — the collision primitive drawn as a unit
// cube / sphere / cylinder, not the archetype's `.fmesh` variants the dungeon
// loads. Mesh-accurate editor props are backlogged
// (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Editor props render as
// collision PROXIES, not the archetype's actual meshes*).
import type {
  FieldOp,
  GeneratorEmits,
  GeneratorEntity,
  PlacementRecord,
} from "@furnace/core/field";
import { collisionCenter } from "@furnace/core/field";
import type { EntityArchetype, EntityCollision } from "../shared/catalog.ts";
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
 *  over-approximation otherwise. Mirrors core's `localHalfExtents` (which the
 *  runtime collider and the analyzer's rasterizer both go through), so the editor
 *  proxy and the game collider agree on size.
 *
 *  MAGNITUDES, per that same rule: an extent is a distance, so a MIRRORED record
 *  (a negative scale axis) covers the same box. Signed arithmetic would shrink a
 *  box's proxy through zero and make `Math.max` pick the LEAST negative axis for
 *  a round one. */
export const proxyScale = (c: EntityCollision, scale: Vec3T): Vec3T => {
  const e = proxyExtents(c);
  const sx = Math.abs(scale[0]);
  const sy = Math.abs(scale[1]);
  const sz = Math.abs(scale[2]);
  if (c.kind === "box") return [e[0] * sx, e[1] * sy, e[2] * sz];
  const m = Math.max(sx, sy, sz);
  return [e[0] * m, e[1] * m, e[2] * m];
};

/** Records re-scaled so a UNIT-sized proxy primitive (cube `size: 1`, sphere
 *  `radius: 0.5`, cylinder `radius: 0.5, height: 1`) lands at the archetype's
 *  collision extents once packed by core's `packPlacementMatrices` — that packer
 *  applies the record's `scale` alone, so the primitive's own size has to ride in
 *  it. Fresh record objects; `quat` is shared by reference (the packer only reads
 *  it) and the input is never mutated.
 *
 *  The POSITION is core's {@link collisionCenter}, not the record's own: an
 *  `anchor: "base"` primitive's centre sits a Y half-extent above `position`,
 *  along the record's LOCAL +Y (D-F4-14). Called rather than composed here on
 *  purpose — the extent rule and the rotation into the record's frame both have
 *  to be right, and a hand-written copy is how the editor's proxy and the
 *  runtime's rigid body drift apart.
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
  records.map((r) => ({
    ...r,
    position: collisionCenter(collision, r),
    scale: proxyScale(collision, r.scale),
  }));

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
 *  stand-in. Length-24 Float32Array.
 *
 *  Boxed about core's {@link collisionCenter}, the same anchored pose
 *  {@link proxyRecords} gives the committed layer — so a prop's ghost and its
 *  committed proxy stand in the same place. */
export const proxyCorners = (
  record: PlacementRecord,
  collision: EntityCollision,
): Float32Array => {
  const [sx, sy, sz] = proxyScale(collision, record.scale);
  const centre = collisionCenter(collision, record);
  const out = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    const [wx, wy, wz] = rotateByQuat(
      record.quat,
      ((i & 1) === 0 ? -sx : sx) / 2,
      ((i & 2) === 0 ? -sy : sy) / 2,
      ((i & 4) === 0 ? -sz : sz) / 2,
    );
    out[i * 3] = centre[0] + wx;
    out[i * 3 + 1] = centre[1] + wy;
    out[i * 3 + 2] = centre[2] + wz;
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

/** One archetype's contribution to a committed entity's placements: the id its
 *  records name, and how many of them do. */
export type PlacedArchetype = { archetypeId: string; count: number };

/** Whether an op belongs to a committed entity's span — the ONE spelling of the
 *  attribution rule both walks below apply. See {@link placementsByEntity} for
 *  why membership is tested by id rather than by walking the span's range or
 *  trusting log position. */
const ownsOp = (entity: GeneratorEntity, opId: number): boolean =>
  opId >= entity.opSpan[0] && opId <= entity.opSpan[1];

/** One placed instance and the entity whose span claims it. */
export type OwnedPlacement = { entityId: number; record: PlacementRecord };

/**
 * Every placement record in a log paired with its OWNING entity, in log order.
 *
 * The {@link placementsByEntity} sibling at record granularity: that one answers
 * "how many of each archetype did this entity place" and cannot name an
 * individual record, which is what a caller holding ONE record needs — the
 * viewport pick, whose ray hits a single prop and has to answer with the stamp
 * that put it there. {@link groupPlacements}, the drawn layer's source, is no
 * help either: it groups by archetype and discards op identity outright, so an
 * (archetype, instance) pair has no path back to an entity at all.
 *
 * The two walks are kept apart rather than one folded into the other because
 * their allocation profiles differ where it matters: this one materializes an
 * object per RECORD (fine for a click, 100 000 objects at the scale
 * `placementsByEntity`'s figures were taken at) while that one tallies into a
 * map and allocates per archetype. They share the rule ({@link ownsOp}), which
 * is the part that could drift.
 *
 * Records are the LOG's own objects — read-only to the caller. A placement op no
 * span claims is skipped, runtime-quiet (see {@link placementsByEntity}).
 */
export const placementOwners = (ops: readonly FieldOp[]): OwnedPlacement[] => {
  const entities: GeneratorEntity[] = [];
  for (const op of ops) if (op.kind === "entity") entities.push(op.entity);
  const out: OwnedPlacement[] = [];
  for (const op of ops) {
    if (op.kind !== "placement") continue;
    const owner = entities.find((e) => ownsOp(e, op.id));
    if (owner === undefined) continue; // an orphan; no commit path makes one
    for (const record of op.records)
      out.push({ entityId: owner.entityId, record });
  }
  return out;
};

/** Per entity id, what that entity's OWN span placed — one entry per archetype
 *  its placement records name, in first-seen record order. An entity that placed
 *  nothing (every carver) is ABSENT from the map, so a lookup miss IS "no props"
 *  and a caller needs no separate "is this a prop entity?" test.
 *
 *  The {@link groupPlacements} sibling: that one answers "what does the whole
 *  world draw" (the prop layer's rebuild), this one answers "what did THIS stamp
 *  put down" (the entities list's row).
 *
 *  Attribution is by op-id membership of the entity's `opSpan`:
 *  `commitGenerator` appends a commit's placements as ONE op inside that span,
 *  and within a session ids are handed out monotonically and never reused, so a
 *  placement op's id names exactly one entity.
 *
 *  POSITION would also work on every log core WRITES — `reconfigureGenerator`
 *  states that it "requires and preserves" commitGenerator's layout, a span
 *  contiguous and immediately before its entity op. Id-keying is chosen not
 *  because position is unsafe but because it leans on no invariant beyond id
 *  uniqueness, and that matters on a log core only READS: `parseOps` validates
 *  op ids and union tags (and an entity op's `action`/`entity.type`) but never
 *  the LAYOUT, so a loaded oplog carries whatever order its file has. It is also
 *  how `generatorFootprint` already filters a span. Note the log is NOT
 *  id-ordered either — a re-cooked span carries fresh ids spliced back into the
 *  same place — so nothing here may assume ids ascend with position.
 *
 *  It TESTS each placement op's id against the span bounds rather than walking
 *  the span's id RANGE: `opSpan` is trusted numeric data on load (`parseOps`
 *  does not check its bounds), so a WALK's cost rides on span width — unbounded
 *  on one corrupt record. This shape's cost is instead two scans over `ops` plus
 *  placement-ops × entities for the attribution, so it does still grow with the
 *  LOG: measured 0.02 ms for 5 entities × 200 records over no brush ops against
 *  0.50 ms for the same set over 50 000, and 2.3 ms at 200 entities × 500
 *  records over 100 000 — a ~24× swing driven by carve count alone.
 *  Comfortable either way on this path: the entity list refreshes on discrete
 *  user actions, never per-rAF.
 *
 *  A placement op no span claims is skipped, runtime-quiet. Note the divergence
 *  from {@link groupPlacements}, which counts every record whatever owns it: on
 *  a corrupt log the prop LAYER would draw props that no row accounts for. */
export const placementsByEntity = (
  ops: readonly FieldOp[],
): Map<number, PlacedArchetype[]> => {
  // A push loop, not `ops.flatMap` — the flatMap allocates one throwaway array
  // per op, and this scan runs over the whole log (50 000 of them in the figures
  // above).
  const entities: GeneratorEntity[] = [];
  for (const op of ops) if (op.kind === "entity") entities.push(op.entity);
  const counts = new Map<number, Map<string, number>>();
  for (const op of ops) {
    if (op.kind !== "placement") continue;
    const owner = entities.find((e) => ownsOp(e, op.id));
    if (owner === undefined) continue; // an orphan; no commit path makes one
    const byArchetype = counts.get(owner.entityId) ?? new Map<string, number>();
    if (!counts.has(owner.entityId)) counts.set(owner.entityId, byArchetype);
    for (const r of op.records)
      byArchetype.set(r.archetypeId, (byArchetype.get(r.archetypeId) ?? 0) + 1);
  }
  return new Map(
    [...counts].map(([entityId, byArchetype]) => [
      entityId,
      [...byArchetype].map(([archetypeId, count]) => ({ archetypeId, count })),
    ]),
  );
};

/**
 * Whether a generator PLACES props, from core's own `GeneratorDef.emits`
 * declaration (D-F4-15). The successor to this module's `placesArchetypes`
 * schema sniff, which inferred the same fact from an `archetypeId` param and
 * would have mis-read any placer that names its archetype another way.
 *
 * ONE function rather than the expression inlined at each call site, because
 * `emits` is a three-value union and the rule is `!== "ops"`, not
 * `=== "placements"`: `"both"` places props too. Written twice, the narrower
 * spelling agrees with this one on every def the registry holds today (nothing
 * declares `"both"`) and silently drops props for the first mixed emitter added
 * — a divergence no registry-driven test can catch, since its expectations are
 * built from the same registry. Here it is one line with a unit test that can
 * pass a synthetic `"both"`.
 */
export const placesProps = (emits: GeneratorEmits): boolean => emits !== "ops";

/** The JSON-Schema property key a generator uses to name a catalog archetype.
 *  Keyed on the PROPERTY, not on a generator id, so any future archetype-driven
 *  generator picks the catalog options up for free.
 *
 *  Exported since F4.5b Task 10: the host's mid-session re-seed has to ask whether THIS
 *  param is the one that changed, and a second spelling of the key there is a second
 *  thing to keep in agreement with the two functions below. */
export const ARCHETYPE_PARAM = "archetypeId";

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

/** The scatter params an archetype seeds a stamp session with: the params handed in
 *  overlaid with the archetype's authored `scatter` hints and its id. Returns them
 *  UNCHANGED when the schema has no `archetypeId` property (a non-archetype generator) or
 *  the catalog is empty (a project with no `catalog/entities.json` authors scatter on
 *  schema defaults). The archetype chosen is the one the params already name, falling back
 *  to the catalog's first — so a schema default that has left the catalog still opens on
 *  something real.
 *
 *  `keys` restricts which HINTS may land, and it is what lets one function serve two
 *  moments. A FRESH session passes none and takes every hint (nothing has been said about
 *  anything yet). A LIVE session whose archetype just changed passes the params the user
 *  has not touched, so switching rock → stalagmite moves the spacing they never mentioned
 *  and keeps the density they set. The archetype ID itself always lands: it is the change
 *  being applied, not a hint about it. */
export const seedArchetypeParams = (
  defaults: Record<string, unknown>,
  archetypes: readonly EntityArchetype[],
  keys?: readonly string[],
): Record<string, unknown> => {
  if (!(ARCHETYPE_PARAM in defaults)) return defaults;
  const wanted = defaults[ARCHETYPE_PARAM];
  const chosen = archetypes.find((a) => a.id === wanted) ?? archetypes[0];
  if (chosen === undefined) return defaults; // empty catalog — nothing to seed
  const hints =
    keys === undefined
      ? chosen.scatter
      : Object.fromEntries(
          Object.entries(chosen.scatter).filter(([k]) => keys.includes(k)),
        );
  return { ...defaults, ...hints, [ARCHETYPE_PARAM]: chosen.id };
};

/** The params a user has SPOKEN ABOUT in the current session, accumulated across updates:
 *  `prev` plus every key whose value differs between the incoming record and the one the
 *  session currently holds.
 *
 *  Accumulating (rather than reporting one update's changes) is the whole contract: the
 *  question it answers is "has the user ever set this?", and a density edit two updates ago
 *  is still an answer to it. The empty-diff case matters just as much — the update seam
 *  carries params, seed and policy together, so a re-roll pushes the WHOLE params record
 *  unchanged, and a version that counted that as touching everything would freeze the
 *  archetype hints after the first re-roll.
 *
 *  Compared with `Object.is`, so a non-primitive value (an array param) reads as changed
 *  and stays permanently touched. Be precise about how often that fires: the host
 *  `structuredClone`s the incoming record before comparing, so an object or array param is
 *  a NEW IDENTITY on every call — it is marked touched by the FIRST update of any kind,
 *  including a seed re-roll or a policy switch that changed no param at all. So for
 *  non-primitives this is not "conservative", it is unconditional. It is still the SAFE
 *  direction (a touched key is one the re-seed leaves alone, i.e. the user's value stands),
 *  and it is latent today — no registry generator has an array param, though a `doors: []`
 *  would be one. A deep walk is the fix if one ever lands. */
export const touchedParamKeys = (
  incoming: Record<string, unknown>,
  current: Record<string, unknown>,
  prev: ReadonlySet<string>,
): Set<string> => {
  const next = new Set(prev);
  for (const [key, value] of Object.entries(incoming))
    if (!Object.is(value, current[key])) next.add(key);
  return next;
};
