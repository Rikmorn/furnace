import { z } from "zod";
import { FurnaceError } from "../errors.ts";

/** A JSON Schema document (draft 2020-12), as produced by zod. */
export type JsonSchema = Record<string, unknown>;

/** Naming for a registry's setup-loud errors: `${prefix}: ${noun} "x" is already registered`. */
export type RegistryOptions = { prefix: string; noun: string };

/** A named-entry store with setup-loud duplicate registration. */
export type Registry<R> = {
  register(name: string, entry: R): void;
  get(name: string): R | undefined;
  /** Registered entries as `[name, entry]` pairs in REGISTRATION ORDER (Map
   *  insertion order — the guarantee an ordered enumeration pass reads). A
   *  fresh array each call; mutating it never touches the registry. */
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
 * `"output"` keeps defaulted fields required and drops `.optional()` ones —
 * what the field generators want, since a defaulted param is always present in
 * the params object the evaluator receives. `"input"` is the authoring view: a
 * defaulted field is omittable, so it leaves `required`. Either way `.meta({
 * furnace })` is hoisted to the NODE ROOT, which is where the editor's kind
 * resolver reads it from. The root `$schema` key is stripped: dialect metadata,
 * not shape.
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
