// WHAT THE AGENT DOOR ACCEPTS AS A FIELD OP — the mutation vocabulary as a validator.
//
// ITS OWN MODULE because of what it is rather than how long it is: `session-handlers.ts` is
// a family of COMMANDS and this is a data shape several of them lean on, so filing it there
// would answer a different question in the middle of that one (measured: 199 lines against
// 556, i.e. +35.8% — not the "half again" one draft of this line guessed at, nor the "~33%"
// the correction rounded to without dividing).
// The daemon already splits this way (`worlds.ts`, `claims.ts`, `origin.ts`).
//
// WHY IT IS HAND-WRITTEN WHEN `shared/field-op.ts` DERIVES THE TYPE FROM CORE'S. Because
// zod is banned from the neutral floor — `tests/frontend-no-engine-leakage.test.ts` scans
// `src/shared/` for it by name — and the daemon is the layer that validates. So the shape
// has two authors, exactly as `viewport.capture` does (its type is `shared/`'s, its schema
// is the daemon's), and the drift that arrangement invites is closed at the bottom of this
// file by a COMPILE-TIME assignability check rather than by review. A field added to core's
// `BrushOp` does not break that check (the schema stays a valid subset); a field REMOVED or
// RETYPED does. That is the half worth catching, since the failure mode is a door that
// accepts something the engine will reject.
//
// WHY A SCHEMA AT ALL, when core's `assertOpValid` is the real validator and produces the
// locator a refusal quotes. Three reasons, and the first is the one that pays: an MCP door
// ADVERTISES its `inputSchema`, so this is how an agent learns the op vocabulary without
// guessing — the same argument `viewport.capture`'s bounded `size` makes ("being TOLD the
// ceiling beats discovering it"). Second, `dispatch` is the single validator by design and
// a command whose input is `unknown` opts out of it. Third, the two checks are genuinely
// different: this one is about SHAPE, and core's is about whether the shape is buildable —
// a finite radius passes here and can still be refused there.
//
// THE ZOD INSTANCE IS THE DAEMON'S OWN (`zod`), not `@furnace/core/registry`'s re-export,
// which keeps this module free of any core edge — the daemon is Node-portable and
// `@furnace/core` is browser-only by the repo's foundational rule. `action-registry/
// schemas.ts` warns that mixing zod instances breaks `instanceof` introspection; measured on
// this workspace that cannot bite, because there is exactly ONE resolved copy
// (`node_modules/.bun/zod@4.4.3`) and core's `registry` module re-exports it rather than
// bundling its own. Nothing here composes across the two anyway: each schema is
// `safeParse`d on its own by `dispatch`.

// TYPE-ONLY, so it is erased and this Node-portable module takes no runtime edge on a
// browser-only package — `shared/field-op.ts`'s precedent, one layer up.
import type * as core from "@furnace/core/field";
import { z } from "zod";
import { HOLLOW_MIN_M } from "../shared/field-limits.ts";
import type { BrushOpInput } from "../shared/field-op.ts";

/**
 * Core's flood ceiling, RESTATED here and GUARDED so the restatement cannot drift.
 *
 * The daemon may not VALUE-import the engine, so the literal has to be written out. What
 * makes that safe rather than the usual hand-copy is the line below: a type-level equality
 * against core's own constant, which is a literal type (`export const MAX_SELECTION_BUDGET =
 * 262144`) and therefore comparable. Change either number and the build fails.
 *
 * THIS FILE ARGUED THE OPPOSITE FOR ONE COMMIT — that the bound "cannot be derived" and so
 * could not be advertised. That was false, and the disproof was already in this file:
 * {@link OP_SCHEMA_MATCHES_CORE} does exactly this against a whole type. A reason that
 * survives only because nobody checked it is worse than the gap it excuses.
 */
const MAX_FLOOD_BUDGET = 262144;

/** Compile-time equality between {@link MAX_FLOOD_BUDGET} and core's constant. Both
 *  directions: a core value that grew, shrank, or widened to `number` all fail. */
type BudgetMatchesCore =
  typeof core.MAX_SELECTION_BUDGET extends typeof MAX_FLOOD_BUDGET
    ? typeof MAX_FLOOD_BUDGET extends typeof core.MAX_SELECTION_BUDGET
      ? true
      : never
    : never;
export const BUDGET_CEILING_MATCHES_CORE: BudgetMatchesCore = true;

/** A flood's cell budget — integers in `[1, MAX_SELECTION_BUDGET]`, core's own range. */
const floodBudget = z.number().int().positive().max(MAX_FLOOD_BUDGET);

