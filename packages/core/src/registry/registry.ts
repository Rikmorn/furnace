import { z } from "zod";
import { FurnaceError } from "../errors.ts";

/** A JSON Schema document (draft 2020-12), as produced by zod. */
export type JsonSchema = Record<string, unknown>;

/** Naming for a registry's setup-loud errors: `${prefix}: ${noun} "x" is already registered`. */
export type RegistryOptions = { prefix: string; noun: string };

/**
 * A named-entry store with setup-loud duplicate registration. `entries()` is
 * registration order — load-bearing for the scene loader's two-pass build.
 */
export type Registry<R> = {
  register(name: string, entry: R): void;
  get(name: string): R | undefined;
  entries(): [string, R][];
  /** Tests only — suites re-register after. */
  reset(): void;
};

/**
 * Create a registry instance. Module-scope instances are process-global
 * mutable state and MUST be pinned in tests/architecture.test.ts.
 */
export function createRegistry<R>(opts: RegistryOptions): Registry<R> {
  const store = new Map<string, R>();
  return {
    register(name, entry) {
      if (store.has(name)) {
        throw new FurnaceError(
          `${opts.prefix}: ${opts.noun} "${name}" is already registered`,
        );
      }
      store.set(name, entry);
    },
    get: (name) => store.get(name),
    entries: () => [...store.entries()],
    reset: () => store.clear(),
  };
}

/**
 * Reflect a zod object as JSON Schema. `io` is a PER-REGISTRY choice:
 * scene uses "input" (its introspect.test pins `transform.required === []`);
 * generators use "output" (defaulted fields stay required, `.optional()`
 * fields drop — reproducing the hand-written `required` semantics).
 * The root `$schema` key is stripped: dialect metadata, not shape.
 */
export function toJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>,
  opts: { io: "input" | "output" },
): JsonSchema {
  // Boundary cast: z.toJSONSchema returns a wide JSON-serialisable type.
  const out = z.toJSONSchema(schema, { io: opts.io }) as JsonSchema;
  delete out["$schema"];
  return out;
}

/**
 * Parse `value` against `schema`, translating the first zod issue into a
 * `FurnaceError` locating the failure:
 * `<prefix>: <where> invalid at "<path>": <message>`.
 */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  where: string,
  prefix: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    throw new FurnaceError(
      `${prefix}: ${where} invalid at "${path}": ${issue?.message ?? "unknown issue"}`,
    );
  }
  return result.data;
}

/**
 * Read the `furnace` meta payload off a shape field, unwrapping `.optional()`.
 * Returns `undefined` for plain zod fields. The payload's shape is the
 * registry owner's contract (scene narrows to its `FurnaceMeta`; generators
 * attach `{ unit }`) — zod metas are untyped bags, so the owner names `M`.
 */
export function fieldFurnaceMeta<M = Record<string, unknown>>(
  field: z.ZodType,
): M | undefined {
  let s = field;
  while (s instanceof z.ZodOptional) s = s.unwrap() as z.ZodType;
  const meta = s.meta();
  // Boundary cast: zod metas are untyped; the registry owner declares M.
  return (meta as { furnace?: M } | undefined)?.furnace;
}

/**
 * Unwrap `.optional()` and return the inner `z.ZodObject` if the field is one
 * (directly or optional-wrapped); `undefined` for any other zod type. Used to
 * decide whether `resolveParams` (resolution) and `checkResourceRefs`
 * (validation) should recurse into a nested object shape — kept in sync so a
 * nested resource ref is validated at the boundary exactly where it resolves.
 */
export function asNestedObject(field: z.ZodType): z.ZodObject | undefined {
  let s = field;
  while (s instanceof z.ZodOptional) s = s.unwrap() as z.ZodType;
  return s instanceof z.ZodObject ? s : undefined;
}

/**
 * A function a consumer project exposes to the editor (Branch A: the
 * project's editor-extensions module registers it at import time). The
 * registry validates EXISTENCE + gives the seam a nameable failure; the
 * contract TYPE stays structural at the consuming edge (the wire-twin rule,
 * editor analyzer-protocol.ts:52-61).
 */
export type ServiceDefinition = { fn: (...args: never[]) => unknown };

const services = createRegistry<ServiceDefinition>({
  prefix: "registry",
  noun: "service",
});

/** Register a named service. @throws {FurnaceError} on duplicate (setup-loud). */
export function defineService(name: string, def: ServiceDefinition): void {
  services.register(name, def);
}

/**
 * Look up a registered service. @throws {FurnaceError} naming the missing
 * service — the replacement for a silent structural cast.
 */
export function getService(name: string): ServiceDefinition["fn"] {
  const s = services.get(name);
  if (!s) {
    throw new FurnaceError(
      `registry: service "${name}" is not registered — is the project's editor-extensions module imported before use?`,
    );
  }
  return s.fn;
}

/** Tests only. */
export function resetServicesForTests(): void {
  services.reset();
}
