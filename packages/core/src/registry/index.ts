/**
 * The zod instance the furnace registries validate with. Definition authors
 * MUST build schemas from this re-export (not their own zod install) — schema
 * objects cross registry boundaries, and mixing zod instances/versions breaks
 * `instanceof`-based introspection.
 */
export { z } from "zod";
export {
  createRegistry,
  defineService,
  type FurnaceMeta,
  getService,
  type JsonSchema,
  parseOrThrow,
  type Registry,
  type RegistryOptions,
  resetServicesForTests,
  type ServiceDefinition,
  toJsonSchema,
} from "./registry.ts";
