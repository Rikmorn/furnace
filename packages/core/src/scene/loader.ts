import type { Camera } from "../camera/types.ts";
import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/context-types.ts";
import type { Mesh } from "../mesh/types.ts";
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

type BuiltRecord = {
  instance: unknown;
  destroy?: (ctx: Context, instance: unknown) => void;
};

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
  let currentEntityId = "";
  const out: OutSinks = {
    addMesh: (m) => meshes.push(m),
    setCamera: (c) => {
      if (loadedCamera) {
        throw new FurnaceError(
          `scene: entity "${currentEntityId}" contributes a second camera (a scene has exactly one)`,
        );
      }
      loadedCamera = c;
    },
  };

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
      currentEntityId = entity.id;
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
      for (const [name, reg] of componentEntries()) {
        const parsed = parsedByName.get(name);
        if (parsed === undefined || !reg.build) continue;
        const bx = {
          entityId: entity.id,
          params: resolveParams(reg.shape, parsed, lookup) as never, // Boundary cast: see resources loop.
          sibling,
          out,
        };
        const instance = reg.build(ctx, bx);
        built.push({ instance, destroy: reg.destroy });
      }
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

  return {
    meshes,
    camera: cam,
    settings,
    destroy: destroyAll,
  };
}
