// What each undo/redo step DID, in words — the derivation behind every named history
// affordance (D-F4.5-11: "undo affordances are NAMED everywhere").
//
// Core's `LogEntry` carries NO label field, and deliberately so: a label is a
// presentation fact that would have to be authored at every push site, kept in step with
// the verb that pushed it, and serialized into worlds it has no business being in. It is
// DERIVABLE instead — every entry already holds the record of what it did — and this
// module is the one place that derivation lives, so the burger's "Undo dig", the
// palette's rows and anything later cannot disagree about what a step is called.
//
// PURE, and GPU-free, for the reason `field-pick.ts` and `field-move.ts` are: the host
// can only be asked these questions through a live context, and the answers are string
// comparisons that deserve to be asserted directly.
//
// It reads core's generator REGISTRY (`FIELD_GENERATORS`) for display names. That keeps
// the function pure — the registry is a module constant, not host state — and keeps the
// host out of it: a `generatorName` parameter threaded from the caller would make every
// call site able to answer differently, which is the drift this module exists to
// prevent. It deliberately does NOT go through core's `generatorById`, which is
// setup-loud on an unknown id: a world file can name a generator that has since been
// retired (the host's own commentary marks three call sites "setup-loud on a retired
// id"), and a label that THREW would take down every surface rendering history — a menu,
// a palette — because of one stale row. The id is the fallback.
import type {
  BrushOp,
  FieldOp,
  GeneratorEntity,
  LogEntry,
} from "@furnace/core/field";
import { FIELD_GENERATORS } from "@furnace/core/field";

/** How many entries per side the {@link FieldHistory} payload carries.
 *
 *  It is a display bound, never a history bound: `log.undoStack` keeps every entry and
 *  ⌘Z still reaches all of them. What it bounds is (a) the work of re-deriving labels on
 *  every mutation, (b) the rows the History palette renders, and — as a consequence
 *  worth naming rather than discovering — (c) the most steps ONE palette row click can
 *  ever take, since a row that is not rendered cannot be clicked.
 *
 *  50 is Photoshop's own default history-state count, which is the precedent the palette
 *  is shaped after. */
export const HISTORY_TAIL = 50;

/** The named history, as the chrome reads it.
 *
 *  Both arrays are NEWEST-LAST: `undo.at(-1)` is the top of the undo stack, i.e. exactly
 *  what ⌘Z would step, and `redo.at(-1)` what ⇧⌘Z would. That is the ordering the stacks
 *  themselves use, and re-ordering here would put a reversal between two things that
 *  index into each other.
 *
 *  The depths are the TRUE stack depths, which the arrays are not once a history passes
 *  {@link HISTORY_TAIL}. They ride here rather than being read off `FieldStats` — which
 *  also carries them — because the surface that needs them is a 50-row list, and
 *  `FieldStats` is pushed every animation frame: subscribing a list to a per-frame seam
 *  to read two integers is the render cost this provider's cadence split exists to
 *  avoid. Both are computed in the same pass as the arrays beside them, so they cannot
 *  describe a different moment. */
export type FieldHistory = {
  undo: readonly string[];
  redo: readonly string[];
  undoDepth: number;
  redoDepth: number;
};

/** A generator's display name, falling back to its raw id. See the header for why this
 *  does not use core's `generatorById`. */
function generatorName(id: string): string {
  return FIELD_GENERATORS.find((g) => g.id === id)?.name ?? id;
}

/** The name of the entity a span's ops describe — the LAST op in a span is the entity
 *  op (core's contiguity invariant: "the brush ops the commit appended sit immediately
 *  BEFORE the entity op"). Null when the span does not end in one, which no core verb
 *  produces. */
function spanEntity(ops: readonly FieldOp[]): GeneratorEntity | null {
  const last = ops.at(-1);
  return last !== undefined && last.kind === "entity" ? last.entity : null;
}

/** What a brush op did: its effect, prefixed when the shape is the two-click swept
 *  capsule rather than a plain stroke.
 *
 *  A HOLLOW fill is deliberately still "fill" — the shell is a variant of the fill
 *  effect, not a fifth verb, and every other surface (the rail, the strip) calls it
 *  fill too. */
function brushLabel(op: BrushOp): string {
  return op.shape.kind === "capsule" ? `segment ${op.effect}` : op.effect;
}

const sameRegion = (
  a: GeneratorEntity["region"],
  b: GeneratorEntity["region"],
): boolean =>
  a.min.every((v, i) => v === b.min[i]) &&
  a.max.every((v, i) => v === b.max[i]);

/** Do two param sets carry the same values? Schema params are JSON by construction (they
 *  cross the worker wire and the world file), so a serialized compare is exact for the
 *  domain — and both sides here come from the same provenance path, which is what keeps
 *  key ORDER from making two equal sets look different. */
const sameParams = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What the LAST op of an `ops` entry did — the entry's whole span is one undo unit, and
 *  its last member is what names it (core's contiguity invariant puts a commit's entity
 *  op at the end of its span).
 *
 *  Its own function so the switch below can be TOTAL over `FieldOp` rather than nested
 *  inside another switch that swallows its fallthrough — which is exactly how the first
 *  cut of this module ended up claiming an exhaustiveness it did not have. */
