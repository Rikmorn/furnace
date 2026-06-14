import { z } from "zod";
import type { Camera } from "../camera/types.ts";
import { FurnaceError } from "../errors.ts";
import type { Light } from "../frame/index.ts";
import type { Context } from "../gpu/context-types.ts";
import type { Mesh } from "../mesh/types.ts";
import type { World } from "../physics/index.ts";
import type { ResolvedParamsOf } from "./schema.ts";
import { TABLE_ORDER, type TableHandle, type TableName } from "./t.ts";

/**
 * Render-contract sinks a component `build` contributes through. Deliberately
 * closed: components contribute to rendering; they cannot mutate the load.
 * Grows additively (e.g. `addLight`) as the render contract grows.
 */
export type OutSinks = {
  /** Contribute a renderable mesh to `LoadedScene.meshes`. */
  addMesh(m: Mesh): void;
  /** Contribute THE scene camera. Throws if a camera was already set. */
  setCamera(c: Camera): void;
  /** Contribute a light to `LoadedScene.lights` (projected from a light entity). */
  addLight(light: Light): void;
};

/**
 * Context handed to a component `build`: the entity id, the validated +
 * ref-resolved params, sibling component params (boundary-validated; narrow
 * with a documented cast), and the render-contract sinks.
 */
export type BuildContext<S extends z.ZodRawShape> = {
  entityId: string;
  params: ResolvedParamsOf<S>;
  sibling(name: string): unknown;
  out: OutSinks;
  /** The scene physics world (created lazily from settings on first `rigidBody`).
   *  Throws if the scene has no physics world (no `rigidBody` entity present). */
  world(): World;
};

/** Context handed to a resource `build`: validated + ref-resolved params. */
export type ResourceBuildContext<S extends z.ZodRawShape> = {
  params: ResolvedParamsOf<S>;
};

/**
 * A component type declaration: `params` (raw shape — the registry wraps it
 * in a strict zod object), optional `build` (omit for pure-data components
 * like `transform`), optional `destroy` freeing what `build` returned.
 */
export type ComponentDefinition<S extends z.ZodRawShape, I> = {
  params?: S;
  build?(ctx: Context, bx: BuildContext<S>): I;
  destroy?(ctx: Context, instance: I): void;
};

/**
 * A resource-kind declaration. `build` returns the owned instance; `handle`
 * projects what the resource table stores (defaults to the instance itself);
 * `destroy` frees everything `build` created.
 */
export type ResourceDefinition<
  T extends TableName,
  S extends z.ZodRawShape,
  I,
> = {
  params?: S;
  build(ctx: Context, rx: ResourceBuildContext<S>): I | Promise<I>;
  handle?(instance: I): TableHandle<T>;
  destroy?(ctx: Context, instance: I): void;
};

/** Erased registration record stored in the registry (internal). */
export type ComponentRegistration = {
  shape: z.ZodRawShape;
  schema: z.ZodObject<z.ZodRawShape>;
  build?: (ctx: Context, bx: BuildContext<z.ZodRawShape>) => unknown;
  destroy?: (ctx: Context, instance: unknown) => void;
};

/** Erased resource-kind registration record (internal). */
export type ResourceRegistration = {
  shape: z.ZodRawShape;
  schema: z.ZodObject<z.ZodRawShape>;
  build: (ctx: Context, rx: ResourceBuildContext<z.ZodRawShape>) => unknown;
  handle?: (instance: unknown) => unknown;
  destroy?: (ctx: Context, instance: unknown) => void;
};

const components = new Map<string, ComponentRegistration>();
const resources = new Map<TableName, Map<string, ResourceRegistration>>(
  TABLE_ORDER.map((table) => [table, new Map()]),
);
let settingsSchema: z.ZodObject<z.ZodRawShape> = z.strictObject({});

/**
 * Register a component type. The single declaration drives boundary
 * validation, loader instantiation, and editor reflection. Importing the
 * module that calls this is what makes a type loadable (epic Branch A).
 *
 * @remarks
 * **Build atomicity contract:** if `build` allocates GPU resources (e.g. a
 * binding or mesh) and then throws before returning, it MUST free those
 * resources itself (e.g. via `try/catch` + `binding.destroy`). The loader
 * only tracks and later frees the instance that `build` RETURNS — any
 * allocation that does not make it into the return value leaks permanently.
 *
 * @throws {FurnaceError} if `name` is already registered (setup-loud).
 */
export function defineComponent<S extends z.ZodRawShape, I>(
  name: string,
  def: ComponentDefinition<S, I>,
): void {
  if (components.has(name)) {
    throw new FurnaceError(`scene: component "${name}" is already registered`);
  }
  const shape = def.params ?? {};
  components.set(name, {
    shape,
    schema: z.strictObject(shape),
    // Boundary cast: erased storage of the generically-typed hooks; the loader
    // re-pairs instance and registration, so types line up by construction.
    build: def.build as ComponentRegistration["build"],
    destroy: def.destroy as ComponentRegistration["destroy"],
  });
}

