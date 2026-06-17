import type { Camera } from "../camera/types.ts";
import { FurnaceError } from "../errors.ts";
import type { Ambient, Light } from "../frame/index.ts";
import type { GeometrySlot } from "../geometry/types.ts";
import type { Context } from "../gpu/context-types.ts";
import {
  _recomputeModelIfDirty,
  setPosition,
  setRotation,
  setScale,
} from "../mesh/mesh.ts";
import type { Mesh, MeshSlot } from "../mesh/types.ts";
import type { World } from "../physics/index.ts";
import * as physics from "../physics/index.ts";
import type { Effect } from "../post/index.ts";
import { _lookupGeometry, _lookupMesh } from "../resources/internal.ts";
import { vec3 } from "../transform/vec3.ts";
import { pickEntity } from "./pick.ts";
import {
  componentEntries,
  getResourceKind,
  getSettingsSchema,
  type OutSinks,
} from "./registry.ts";
import { parseOrThrow, resolveParams } from "./schema.ts";
import { TABLE_ORDER, type TableName } from "./t.ts";
import type { LoadedScene, LoadSceneOptions, SceneDocument } from "./types.ts";
import { splitKind, validateDocument } from "./validate.ts";

/** Earth gravity, m/s² (Y-down). */
const DEFAULT_GRAVITY: [number, number, number] = [0, -9.81, 0];

/** Remove every element of `toRemove` from `arr` in place (identity match). */
function removeAll<T>(arr: T[], toRemove: readonly T[]): void {
  for (const item of toRemove) {
    const i = arr.indexOf(item);
    if (i !== -1) arr.splice(i, 1);
  }
}

type BuiltRecord = {
  instance: unknown;
  destroy?: (ctx: Context, instance: unknown) => void;
};

/** What one entity contributed at load — enough to tear down and replace it. */
type EntityRecord = {
  built: BuiltRecord[];
  meshes: Mesh[];
  lights: Light[];
  camera?: Camera;
};

/**
 * Union the local AABB corners of all of an entity's meshes into a single
 * world-space AABB, then return the 8 corners as a `Float32Array(24)`.
 * Returns `null` if the entity has no meshes or if none resolve to live slots.
 * Corner bit layout: bit0=x, bit1=y, bit2=z.
 */
function entityWorldCorners(
  ctx: Context,
  record: EntityRecord,
): Float32Array | null {
  if (record.meshes.length === 0) return null;
  const wmin = vec3.fromValues(Infinity, Infinity, Infinity);
  const wmax = vec3.fromValues(-Infinity, -Infinity, -Infinity);
  const p = vec3.create();
  for (const m of record.meshes) {
    const ms = _lookupMesh<MeshSlot>(ctx, m);
    if (!ms) continue;
    _recomputeModelIfDirty(ctx, ms);
    const gs = _lookupGeometry<GeometrySlot>(ctx, ms.geometry);
    if (!gs) continue;
    const lo = gs.boundsMin;
    const hi = gs.boundsMax;
    for (let c = 0; c < 8; c++) {
      vec3.set(
        p,
        c & 1 ? (hi[0] as number) : (lo[0] as number),
        c & 2 ? (hi[1] as number) : (lo[1] as number),
        c & 4 ? (hi[2] as number) : (lo[2] as number),
      );
      vec3.transformMat4(p, p, ms.modelMatrix);
      for (let a = 0; a < 3; a++) {
        if ((p[a] as number) < (wmin[a] as number)) wmin[a] = p[a] as number;
        if ((p[a] as number) > (wmax[a] as number)) wmax[a] = p[a] as number;
      }
    }
  }
  if (!Number.isFinite(wmin[0] as number)) return null;
  const out = new Float32Array(24);
  for (let c = 0; c < 8; c++) {
    out[c * 3 + 0] = c & 1 ? (wmax[0] as number) : (wmin[0] as number);
    out[c * 3 + 1] = c & 2 ? (wmax[1] as number) : (wmin[1] as number);
    out[c * 3 + 2] = c & 4 ? (wmax[2] as number) : (wmin[2] as number);
  }
  return out;
}

/**
 * Build a single entity's components (registration order) into its own scoped
 * record. The scoped `out` collects only this entity's contributions; the
 * caller merges them and enforces the cross-entity single-camera invariant;
 * a single entity contributing two cameras is caught here.
 * Reused by both initial load and `rebuildEntity` — one projection path.
 */
