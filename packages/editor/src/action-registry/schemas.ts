// WHAT AN ACTION TAKES — the six verbs that act on something the caller must NAME, as zod
// schemas keyed by id.
//
// WHY IT IS ITS OWN MODULE, and it is a layering fact rather than a filing preference. Four
// chrome surfaces render descriptor DATA (`hint`, `keys`, `group`) at runtime, which needs a
// VALUE import; the chrome bundle must gain neither zod nor `@furnace/core` behind it. Those
// two are only compatible if the zod lives somewhere the chrome never value-imports — so
// `descriptors.ts` stays plain, zod-free, chrome-value-importable data, and every schema
// lives HERE. The guard was narrowed to match: `tests/frontend-no-engine-leakage.test.ts`
// forbids a chrome value-import of `action-registry/schemas` and of bare `zod`, and permits
// the rest of the directory (editor-architecture §22.5, where the decision was recorded
// before T3b2 Task 4 implemented it).
//
// `index.ts` re-exports the TYPES below and deliberately not the values, for the same
// reason: a barrel that value-re-exported this module would put zod back in reach of any
// chrome file importing the barrel, and the narrowed rule would not see it.
//
// THE `z` INSTANCE. Built from `@furnace/core/registry`'s re-export and no other zod
// install: schema objects cross registry boundaries and mixing instances breaks the
// `instanceof` introspection every projection depends on. JSON Schema for the wire comes
// from `toJsonSchema` at the projection edge and is never hand-authored here — and since T4b
// that reflection is PINNED rather than assumed: `tests/action-registry/
// projection-round-trip.test.ts` reads the advertised document the way a client would and
// requires its verdict on every sample/row pair to equal `safeParse`'s. Two representations
// of one contract, and only one of them decides; the pin landed BEFORE anything was
// projected, so the projection could not be the thing that discovered they disagreed. Since
// T4c Task 6 something is: `daemon/mcp.ts`'s `action_run` row names these ids and the daemon
// applies these schemas, so the pin now guards a live wire rather than a future one.
//
// SIX ROWS, NOT TWELVE. The measured worklist counts twelve actions as needing input and
// SIX of those are the axis views — which do not appear here, deliberately. Their axis and
// sign are closed over by the id itself (`view.snapNegZ` IS "z, −1"), so a schema would let
// a caller hand `view.snapNegZ` an axis of `x` and make the id a lie. What they carry
// instead is `mcpProjection`, which records that the six collapse onto ONE `view.snap
// {axis, sign}` agent tool while the chrome keeps six literal, greppable ids — the WCAG
// 2.5.8 equivalent affordance for `AxisTriad`'s sub-minimum tips (editor-architecture
// §18.5). Both facts, stated once each, in the place that can hold them.
//
// EVERY FIELD IS REQUIRED, and the OPTIONALITY lives one level up: `InputOf` admits
// `undefined`, so "no input at all" is expressible and "an input that names nothing" is
// not. That is the split the two callers actually want — the chrome dispatches with no
// input and each run falls back to what the ctx has selected, while an agent that names a
// verb must name its object too.
//
// AND EVERY ROW IS `z.strictObject`, WHICH IT WAS NOT UNTIL T4c TASK 6 — the moment these
// rows became reachable from an agent. `z.object` STRIPS an undeclared key; every command
// in the daemon (`handlers.ts`, `session-handlers.ts`) refuses one. Two doors into one
// editor with two postures is invisible until an agent makes exactly one mistake at each:
// an invented argument to `session_state` earns a typed `invalid-input` carrying the remedy
// *"re-read its inputSchema"*, while the same mistake against `action_run {id:"tool.stamp"}`
// was silently dropped — indistinguishable from success, and the agent learns nothing. The
// stripping half is the worse half, so it is the half that changed. The projection grows
// `additionalProperties: false` with it, which is the advertisement finally saying what the
// validator was always going to do to the NEXT caller. Filed and resolved as
// `action-input-schemas-strip-what-commands-refuse`; the chrome is unaffected because no
// chrome surface parses through these (`runAction` hands a typed input straight to the run —
// `daemon/session-handlers.ts` is the only `safeParse` caller in the tree).
import { z } from "@furnace/core/registry";
import type { ActionId } from "./descriptors.ts";

/** The input each of the six declares, by action id. Absent from this map = a bare verb,
 *  which is the other 33.
 *
 *  `satisfies` over a `Partial` record of {@link ActionId} is what stops a key here from
 *  drifting off the table: a renamed action fails to compile rather than shipping a schema
 *  nothing can reach. */
export const ACTION_INPUT_SCHEMAS = {
  /** Name a copy. With no input the drawer opens to collect the name (what ⇧⌘S has always
   *  done); with one, the world is written under it. */
  "world.saveAs": z.strictObject({ name: z.string() }),
  /** Point `worlds/index.json` at a world by name. The chrome always means the one that is
   *  open; an agent may mean another. */
  "world.makeDefault": z.strictObject({ name: z.string() }),
  /** THE EXEMPLAR of the entity trio — the id the host published for a committed entity,
   *  which is what `ctx.selectedEntity` carries and what a duplicate acts on. */
  "edit.duplicate": z.strictObject({ entityId: z.number().int() }),
  "edit.delete": z.strictObject({ entityId: z.number().int() }),
  "edit.grab": z.strictObject({ entityId: z.number().int() }),
  /** THE EXEMPLAR of the whole set: a registry generator id (`hall`, `maze`), which is what
   *  the `S` family's cursor points at and what opens a stamp session. */
  "tool.stamp": z.strictObject({ generatorId: z.string() }),
} as const satisfies Partial<Record<ActionId, z.ZodObject<z.ZodRawShape>>>;

/** Every action's input, by id — the parsed shape, not the schema. Derived so the two
 *  cannot disagree. */
export type ActionInputs = {
  readonly [Id in keyof typeof ACTION_INPUT_SCHEMAS]: z.infer<
    (typeof ACTION_INPUT_SCHEMAS)[Id]
  >;
};

/** What a run of THIS action may be handed beyond the ctx.
 *
 *  `undefined` is a member for every id, including the six above, and that is the whole
 *  shape of the chrome/agent split: a chrome surface dispatches a verb with no input and
 *  the run falls back to what is selected, while a caller that DOES name an object names
 *  all of it (the fields inside are required). A bare verb has only the `undefined`
 *  member — there is nothing to hand it. */
export type InputOf<Id extends string> = Id extends keyof ActionInputs
  ? ActionInputs[Id] | undefined
  : undefined;