/**
 * A world-metre point — a tuple, whose PROJECTION had to be corrected by hand.
 *
 * Finiteness is core's check, not this one: `z.number()` already rejects `NaN`, and whether
 * a finite value is BUILDABLE is a question only the applier can answer.
 *
 * **THE `.meta()` IS THE ADVERTISEMENT, AND IT IS THERE BECAUSE THE REFLECTION IS LOSSY.**
 * This declaration used to carry the line *"tuple rather than `z.array(z.number()).length(3)`
 * so the ADVERTISED JSON Schema says 'exactly three numbers' in a form a client can read
 * off"*, which was **false**, measured on zod 4.4.3 at T4c Task 6:
 * `z.toJSONSchema(z.tuple([n,n,n]))` emits `prefixItems` and NOTHING else — no `minItems`,
 * no `maxItems`, no `items: false` — and `prefixItems` alone constrains no length at all. So
 * the door advertised a shape that admits `[1, 2]` while `dispatch` refuses it: the
 * advertisement looser than the validator, which is the one defect the projection exists to
 * make impossible. The bounds are restated through `.meta()`, which zod hoists onto the same
 * node, so the document a client reads and the schema that decides agree again.
 *
 * `.meta()` RATHER THAN SWITCHING TO `z.array(...).length(3)`, which projects correctly on
 * its own: that spelling infers `number[]`, and both drift pins in this daemon
 * ({@link OP_SCHEMA_MATCHES_CORE} and `session-handlers.ts`'s `QUERY_SCHEMA_MATCHES_WIRE`)
 * assert against declarations typed as three-tuples. Trading a compile-time pin for a
 * keyword is the wrong side of that bargain. Metadata does not touch parsing — verified —
 * so this adds a keyword to the document and nothing to the runtime.
 *
 * A NEW TUPLE THAT FORGETS THIS IS CAUGHT: `tests/mcp.test.ts` walks every advertised
 * document and reds on a `prefixItems` node with no matching length bounds.
 */
const vec3 = z
  .tuple([z.number(), z.number(), z.number()])
  .meta({ minItems: 3, maxItems: 3 });

/** The three brush extents. A discriminated union on `kind`, which is what makes a bad shape
 *  report against the member it MEANT rather than as "no union arm matched". */
const shape = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("sphere"),
    center: vec3,
    radius: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal("box"),
    center: vec3,
    halfExtents: vec3,
  }),
  /** The SWEPT sphere from `a` to `b`. Degenerates cleanly — `a === b` is exactly the
   *  sphere of that radius at that point — so no rule forbids it. */
  z.strictObject({
    kind: z.literal("capsule"),
    a: vec3,
    b: vec3,
    radius: z.number().positive(),
  }),
]);

/** A deterministic selection, as the op RECORD embeds it. Fully composable by a caller that
 *  can name coordinates, which is why the `selection` mask below is offered rather than
 *  withheld — nothing in here needs a live viewport to build.
 *
 *  `budget` IS BOUNDED BY CORE'S OWN CEILING — see {@link MAX_FLOOD_BUDGET}. An earlier
 *  version of this file left it unbounded and argued the number "cannot be derived", which
 *  was false and was disproved ninety lines below by the drift pin using the very technique
 *  it said was unavailable. */
const selectionSpec = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("region"), min: vec3, max: vec3 }),
  z.strictObject({
    kind: z.literal("flood-material"),
    seed: vec3,
    classId: z.number().int().nonnegative(),
    budget: floodBudget,
  }),
  z.strictObject({
    kind: z.literal("flood-void"),
    seed: vec3,
    budget: floodBudget,
  }),
]);

/** The cross-cutting cell filter, evaluated per sample after the effect's own guards. */
const mask = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("organic-only") }),
  z.strictObject({ kind: z.literal("kit-only") }),
  z.strictObject({
    kind: z.literal("class"),
    classId: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("solid-only") }),
  z.strictObject({ kind: z.literal("selection"), selection: selectionSpec }),
]);

/** Smooth-effect parameters. The two integer RANGES are core's own (`SmoothParams`) and are
 *  stated here for the advertisement's sake: a caller told `1..64` up front never sends 100
 *  and never has to learn from a refusal what a schema could have said. */
const smooth = z.strictObject({
  strength: z.number().int().min(1).max(64),
  iterations: z.number().int().min(1).max(4),
  mode: z.enum(["both", "erode", "fill"]),
});

/**
 * One op a caller WROTE — core's `BrushOp` minus the `id` the log mints.
 *
 * `z.strictObject`, so a misspelled field is REPORTED rather than silently dropped. That
 * matters more here than almost anywhere else in this daemon: a `radiuss` quietly discarded
 * would leave a shape with no radius, which the applier then refuses for a reason that says
 * nothing about the typo.
 *
 * `kind: "brush"` IS REQUIRED even though it is the only value, and spelling it beats
 * defaulting it. Core's op union has three members and only this one is caller-authored, so
 * the literal is what makes a `patch` or `placement` sent here fail with "expected brush"
 * rather than with a confusing complaint about missing brush fields.
 */