/**
 * Register a resource kind within a fixed table. Same single-declaration
 * contract as {@link defineComponent}.
 *
 * @remarks
 * **Build atomicity contract:** if `build` allocates GPU resources (e.g. a
 * binding or geometry) and then throws before returning, it MUST free those
 * resources itself (e.g. via `try/catch` + `binding.destroy`). The loader
 * only tracks and later frees the instance that `build` RETURNS — any
 * allocation that does not make it into the return value leaks permanently.
 *
 * @throws {FurnaceError} if `table`+`kind` is already registered (setup-loud).
 */
export function defineResource<
  T extends TableName,
  S extends z.ZodRawShape,
  I extends TableHandle<T>,
>(
  table: T,
  kind: string,
  def: ResourceDefinition<T, S, I> & { handle?: undefined },
): void;
export function defineResource<T extends TableName, S extends z.ZodRawShape, I>(
  table: T,
  kind: string,
  def: ResourceDefinition<T, S, I> & { handle(instance: I): TableHandle<T> },
): void;
export function defineResource<T extends TableName, S extends z.ZodRawShape, I>(
  table: T,
  kind: string,
  def: ResourceDefinition<T, S, I>,
): void {
  const perTable = resources.get(table);
  if (!perTable)
    throw new FurnaceError(`scene: unknown resource table "${table}"`);
  if (perTable.has(kind)) {
    throw new FurnaceError(
      `scene: resource kind "${table}/${kind}" is already registered`,
    );
  }
  const shape = def.params ?? {};
  perTable.set(kind, {
    shape,
    schema: z.strictObject(shape),
    // Boundary cast: erased storage, see defineComponent.
    build: def.build as ResourceRegistration["build"],
    handle: def.handle as ResourceRegistration["handle"],
    destroy: def.destroy as ResourceRegistration["destroy"],
  });
}

/** Internal: look up a component registration. */
export function getComponent(name: string): ComponentRegistration | undefined {
  return components.get(name);
}

/** Internal: all component registrations in registration order. */
export function componentEntries(): [string, ComponentRegistration][] {
  return [...components.entries()];
}

/** Internal: look up a resource-kind registration. */
export function getResourceKind(
  table: TableName,
  kind: string,
): ResourceRegistration | undefined {
  return resources.get(table)?.get(kind);
}

/** Internal: all kind registrations of a table. */
export function resourceKindEntries(
  table: TableName,
): [string, ResourceRegistration][] {
  return [...(resources.get(table)?.entries() ?? [])];
}

/** Internal: install the scene-level settings schema (core-owned, builtins). */
export function setSettingsSchema(shape: z.ZodRawShape): void {
  settingsSchema = z.strictObject(shape);
}

/** Internal: the scene-level settings schema. */
export function getSettingsSchema(): z.ZodObject<z.ZodRawShape> {
  return settingsSchema;
}

/** Internal, tests only: wipe the registry (suites re-register builtins after). */
export function resetRegistryForTests(): void {
  components.clear();
  for (const m of resources.values()) m.clear();
  settingsSchema = z.strictObject({});
}

/** A JSON Schema document (draft 2020-12), as produced by zod. */
export type JsonSchema = Record<string, unknown>;

/** The registry's reflection snapshot: everything an inspector generator needs. */
export type SceneSchemaReflection = {
  components: Record<string, JsonSchema>;
  resources: Record<TableName, Record<string, JsonSchema>>;
  settings: JsonSchema;
};

/**
 * Reflect the registry's two surfaces — per-entity component schemas and the
 * scene-level settings schema — as JSON Schema (furnace field semantics
 * embedded per field under the `furnace` key). The editor's inspector
 * generator (M5) and its daemon wire format consume exactly this. Computed
 * lazily per call; reflection is a cold, edit-time path.
 */
export function introspect(): SceneSchemaReflection {
  const toJson = (schema: z.ZodObject<z.ZodRawShape>): JsonSchema =>
    // Boundary cast: z.toJSONSchema returns a wide JSON-serialisable type;
    // we narrow to Record<string,unknown> for a stable internal contract.
    z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  return {
    components: Object.fromEntries(
      componentEntries().map(([n, r]) => [n, toJson(r.schema)]),
    ),
    // Boundary cast: Object.fromEntries widens the key to string; cast
    // restores the TableName constraint the caller can rely on.
    resources: Object.fromEntries(
      TABLE_ORDER.map((table) => [
        table,
        Object.fromEntries(
          resourceKindEntries(table).map(([k, r]) => [k, toJson(r.schema)]),
        ),
      ]),
    ) as Record<TableName, Record<string, JsonSchema>>,
    settings: toJson(getSettingsSchema()),
  };
}