function buildEntity(
  ctx: Context,
  entity: SceneDocument["entities"][number],
  lookup: (table: TableName, id: string) => unknown,
  world: World | undefined,
): EntityRecord {
  // Resolve EVERY present component's params (ids → handles) before any build,
  // so sibling() hands resolved handles to consumers (e.g. the rigidMesh
  // composite reading sibling("meshRenderer").geometry). Resolve once here,
  // reused for both a component's own bx.params and its siblings.
  const resolvedByName = new Map<string, Record<string, unknown>>();
  for (const [name, reg] of componentEntries()) {
    const raw = entity.components[name];
    if (raw === undefined) continue;
    const parsed = parseOrThrow(
      reg.schema,
      raw,
      `entity "${entity.id}" component "${name}"`,
    );
    resolvedByName.set(name, resolveParams(reg.shape, parsed, lookup));
  }
  const sibling = (name: string): unknown => resolvedByName.get(name);
  const record: EntityRecord = { built: [], meshes: [], lights: [] };
  const out: OutSinks = {
    addMesh: (m) => record.meshes.push(m),
    setCamera: (c) => {
      if (record.camera) {
        throw new FurnaceError(
          `scene: entity "${entity.id}" contributes a second camera (a scene has exactly one)`,
        );
      }
      record.camera = c;
    },
    addLight: (l) => record.lights.push(l),
  };
  for (const [name, reg] of componentEntries()) {
    const params = resolvedByName.get(name);
    if (params === undefined || !reg.build) continue;
    const bx = {
      entityId: entity.id,
      params: params as never, // Boundary cast: resolved up front; see resources loop.
      sibling,
      out,
      world: () => {
        if (!world) {
          throw new FurnaceError(
            `scene: entity "${entity.id}" has a rigidBody but no physics world`,
          );
        }
        return world;
      },
    };
    try {
      const instance = reg.build(ctx, bx);
      // A deferred component (e.g. a meshRenderer owned by a sibling rigidBody)
      // returns undefined — nothing to track or tear down for it.
      if (instance !== undefined) {
        record.built.push({ instance, destroy: reg.destroy });
      }
    } catch (err) {
      // Mid-entity build failure: tear down this entity's already-built records
      // (reverse order) so nothing leaks — matches loadScene's whole-load cleanup
      // and keeps the shared buildEntity path leak-free for rebuildEntity/preview.
      for (const b of [...record.built].reverse()) b.destroy?.(ctx, b.instance);
      throw err;
    }
  }
  return record;
}

/**
 * Load a serialized scene document into live core objects.
 *
 * Validates the document against the registry, builds resources in fixed
 * table order (geometries → textures → shaders → materials → effects) via their registered
 * builders, instantiates entity components in registration order with
 * pre-resolved resource refs, and returns the scene's render inputs together
 * with a `destroy` that frees everything this call created (reverse build
 * order). If any build throws mid-load, everything built so far is destroyed
 * before the error propagates — a failed load leaks nothing.
 *
 * @param ctx - the GPU context to create resources in
 * @param doc - the parsed scene document
 * @returns the loaded scene's render inputs + a `destroy` that frees everything created
 * @throws {FurnaceError} if the document fails boundary validation
 * @throws {FurnaceError} if an entity contributes a second camera, or no entity contributes one
 */