export const BRUSH_OP = z.strictObject({
  kind: z.literal("brush"),
  effect: z.enum(["dig", "fill", "paint", "smooth"]),
  shape,
  /** The class `fill` writes and `paint` applies; ignored by dig and smooth. */
  material: z.number().int().nonnegative().optional(),
  mask: mask.optional(),
  smooth: smooth.optional(),
  /** Shell-band thickness in metres, FILL only — floored at {@link HOLLOW_MIN_M}.
   *
   *  ENFORCED HERE, and it had to be somewhere: the comment this replaced said *"the host
   *  applies a 0.5 m floor of its own"*, which is FALSE for this door. That floor is
   *  `clampTool`'s (`field-host/field-tool.ts`) and belongs to the INTERACTIVE path — a
   *  chrome `setTool` goes through it, and `applyOps` goes straight to `logApplyGroup`. So
   *  an agent reading that description sent `hollow: 0.05` and got exactly the holey shell
   *  the floor exists to prevent, with nothing anywhere refusing it.
   *
   *  REFUSED RATHER THAN CLAMPED, which is the daemon's half of the split `viewport.capture`
   *  states for `size`: the host clamps because a slider must not be able to ask for
   *  something illegal, and the door refuses because a schema is also the ADVERTISEMENT and
   *  being told the floor beats discovering it. Clamping here would be worse than either —
   *  the op the log recorded would differ from the op the caller sent, and replay would
   *  reproduce a request nobody made.
   *
   *  Core accepts any finite positive thickness (it cannot clamp against the cell size); the
   *  editor's position is that a sub-cell shell on an organic shape comes out holey, and
   *  this is where that position is stated to a caller who cannot see the strip. */
  hollow: z.number().min(HOLLOW_MIN_M).optional(),
});

/**
 * The batch `edit.apply` takes.
 *
 * `.min(1)` IS THE ADVERTISED RULE, and it is stated here rather than in the host because
 * this is the layer that can TELL a caller. Core treats an empty list as a deliberate no-op
 * (pushing no undo entry, because a phantom history step would cost a real one) and the host
 * passes that through unchanged — so an empty batch would otherwise be answered `ok` for
 * doing nothing, which is a true statement that hides a caller's mistake. Refusing it at the
 * door is the honest place: the schema says the rule, and `dispatch` enforces it before any
 * of this reaches a tab.
 *
 * NO UPPER BOUND, deliberately. The batch IS the undo entry, so a cap would not protect the
 * history; it would only split one intended act into several. Core validates the whole list
 * before it writes anything, so a long bad batch costs a validation pass and no mutation.
 */
export const BRUSH_OPS = z.array(BRUSH_OP).min(1);

/**
 * The drift check the two-author arrangement is worth having.
 *
 * A parsed op must BE a {@link BrushOpInput} — the type `shared/field-op.ts` derives from
 * core's own `BrushOp`. Assigning the inferred output to that type is the whole assertion;
 * it costs nothing at runtime (the value is never built) and it fails the build the day the
 * schema and the engine disagree about a field's name or type.
 *
 * WHAT IT CATCHES, MEASURED — and this paragraph has now been wrong twice, so it is a table
 * rather than a sentence. Probed by mutating `BrushOp` in core and running `tsc`:
 *
 * | core changes | caught here |
 * |---|---|
 * | RETYPES a field | **yes** — the schema's type no longer satisfies the target |
 * | ADDS a REQUIRED field | **yes** — an object missing it is not assignable |
 * | ADDS an optional field | no |
 * | REMOVES an optional field | **no** |
 * | RENAMES an optional field | **no** |
 *
 * The bottom three all slip for ONE reason: `extends` is assignability, and extra properties
 * on the source side never break it. A schema carrying `hollow` after core dropped it is
 * still assignable to a target without `hollow`.
 *
 * SO THE HONEST CLAIM IS NARROWER THAN "it catches the dangerous direction", which is what
 * this said before and is the sentence that would let someone remove a core field, see
 * green, and ship a door accepting what the applier cannot use. It catches a RETYPE and a
 * new REQUIRED field. A removal or an optional rename is exactly as invisible as an added
 * optional field, and finding those is a reader's job, not this pin's.
 *
 * (The first draft understated it in the safe direction; the correction that replaced it
 * introduced a new false clause while advertising itself as "stated more precisely". A
 * build-time guarantee is the one kind of prose worth probing before writing.)
 */
type SchemaOpIsABrushOpInput =
  z.infer<typeof BRUSH_OP> extends BrushOpInput ? true : never;
export const OP_SCHEMA_MATCHES_CORE: SchemaOpIsABrushOpInput = true;