function opsEntryLabel(ops: readonly FieldOp[]): string {
  const last = ops.at(-1);
  // An entry with no ops at all is not produced by anything: every push carries at
  // least the op it applied.
  if (last === undefined) return "edit";
  switch (last.kind) {
    case "entity":
      // A generator commit — its span plus its entity op, one entry. `duplicate` reads
      // identically, and that is accepted rather than papered over: a duplicate IS a
      // fresh commit from the same recipe, and the entry holds nothing that
      // distinguishes the two.
      return `stamp ${generatorName(last.entity.generator)}`;
    case "brush":
      return brushLabel(last);
    case "patch":
      // Semantic compaction, and this row is unreachable in the editor for a STRONGER
      // reason than "it happens before any subscriber exists": `compactRuns` pushes NO
      // log entry whatsoever (its own TSDoc — "there is no stack to push onto", and it
      // refuses outright unless both stacks are already empty), so compaction cannot
      // produce a history row at all. The only producer of a patch-topped entry is
      // `logApplyPatch`, which the editor never calls. Labelled anyway, because an
      // unlabelled row would be worse than an unreachable one if that ever changes.
      return "compact";
    case "placement":
      // Placement ops only ever ride INSIDE a commit's span, so an entry ending in one
      // is unreachable today. Named rather than defaulted, for the reason above.
      return "place";
    default:
      return unhandled(last);
  }
}

/** The exhaustiveness guard both switches end on. A new `FieldOp` or `LogEntry` member
 *  fails to type-check HERE — the parameter is `never`, so the compiler rejects the call
 *  the moment the switch above it stops covering its union.
 *
 *  Written as a function rather than a `const _: never = x` line because the value has to
 *  be USED: an unused local is what biome's `noUnusedVariables` removes, and a guard that
 *  a formatter can delete is not a guard. The return keeps the callers total.
 *
 *  This exists because the claim came first and the enforcement did not: the original
 *  TSDoc asserted the compiler enforced totality while a trailing `return "edit"` quietly
 *  swallowed both unions. Proven by experiment — a probe member added to each union
 *  produced errors in four other files and none here. */
function unhandled(value: never): string {
  void value;
  return "edit";
}

/** What ONE undo/redo step did, as a short lower-case phrase — verb first, subject
 *  second ("dig", "move Hall"), so the menu can read `Undo ${label}` and the palette can
 *  stack them in one column without the rows changing grammatical shape.
 *
 *  Total over `LogEntry` and, through {@link opsEntryLabel}, over `FieldOp`: a new member
 *  of either fails to type-check at {@link unhandled} until it is named here. */
export function entryLabel(entry: LogEntry): string {
  switch (entry.kind) {
    case "ops":
      return opsEntryLabel(entry.ops);
    case "splice": {
      const before = spanEntity(entry.removed);
      const name = before === null ? "stamp" : generatorName(before.generator);
      // An empty `inserted` is the ONLY thing separating a delete from a reconfigure at
      // this level — `deleteGeneratorEntity` is reconfigure's splice with no
      // replacement.
      if (entry.inserted.length === 0) return `delete ${name}`;
      const after = spanEntity(entry.inserted);
      if (before === null || after === null) return `reconfigure ${name}`;
      // "move" means ONLY the region moved. A re-shape that also slid the region is a
      // reconfigure: calling it a move would name something the user did not do, and
      // the region is the least of what changed. `policy` is not compared because
      // `GeneratorEntity` does not carry it — a policy-only change therefore reads as a
      // reconfigure, which is what it is.
      const moved = !sameRegion(before.region, after.region);
      const settled =
        before.seed === after.seed && sameParams(before.params, after.params);
      return moved && settled ? `move ${name}` : `reconfigure ${name}`;
    }
    case "entity-update": {
      const name = generatorName(entry.after.entity.generator);
      // BAKED IS CHECKED FIRST, and it has to be: `bakeGeneratorEntity` CLEARS `frozen`
      // as part of severing the recipe, so baking a frozen entity moves BOTH flags in
      // one entry. Asking about `frozen` first would read true→absent and call the one
      // irreversible verb an "unfreeze".
      const baked =
        entry.after.entity.baked === true && entry.before.entity.baked !== true;
      if (baked) return `bake ${name}`;
      if (entry.before.entity.frozen !== entry.after.entity.frozen)
        return entry.after.entity.frozen === true
          ? `freeze ${name}`
          : `unfreeze ${name}`;
      // No verb pushes an entity-update that moves neither flag (both callers compare
      // first and push nothing when the request is already satisfied).
      return `update ${name}`;
    }
    default:
      return unhandled(entry);
  }
}

/** The named history for a pair of log stacks — the {@link FieldHistory} payload the
 *  host publishes. Reads the stacks and nothing else, which is what makes the host's
 *  change-signature (see `field-history-feed.ts`) able to be a fact about them alone. */
export function fieldHistory(
  undoStack: readonly LogEntry[],
  redoStack: readonly LogEntry[],
): FieldHistory {
  return {
    undo: undoStack.slice(-HISTORY_TAIL).map(entryLabel),
    redo: redoStack.slice(-HISTORY_TAIL).map(entryLabel),
    undoDepth: undoStack.length,
    redoDepth: redoStack.length,
  };
}