export async function loadScene(
  ctx: Context,
  doc: SceneDocument,
  opts?: LoadSceneOptions,
): Promise<LoadedScene> {
  validateDocument(doc);

  const tables: Record<TableName, Map<string, unknown>> = {
    geometries: new Map(),
    textures: new Map(),
    shaders: new Map(),
    materials: new Map(),
    effects: new Map(),
  };
  const lookup = (table: TableName, id: string): unknown => {
    const handle = tables[table].get(id);
    if (handle === undefined) {
      // Invariant: validateDocument proved every ref resolves; reaching here is a loader bug.
      throw new FurnaceError(
        `scene [internal]: ${table} "${id}" not built before lookup`,
      );
    }
    return handle;
  };

  const built: BuiltRecord[] = [];
  // When opts.world is provided, the caller owns the world — we build into it
  // but do NOT destroy it on teardown. When absent, the world is created and
  // owned here (destroyed last, after every body/rigidMesh in `built`, so each
  // body is removed via its own teardown while the world is still live).
  let world: World | undefined = opts?.world;
  const ownsWorld = opts?.world === undefined;
  const destroyAll = (): void => {
    for (const b of [...built].reverse()) b.destroy?.(ctx, b.instance);
    if (world && ownsWorld) physics.destroyWorld(ctx, world);
  };
  const meshes: Mesh[] = [];
  const lights: Light[] = [];
  let loadedCamera: Camera | undefined;
  const records = new Map<string, EntityRecord>();

  const settings = parseOrThrow(
    getSettingsSchema(),
    doc.settings ?? {},
    "settings",
  );

  try {
    // Resources, fixed dependency order. Re-parses after validateDocument:
    // cold path; keeps the boundary function side-effect-free.
    for (const table of TABLE_ORDER) {
      for (const [id, entry] of Object.entries(doc.resources?.[table] ?? {})) {
        const { kind, params } = splitKind(table, id, entry);
        // Non-null: validateDocument proved the kind is registered.
        const reg = getResourceKind(table, kind);
        if (!reg)
          throw new FurnaceError(
            `scene [internal]: ${table}/${kind} unregistered after validation`,
          );
        const parsed = parseOrThrow(reg.schema, params, `${table} "${id}"`);
        // Boundary cast inside resolveParams' return: validated + resolved — the
        // type system can't track the id→handle swap (registration generics
        // re-pair instance and registration by construction).
        const rx = {
          params: resolveParams(reg.shape, parsed, lookup) as never,
        };
        const instance = await reg.build(ctx, rx);
        tables[table].set(id, reg.handle ? reg.handle(instance) : instance);
        built.push({ instance, destroy: reg.destroy });
      }
    }

    // Lazy physics world: created once, before any entity, if any entity has a
    // rigidBody AND no world was injected. Gravity/lengthUnit come from the
    // parsed settings (Task 10). An injected world keeps its own gravity/lengthUnit.
    const needsPhysics = doc.entities.some((e) => "rigidBody" in e.components);
    if (needsPhysics && !world) {
      world = await physics.createWorld(ctx, {
        gravity:
          (settings["gravity"] as [number, number, number] | undefined) ??
          DEFAULT_GRAVITY,
        lengthUnit: settings["lengthUnit"] as number | undefined,
      });
    }

    // Entities in document order; components in registration order.
    for (const entity of doc.entities) {
      const record = buildEntity(ctx, entity, lookup, world);
      if (record.camera) {
        if (loadedCamera) {
          throw new FurnaceError(
            `scene: entity "${entity.id}" contributes a second camera (a scene has exactly one)`,
          );
        }
        loadedCamera = record.camera;
      }
      meshes.push(...record.meshes);
      lights.push(...record.lights);
      built.push(...record.built);
      records.set(entity.id, record);
    }
  } catch (err) {
    // Partial-load cleanup: a failed load leaks nothing (reverse build order).
    destroyAll();
    throw err;
  }

  if (!loadedCamera) {
    destroyAll();
    throw new FurnaceError("scene: no entity carries a camera component");
  }
  const cam = loadedCamera;

  // ambient → LoadedScene.ambient. Boundary cast: the settings schema is stored
  // type-erased (z.ZodObject<ZodRawShape>), so the parsed value is loosely typed;
  // the schema's `ambient` shape (sky/ground vec3 tuples + intensity) is exactly
  // `Ambient` modulo readonly, so this assignment is sound.
  const ambient = settings["ambient"] as Ambient | undefined;

  // post → resolve effect refs to live handles (loud at the load boundary: the
  // validator parses `post` as a string[] but does not descend into it to check
  // the ids resolve, so an unknown effect id reaches here un-caught).
  // `tables.effects` holds the handles built by the TABLE_ORDER loop above.
  // Boundary cast: same type-erasure as `ambient`.
  const post = (settings["post"] ?? []) as string[];
  const effects = post.map((id) => {
    const fx = tables.effects.get(id);
    if (fx === undefined) {
      destroyAll();
      throw new FurnaceError(
        `scene: settings.post references unknown effect "${id}"`,
      );
    }
    return fx as Effect;
  });

  const result: LoadedScene = {
    meshes,
    camera: cam,
    lights,
    ambient,
    effects,
    world,
    settings,
    destroy: destroyAll,
    rebuildEntity(entityId, nextDoc) {
      const entity = nextDoc.entities.find((e) => e.id === entityId);
      // Build the replacement FIRST: if buildEntity throws (invalid params/ref),
      // the existing entity is left untouched — the rebuild is transactional, so a
      // transiently-invalid preview keeps the last good scene rather than dropping
      // the entity. (buildEntity cleans up its own partial build on throw.)
      // `lookup` is the resource table frozen at loadScene time; resource changes in nextDoc are not applied.
      const next = entity ? buildEntity(ctx, entity, lookup, world) : undefined;
      const prev = records.get(entityId);
      if (prev) {
        for (const b of [...prev.built].reverse()) b.destroy?.(ctx, b.instance);
        removeAll(result.meshes, prev.meshes);
        removeAll(result.lights, prev.lights);
        removeAll(built, prev.built);
        records.delete(entityId);
      }
      if (!next) return; // entity removed in the preview doc: teardown only
      result.meshes.push(...next.meshes);
      result.lights.push(...next.lights);
      built.push(...next.built);
      records.set(entityId, next);
      if (next.camera) result.camera = next.camera;
    },
    setSettings(next) {
      result.settings = next;
    },
    entityBoxCorners(entityId) {
      const rec = records.get(entityId);
      return rec ? entityWorldCorners(ctx, rec) : null;
    },
    setEntityTransform(entityId, t) {
      const rec = records.get(entityId);
      if (!rec) return;
      for (const m of rec.meshes) {
        if (t.position) setPosition(ctx, m, new Float32Array(t.position));
        if (t.rotation) setRotation(ctx, m, new Float32Array(t.rotation));
        if (t.scale) setScale(ctx, m, new Float32Array(t.scale));
      }
    },
    pick(c, cam, ndcX, ndcY) {
      const entries: { mesh: Mesh; entityId: string }[] = [];
      for (const [entityId, rec] of records) {
        for (const m of rec.meshes) entries.push({ mesh: m, entityId });
      }
      return pickEntity(c, cam, entries, ndcX, ndcY);
    },
  };
  return result;
}
