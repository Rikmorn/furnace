// packages/core/src/field/registry.ts — the generator definer (T1b, spec §2 D4).
// One zod declaration drives runtime validation (parseOrThrow inside the
// evaluate wrapper) AND the emitted JSON `paramSchema`/`defaults` the editor
// forms render — the two can no longer drift. zod never leaves this module.
import {
  createRegistry,
  type JsonSchema,
  parseOrThrow,
  toJsonSchema,
  z,
} from "../registry/index.ts";
import type {
  EvaluateContext,
  GeneratorDef,
  GeneratorEmits,
  GeneratorResult,
  MaterialTable,
  MergePolicy,
} from "./types.ts";

/** Authoring shape for {@link defineGenerator}: zod params in, GeneratorDef
 *  out. Two default spellings, chosen by the param's REQUIRED bucket (the
 *  OPTIONAL_PARAM_KEYS rule in generators.ts):
 *  - A required param carries `.meta({ default: X })` — the default is FORM
 *    metadata only; a missing key still throws at parse (required is
 *    load-bearing, `generators.test.ts` pins it).
 *  - A post-hoc optional param carries `.default(X).optional()` — parse fills
 *    the identity default on an absent key (the recorded-params allowance).
 *  Unknown keys are TOLERATED (strip, not reject): params records round-trip
 *  fields this module does not own. `evaluate` receives PARSED params —
 *  per-field validation is the wrapper's job; cross-field rules stay plain
 *  code inside evaluate. */
export type GeneratorDeclaration<S extends z.ZodRawShape> = {
  id: string;
  name: string;
  params: S;
  contextFree: boolean;
  emits: GeneratorEmits;
  usesSeed: boolean;
  evaluate(
    params: z.output<z.ZodObject<S>>,
    seed: number,
    region: { min: [number, number, number]; max: [number, number, number] },
    table: MaterialTable,
    policy: MergePolicy,
    ctx?: EvaluateContext,
  ): GeneratorResult;
};

const generators = createRegistry<GeneratorDef>({
  prefix: "field",
  noun: "generator",
});

/** The per-property `default` values off an emitted schema — the one source
 *  both the session seed (`defaults`) and the rendered form (`paramSchema`)
 *  agree on. */
const defaultsOf = (schema: JsonSchema): Record<string, unknown> => {
  const props = schema["properties"];
  if (typeof props !== "object" || props === null) return {};
  return Object.fromEntries(
    Object.entries(props as Record<string, Record<string, unknown>>).map(
      ([k, p]) => [k, p["default"]],
    ),
  );
};

/** Define + register a field generator. The emitted `paramSchema`/`defaults`
 *  are plain JSON (structured-clone-safe — the editor host clones them);
 *  zod never leaves this module. `z.object`, NOT `strictObject`: unknown keys
 *  are tolerated by the evaluate contract (the params record round-trips
 *  fields this module does not own — the F3a recorded-params allowance);
 *  strip-mode drops them from the parsed value without rejecting the record.
 *  @throws {FurnaceError} on a duplicate id (setup-loud). */
export function defineGenerator<S extends z.ZodRawShape>(
  decl: GeneratorDeclaration<S>,
): GeneratorDef {
  const schema = z.object(decl.params);
  const paramSchema = toJsonSchema(schema, { io: "output" });
  const def: GeneratorDef = {
    id: decl.id,
    name: decl.name,
    paramSchema,
    defaults: defaultsOf(paramSchema),
    contextFree: decl.contextFree,
    emits: decl.emits,
    usesSeed: decl.usesSeed,
    evaluate(params, seed, region, table, policy, ctx) {
      const typed = parseOrThrow(schema, params, `${decl.id} params`, "field");
      return decl.evaluate(typed, seed, region, table, policy, ctx);
    },
  };
  generators.register(decl.id, def);
  return def;
}
