import type { Camera } from "../camera/types.ts";
import { FurnaceError } from "../errors.ts";
import type { GeometrySlot } from "../geometry/types.ts";
import type { Context } from "../gpu/context-types.ts";
import {
  _recomputeModelIfDirty,
  setPosition,
  setRotation,
  setScale,
} from "../mesh/mesh.ts";
import type { Mesh, MeshSlot } from "../mesh/types.ts";
import { _lookupGeometry, _lookupMesh } from "../resources/internal.ts";
import { vec3 } from "../transform/vec3.ts";
import {
  componentEntries,
  getResourceKind,
  getSettingsSchema,
  type OutSinks,
} from "./registry.ts";
import { parseOrThrow, resolveParams } from "./schema.ts";
import { TABLE_ORDER, type TableName } from "./t.ts";
import type { LoadedScene, SceneDocument } from "./types.ts";
import { splitKind, validateDocument } from "./validate.ts";

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
): EntityRecord {
  const parsedByName = new Map<string, Record<string, unknown>>();
  for (const [name, reg] of componentEntries()) {
    const raw = entity.components[name];
    if (raw === undefined) continue;
    parsedByName.set(
      name,
      parseOrThrow(
        reg.schema,
        raw,
        `entity "${entity.id}" component "${name}"`,
      ),
    );
  }
  const sibling = (name: string): unknown => parsedByName.get(name);
  const record: EntityRecord = { built: [], meshes: [] };
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
  };
  for (const [name, reg] of componentEntries()) {
    const parsed = parsedByName.get(name);
    if (parsed === undefined || !reg.build) continue;
    const bx = {
      entityId: entity.id,
      params: resolveParams(reg.shape, parsed, lookup) as never, // Boundary cast: see resources loop.
      sibling,
      out,
    };
    try {
      const instance = reg.build(ctx, bx);
      record.built.push({ instance, destroy: reg.destroy });
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
 * table order (geometries → shaders → materials) via their registered
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
): Promise<LoadedScene> {
  validateDocument(doc);

  const tables: Record<TableName, Map<string, unknown>> = {
    geometries: new Map(),
    shaders: new Map(),
    materials: new Map(),
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
  const destroyAll = (): void => {
    for (const b of [...built].reverse()) b.destroy?.(ctx, b.instance);
  };
  const meshes: Mesh[] = [];
  let loadedCamera: Camera | undefined;
  const records = new Map<string, EntityRecord>();

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

    // Entities in document order; components in registration order.
    for (const entity of doc.entities) {
      const record = buildEntity(ctx, entity, lookup);
      if (record.camera) {
        if (loadedCamera) {
          throw new FurnaceError(
            `scene: entity "${entity.id}" contributes a second camera (a scene has exactly one)`,
          );
        }
        loadedCamera = record.camera;
      }
      meshes.push(...record.meshes);
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

  const settings = parseOrThrow(
    getSettingsSchema(),
    doc.settings ?? {},
    "settings",
  );

  const result: LoadedScene = {
    meshes,
    camera: cam,
    settings,
    destroy: destroyAll,
    rebuildEntity(entityId, nextDoc) {
      const entity = nextDoc.entities.find((e) => e.id === entityId);
      // Build the replacement FIRST: if buildEntity throws (invalid params/ref),
      // the existing entity is left untouched — the rebuild is transactional, so a
      // transiently-invalid preview keeps the last good scene rather than dropping
      // the entity. (buildEntity cleans up its own partial build on throw.)
      // `lookup` is the resource table frozen at loadScene time; resource changes in nextDoc are not applied.
      const next = entity ? buildEntity(ctx, entity, lookup) : undefined;
      const prev = records.get(entityId);
      if (prev) {
        for (const b of [...prev.built].reverse()) b.destroy?.(ctx, b.instance);
        removeAll(result.meshes, prev.meshes);
        removeAll(built, prev.built);
        records.delete(entityId);
      }
      if (!next) return; // entity removed in the preview doc: teardown only
      result.meshes.push(...next.meshes);
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
  };
  return result;
}
