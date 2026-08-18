// The armed brush: what it IS (effect, material class, mask, smooth params,
// radius), what a modifier held down TEMPORARILY makes it, and what applying it
// at a world point does to the log. The sixteenth cluster lifted out of
// `createFieldHost`, and the first one whose state is reached from outside
// through the host's own KEY LISTENERS rather than through a method.
//
// THAT IS THE SHAPE WORTH NAMING FIRST. Three of this module's fifteen verbs
// exist because `onKeyDown` / `onKeyUp` / `onBlur` stay in `field-host.ts` — the
// `input` cluster is the listener/delegate layer and is declared facade-resident,
// exactly as `attachListeners` owning the canvas element made the pointer chain's
// four handlers one-line delegates at T3c. So the DOM event stays over there and
// what it DOES is a call: `noteModifierDown("shift")`, not `momentaryShift = true`.
// A `setMomentaryShift(v)` seam would have handed the listener back the same
// assignment it just gave up, and with it the repeat guard, the derive, and the
// ORDER of the two — which is the whole of what the momentary contract is.
//
// THE MOMENTARY CONTRACT, because it is the part a move can break silently.
// `deriveMomentary` is a pure function of (saved base, ⇧ held, ⌃ held), so ANY
// press/release interleaving lands back on the base. That property depends on
// three things this file now owns together and nothing else may reach:
//   - the ONE saved slot (`momentarySaved`), written when the FIRST modifier
//     engages and cleared when BOTH release;
//   - the repeat guard on each flag, which is why a held key's auto-repeat does
//     not re-save the DERIVED tool as the base;
//   - `setTool`'s branch ORDER — the momentary branch sits ABOVE the value guard,
//     so a pick that equals the DERIVED tool still moves the base.
// `tests/field-host-momentary.gpu.test.ts` reaches all three through the real
// keydown/keyup listeners and through no other route (the flags are private and
// no `FieldHost` member sets them); its header states what each case defends.
// Those four cases pass UNMODIFIED across this extraction, which is the contract
// this file is verified against — measured both ways round: dropping
// `deriveMomentary()` from `noteModifierUp` reddens three of the four, and
// INVERTING the flag-write/derive order in `noteModifierDown` reddens all four.
//
// **BUT IT DOES NOT REACH BLUR, AND THIS PARAGRAPH USED TO CLAIM IT REACHED
// EVERYTHING.** The momentary suite fires keydown and keyup only. The single test
// in the package that dispatches a `blur` at all is
// `tests/field-host-move.gpu.test.ts:835`, and it asserts `cancelMoveInFlight`
// and nothing else. Measured: making BOTH `releaseModifiers()` here and
// `releaseKeys()` in `field-camera-rig.ts` into no-ops is **2912 pass / 0 fail**.
// So the entire focus-loss path — a ⇧ released while focus is elsewhere leaving
// the brush stuck on smooth, a `W` released elsewhere leaving the camera flying —
// is UNPINNED in both clusters, and the third bullet above (`onBlur`'s
// simultaneous clear of both flags) is the one whose loss no test would report.
// Disclosed rather than fixed: adding that pin is a test, and this task's bar is
// that no existing pin changes.
//
// WHAT ELSE IS UNPINNED, measured at this extraction and NOT as first written
// (§2.8's lesson: a green run is not a covered path, and the draft of this
// paragraph guessed the opposite of what the probe found). Deleting the
// `rebuildSegmentPreview()` call inside `applyRadius` — the pending capsule's
// re-fatten, an F2b item with its own comment down there — is **fully green
// across all 2,912 tests**. Nothing anywhere reaches "change the radius while a
// segment anchor is pending and look at the preview". The wire is real and the
// argument for it is sound; it is simply unpinned, and a later change that drops
// it will not be caught here.
//
// THE SEAM IS FIFTEEN VERBS OVER FOURTEEN FUNCTIONS, and the two numbers are
// almost unrelated. SEVEN of the fourteen are private here — `sphereShape`,
// `toolMask`, `toolOp`, `strokeShape`, `notifyTool`, `deriveMomentary` and
// `toolPush` each have callers only inside this file. The other eight verbs are
// new surface for state the closure used to let its neighbours read directly:
// the radius accessor and its stepper, the tool patch, the two channel
// subscriptions, and the three modifier verbs above. (`applyRadius` is NOT one of
// the eight — it is one of the seven public members of the fourteen, the funnel
// `FieldHost.setDigRadius` has always called.) So this row lands on the
// third mechanism (`field-host-clusters.md` §2.8): a row's function count
// measures the CLUSTER, and its read-by column measures the SEAM.
//
// THE LAW, applied (`substrate.ts`'s doc header is the argument):
//   - `store`, `log` and `table` all ride the substrate — the first two by value
//     (`const` identities the host mutates through), `table` as a call, because
//     `setMaterialTable` replaces it wholesale.
//   - Every one of this module's own eight bindings moved. `digRadius` is the
//     one that had to be argued: it has THREE extracted readers
//     (`field-segment.ts`, `field-targeting.ts`, `field-render.ts`), which is
//     past T3a's two-reader bar for ADDING a `HostSubstrate` member. It is not a
//     substrate member and must not become one — the bar governs state the HOST
//     still owns and shares, and state that acquires an OWNER rides on that
//     owner's seam instead (`docs/reference/editor/field-host.md` "The deps-record
//     law"; `layers` and `sliceY`
//     had five reader clusters between them and became `viewState.layers()`).
//     All three thunks are now `tool.digRadius` and nothing inside those three
//     modules changed.
//   - Five of the eight deps are ARROWS over modules assembled BELOW the `tool`
//     assembly, and the ordering that forces them is stated at both ends. The
//     `segment` pair is a genuine two-way edge — this module hands over
//     `commitToolOp`, `reportToolError`, `armMaskDropReport` and `digRadius`, and
//     takes `rebuildPreview` back — broken the same way `field-props.ts`'s
//     `markPlacementsStale` breaks its own (an arrow body cannot run before the
//     declaration it names, because nothing in that closure executes before its
//     `return {`).
//
// NO UNIT TEST OF ITS OWN, on `field-machine.ts`'s argument at the top of
// `tests/field-host/field-machine.test.ts`: the host suites that already drive
// these paths ARE the contract, and they pass unmodified.
import * as field from "@furnace/core/field";
import { snappedKitBox } from "../shared/field-brush.ts";
import {
  DIG_RANGE_M,
  HOLLOW_MIN_M,
  RADIUS_MAX,
  RADIUS_MIN,
} from "../shared/field-limits.ts";
import type {
  FieldMaskChoice,
  FieldTool,
  FieldToolPush,
  ToolErrorSeverity,
} from "./field-host.ts";
import type { CursorRay } from "./field-targeting.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel } from "./view-channel.ts";

type Vec3T = [number, number, number];

/** One notch of the wheel, and one press of `[` / `]`, in metres of radius. Both
 *  reach it through {@link Tool.stepRadius}, so the two listeners hold no brush
 *  arithmetic of their own — they say which direction and how many notches. */
const RADIUS_WHEEL_STEP = 0.1;

const clampRadius = (r: number): number =>
  Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r));

const clampIntRange = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

// Default tool: dig/rock, unmasked, SMOOTH_DEFAULTS-equivalent literal (a
// fresh object per call — never an alias of core's shared SMOOTH_DEFAULTS).
function defaultTool(): FieldTool {
  return {
    effect: "dig",
    materialId: 0,
    mask: { kind: "none" },
    smooth: { ...field.SMOOTH_DEFAULTS },
    hollow: null,
  };
}

// Deep-enough copy so host state never aliases panel-held (or panel-handed)
// objects: mask + smooth are the only nested fields.
function cloneTool(t: FieldTool): FieldTool {
  return {
    effect: t.effect,
    materialId: t.materialId,
    mask: { ...t.mask },
    smooth: { ...t.smooth },
    hollow: t.hollow,
  };
}

// The chassis-side parameter clamp applied on every setTool (see the FieldHost
// TSDoc for why the chassis is the enforcement point).
function clampTool(t: FieldTool): FieldTool {
  const c = cloneTool(t);
  c.smooth.strength = clampIntRange(
    c.smooth.strength,
    1,
    field.SMOOTH_MAX_STRENGTH,
  );
  c.smooth.iterations = clampIntRange(
    c.smooth.iterations,
    1,
    field.SMOOTH_MAX_ITERATIONS,
  );
  if (c.hollow !== null) c.hollow = Math.max(HOLLOW_MIN_M, c.hollow);
  return c;
}

// On THIS side of the seam a weakened mask compare suppresses a PUBLISH rather than
// merely a re-render — the chrome is never told the brush changed — so the backstop below
// is load-bearing rather than tidy.
function sameMask(a: FieldMaskChoice, b: FieldMaskChoice): boolean {
  // Compiler backstop, the `toolsEqual`/`statsEqual` rider in the shape a UNION takes: the
  // tag compare covers every TAG-ONLY member, so what must not be forgotten is a member
  // carrying a payload BESIDE its tag. Switching on `a.kind` makes the compiler demand a
  // branch for each, and a new kind fails the never-check in `default` — where a bare
  // `a.kind === b.kind` would quietly call two different masks equal.
  switch (a.kind) {
    case "class":
      return b.kind === "class" && a.classId === b.classId;
    case "none":
    case "organic-only":
    case "kit-only":
    case "selection":
      return a.kind === b.kind;
    default: {
      const unhandled: never = a;
      return unhandled;
    }
  }
}

// Value-equality over every FieldTool field — `setTool`'s no-op guard, which is
// `applyRadius`'s `clamped === digRadius` one type up.
//
// A SECOND comparator rather than one shared with the chrome's `toolsEqual`
// (`frontend/lib/field-host-mirrors.ts`), which is the same predicate: the chrome may not
// take a VALUE edge to this file — the barrel carries core, and a second core in the chrome
// bundle is what `tests/frontend-no-engine-leakage.test.ts` exists to prevent. Both carry
// the destructure backstop below, so a new FieldTool field fails to compile in BOTH places
// rather than silently weakening either guard.
function sameTool(a: FieldTool, b: FieldTool): boolean {
  // Compiler backstop: a future FieldTool field lands in `rest` and fails the never-check,
  // forcing this comparator to learn it. A missed field would make two DIFFERENT tools
  // compare equal, and the guard below would then swallow a real change — a brush the user
  // picked that the chrome is never told about.
  const { effect, materialId, hollow, mask, smooth, ...rest } = a;
  void (rest satisfies Record<string, never>);
  // The same backstop one level down: `smooth` is a nested shape whose future fields would
  // slip past the top-level destructure unseen.
  const { strength, iterations, mode, ...smoothRest } = smooth;
  void (smoothRest satisfies Record<string, never>);
  return (
    effect === b.effect &&
    materialId === b.materialId &&
    hollow === b.hollow &&
    sameMask(mask, b.mask) &&
    strength === b.smooth.strength &&
    iterations === b.smooth.iterations &&
    mode === b.smooth.mode
  );
}

/** Which momentary override a key event is about. The host's key listeners name
 *  the DOM key (`"shift"`, `"control"`); this is the module's own vocabulary, so
 *  the translation happens once, in the listener that already knows about keys. */
export type MomentaryModifier = "shift" | "ctrl";

/** What the brush layer needs from the rest of the host.
 *
 *  **INVARIANT — five of these eight are ARROWS at the assembly, and FOUR of the
 *  five are forced.** `createTool` is assembled above the four modules it reads
 *  back out of, but not for one reason, and the difference matters to whoever
 *  moves one of them:
 *    - `createTargeting` and `createSegmentBrush` read this module DIRECTLY
 *      (`reportToolError` and `digRadius`, plus two more for the segment), so
 *      they are hard constraints and `cursorRay` / `computeTarget` /
 *      `rebuildSegmentPreview` must be arrows.
 *    - `createView` is forced TRANSITIVELY, not directly: it reads nothing of
 *      this module's, but it takes `discardVoidCast` / `requestVoidCast` off
 *      `createVoidCast`, which takes `reportToolError`. A real cycle, one hop
 *      longer than it looks — so `sliceOpts` is an arrow too.
 *    - **`notifyHistory` is a PREFERENCE, not a constraint.** `createHistoryFeed`
 *      reads nothing here; its only dep is `substrate`, ~1,070 lines above this
 *      assembly, so it could be hoisted and this dep would become a plain ref. It
 *      sits where it does by the where-the-functions-were convention — exactly
 *      the style choice the rest of this block is denying. Hoist it and this
 *      sentence becomes "four of these eight are arrows".
 *
 *  Nothing here may value-snapshot a host `let`: every member below is a call. */
export type ToolDeps = {
  /** The host's shared state. Three members are read: `store` and `log` (the op
   *  path), and `table()` (the resolved material table, which
   *  `setMaterialTable` replaces wholesale). */
  substrate: HostSubstrate;
  /** Mark the chunks an applied op touched, plus their 26 apron neighbours.
   *  `world`'s, and one of the TWO plain refs among the eight (the third
   *  non-arrow member is `substrate`, a value). Declared ~215 lines above the
   *  assembly; `currentSelectionSpec`, the other, is three lines above it and is
   *  what pins the assembly's position from ABOVE. */
  markDirtyWithNeighbors(changed: Set<string>): void;
  /** The host's current selection spec, for a selection-MASKED op. `selection`'s.
   *  Null = nothing selected, which is what makes {@link Tool.commitToolOp} drop
   *  the mask and report once per gesture.
   *
   *  The closure map records a `tool → selection` read edge of five sites here
   *  and it is a VERIFIED PHANTOM (§2.5) — `toolMask` reaches the selection
   *  through this call and names the binding nowhere. */
  currentSelectionSpec(): field.SelectionSpec | null;
  /** Push the named-history feed. `field-history-feed.ts`'s `notify`, reached
   *  through an arrow because that module is assembled ~650 lines below. The op
   *  path is the ONE log-mutating route that rewrites no entity record, so it
   *  cannot reach the feed through `notifyEntities`. */
  notifyHistory(): void;
  /** Cursor → world ray + the eye-in-rock probe (`field-targeting.ts`, arrow).
   *  The eyedropper's; a null ray is a miss and changes nothing. */
  cursorRay(clientX: number, clientY: number): CursorRay | null;
  /** The world-space BRUSH CENTRE under the cursor, under the dig-feel contract
   *  (`field-targeting.ts`, arrow). What a stroke applies at. */
  computeTarget(clientX: number, clientY: number): Vec3T | null;
  /** The active slice's raycast options (`field-view.ts`, arrow). The eyedropper
   *  samples the VISIBLE sliced surface, never hidden rock above the plane. */
  sliceOpts(): { maxY: number } | undefined;
  /** Re-fatten the pending segment capsule after a radius change
   *  (`field-segment.ts`, arrow). The return half of this module's one two-way
   *  module edge; the header argues why an arrow is the right break. */
  rebuildSegmentPreview(): void;
};

/** The armed brush and everything that moves it. Fifteen verbs; the seven private
 *  functions behind them are named in the header. */
export type Tool = {
  /** The brush/capsule radius in metres. Read by `field-segment.ts`,
   *  `field-targeting.ts` and `field-render.ts` — three extracted readers, and
   *  deliberately NOT a `HostSubstrate` member (see the header). */
  digRadius(): number;
  /** The ONE funnel for a radius change — the panel's slider (through
   *  `FieldHost.setDigRadius`), the wheel and `[` / `]` all land here. Clamps,
   *  no-op-guards, re-fattens the pending capsule and announces. */
  applyRadius(next: number): void;
  /** Move the radius by whole wheel notches, signed (away from the user =
   *  bigger). The wheel's brush binding and `[` / `]`, which hold no arithmetic
   *  of their own — the step size is this module's constant. */
  stepRadius(notches: number): void;
  /** `FieldHost.setTool`'s body: shallow-merge a patch over the held brush, or
   *  over the momentary BASE when a modifier is held. The branch order is the
   *  contract — see the header. */
  set(patch: Partial<FieldTool>): void;
  /** `FieldHost.subscribeTool`: the armed brush + its radius, with a snapshot on
   *  subscribe. */
  subscribe(cb: (push: FieldToolPush) => void): () => void;
  /** Report something the user should see: console (the developer trail) + the
   *  message channel. `error` by default because almost every caller has a
   *  refusal. The host's most-called seam member — NINE call sites in
   *  `field-host.ts`, and SIX other modules take it as a dep
   *  (`field-targeting.ts`, `field-segment.ts`, `field-voidcast.ts`,
   *  `field-analyzer.ts`, `field-machine.ts`, `field-camera-rig.ts`).
   *
   *  DE-PREFIXED on the seam, on `field-analyzer.ts`'s precedent one task
   *  earlier (`setFlagFilters` is `advisor.setFilters`): out there the noun is
   *  load-bearing and the facade keeps `subscribeToolError`, but a member of
   *  `tool` does not need the word twice. Four members below are the same act. */
  reportError(msg: string, severity?: ToolErrorSeverity): void;
  /** `FieldHost.subscribeToolError`: the user-facing message stream. No snapshot
   *  — a message is an event. */
  subscribeError(
    cb: (msg: string, severity: ToolErrorSeverity) => void,
  ): () => void;
  /** BUILD the op for a shape and apply it through the log, marking the touched
   *  chunks (+ apron neighbours) dirty. Shared by the plain stroke and
   *  `field-segment.ts`'s commit so both carry one failure contract. */
  commitOp(shape: field.BrushShape): void;
  /** Re-arm the once-per-gesture "selection mask but no selection" report. Two
   *  callers, both in other modules: the machine's stroke re-arms at pointer
   *  down, the segment brush at each commit. */
  armMaskDropReport(): void;
  /** Whether the active tool fills a KIT class — its ghost and its op use the
   *  snapped lattice box, not a sphere. Read by `field-render.ts`. */
  isKitFill(): boolean;
  /** Alt-click eyedropper: adopt the material class at the target voxel. */
  eyedropper(clientX: number, clientY: number): void;
  /** Apply the active tool at a cursor position — the plain stroke. */
  apply(clientX: number, clientY: number): void;
  /** A momentary modifier engaged. Repeat-guarded HERE, which is what stops a
   *  held key's auto-repeat from re-saving the derived tool as the base. */
  noteModifierDown(mod: MomentaryModifier): void;
  /** A momentary modifier released. Guarded the same way, and the derive is what
   *  restores the base once BOTH are up. */
  noteModifierUp(mod: MomentaryModifier): void;
  /** Focus loss: drop both modifiers at once. A key released while focus is
   *  elsewhere never keyups here, which would strand a momentary tool. */
  releaseModifiers(): void;
};

export function createTool(deps: ToolDeps): Tool {
  const { substrate } = deps;

  let tool: FieldTool = defaultTool();
  // Momentary tool overrides (Shift = smooth, Ctrl = dig↔fill invert). ONE
  // saved slot: the pre-momentary tool, saved when the FIRST modifier engages
  // and restored when BOTH are released. The effective tool is DERIVED, not
  // stacked — a pure function of (saved, shiftHeld, ctrlHeld), so any
  // press/release order restores the original tool (see deriveMomentary).
  let momentarySaved: FieldTool | null = null;
  let momentaryShift = false;
  let momentaryCtrl = false;
  let digRadius = 1.25;
  // Once-per-GESTURE guard for the "selection mask but no selection" report.
  // The gesture whose repeats need suppressing is the drag: a stroke re-arms
  // this at pointer-down, so one 40ms-throttled drag reports once. The segment
  // brush re-arms per COMMIT instead — its unit is the two-click pair, not a
  // drag, so sharing the stroke's re-arm point would silence every segment
  // after the first.
  let maskDropReported = false;

  // The chrome's mirror of the armed brush + its radius — a STATE seam like the other
  // ten, snapshot and all. It used to be an EVENT seam, and its comment used to say so:
  // "the mirror is an EVENT (a change the chrome did not make), and a subscriber that
  // wants the current tool has `setTool`'s own funnel". That funnel was the whole problem
  // — it made the chrome the only holder of a value the host owns, so a surface arriving
  // mid-session (the tool strip, which `TopBar` unmounts for the whole of every stamp
  // session) had nothing to read the current brush from.
  //
  // ONE payload builder for both directions: the snapshot an arriving subscriber gets and
  // the push `notifyTool` makes are the same value assembled the same way, so a field
  // added to FieldToolPush cannot reach one and miss the other.
  const toolPush = (): FieldToolPush => ({
    tool: cloneTool(tool),
    radius: digRadius,
  });
  const toolChannel = createViewChannel<[FieldToolPush]>({
    snapshot: () => [toolPush()],
  });
  // The user-facing message channel (the chrome's toast stack + message log).
  // No snapshot either — a message is an event, and re-pushing the last refusal
  // to a remounting toast stack would resurrect one the user dismissed.
  const toolErrorChannel = createViewChannel<[string, ToolErrorSeverity]>();

  // Announce the armed brush to the chrome (cloned — the chrome must never hold a
  // reference into host state). Every path that moves the tool or the radius ends here.
  const notifyTool = (): void => {
    toolChannel.publish(toolPush());
  };

  // Report something the user should see: console (developer trail, the F2a
  // behaviour kept) + the panel subscriber.
  //
  // `error` by default because every refusal is one, and a refusal is what almost
  // every caller here has. A caller passes `warn` only when nothing went wrong;
  // exactly one does today, the advisor-idle report.
  const reportToolError = (
    msg: string,
    severity: ToolErrorSeverity = "error",
  ): void => {
    console.warn(`field-host: ${msg}`);
    toolErrorChannel.publish(msg, severity);
  };

  // --- the op a stroke or a segment commits --------------------------------

  const sphereShape = (center: Vec3T, radius: number): field.BrushShape => ({
    kind: "sphere",
    center,
    radius,
  });

  // The active tool's mask choice as a core BrushMask (undefined = unmasked).
  // The organic/kit/class choices are structurally the core mask variants; the
  // selection choice embeds the current selection spec.
  const toolMask = (): field.BrushMask | undefined => {
    const m = tool.mask;
    if (m.kind === "none") return undefined;
    if (m.kind === "selection") {
      const spec = deps.currentSelectionSpec();
      if (spec === null) {
        if (!maskDropReported) {
          maskDropReported = true;
          reportToolError(
            "selection mask active but there is no selection — stroke applies unmasked",
          );
        }
        return undefined;
      }
      return { kind: "selection", selection: spec };
    }
    return m;
  };

  // Build the brush op for the active tool over a caller-chosen SHAPE. The
  // shape is a parameter because two gestures build different ones from the
  // same tool: a plain stroke sweeps nothing (sphere, or the snapped lattice
  // box for a kit fill — see strokeShape), the segment brush hands in a
  // capsule. Everything else — effect, material, mask, the fill's `hollow` —
  // is the tool's and identical either way. Dig and smooth stay material-free.
  //
  // The kit question is asked ONCE, through isKitFillTool, and the answer is
  // shared with strokeShape: this used to re-derive it with a bare `classOf`,
  // which throws on an unknown id where isKitFillTool returns false — so the
  // two disagreed on exactly the input that made one of them throw.
  const toolOp = (shape: field.BrushShape): field.BrushOp => {
    const mask = toolMask();
    const base = {
      id: 0,
      kind: "brush",
      shape,
      ...(mask !== undefined && { mask }),
    } as const;
    if (tool.effect === "dig") return { ...base, effect: "dig" };
    if (tool.effect === "smooth")
      return { ...base, effect: "smooth", smooth: { ...tool.smooth } };
    const kitFill = isKitFillTool();
    // Kit-class hollow snaps to the 0.5 m lattice (floored) — core REJECTS
    // non-multiples (the shell's inner faces must land on lattice planes).
    const hollow =
      tool.effect === "fill" && tool.hollow !== null
        ? kitFill
          ? Math.max(
              HOLLOW_MIN_M,
              Math.round(tool.hollow / HOLLOW_MIN_M) * HOLLOW_MIN_M,
            )
          : tool.hollow
        : null;
    return {
      ...base,
      effect: tool.effect,
      material: tool.materialId,
      ...(hollow !== null && { hollow }),
    };
  };

  // The shape a plain (non-segment) stroke applies at a world centre: the
  // snapped lattice box when the tool is a kit fill, else the brush sphere.
  const strokeShape = (center: Vec3T): field.BrushShape =>
    isKitFillTool()
      ? snappedKitBox(center, digRadius)
      : sphereShape(center, digRadius);

  // BUILD the op for a shape and apply it through the log, marking the touched
  // chunks (+ apron neighbours) dirty. Shared by the stroke and the segment
  // commit so both carry the same failure contract: every setup-loud throw on
  // the path — a kit fill off the lattice, a kit class under a non-box shape
  // (reachable ONLY through the segment gesture), an unknown material class —
  // is reported to the panel and the op DROPPED, rather than escaping the
  // pointer handler. Reported per occurrence (each becomes its own message in
  // the chrome); only the mask-drop report is once-per-gesture.
  //
  // toolOp is called INSIDE the try deliberately, though as of this commit it
  // is TOTAL — its one throwing call became isKitFillTool, which swallows
  // classOf's unknown-id throw. So this placement is defence in depth, not a
  // live fix, and no test can currently tell the two apart (verified by
  // sabotage: hoisting the build above the try breaks nothing). What it
  // defends is real: a caller writing `commitToolOp(toolOp(shape))` evaluates
  // the build BEFORE this function is entered, so any future build-time throw
  // would escape the catch, back out through the machine's `pointerDown`, and
  // skip the `capturePointer` on the line after it — stranding that chain's
  // `digging === true` with no capture, so a pointerup outside the canvas latches
  // the stroke on. Both the flag and the capture call live in
  // `field-machine.ts`; the failure mode does not, because it is about the
  // ORDER of two statements this function can still throw between.
  const commitToolOp = (shape: field.BrushShape): void => {
    try {
      deps.markDirtyWithNeighbors(
        field.logApply(
          substrate.store,
          substrate.log,
          toolOp(shape),
          substrate.table(),
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(`tool apply failed: ${message}`);
    }
    // The ONE log-mutating path that rewrites no entity record, so it is the one
    // that cannot reach the history feed through `notifyEntities` (see there).
    // OUTSIDE the try: a refused op leaves the log untouched and the push is a
    // guarded no-op, and putting it in the `catch` as well would be two spellings
    // of one call.
    deps.notifyHistory();
  };

  // Whether the active tool fills a kit class — its ghost + op use the snapped
  // lattice box, not a sphere. Guards classOf's unknown-id throw (setup-loud) so
  // the per-frame ghost can't crash on a stray selection; returns false instead.
  const isKitFillTool = (): boolean => {
    if (tool.effect !== "fill") return false;
    try {
      return field.classOf(substrate.table(), tool.materialId).kind === "kit";
    } catch {
      return false;
    }
  };

  // Alt-click eyedropper: read the material class at the TARGET voxel — the
  // SOLID voxel the cursor ray hits (raycastField's `voxel`, never the pre-hit
  // air voxel), or the eye's own voxel when embedded in rock — into the active
  // tool. A miss (open air to max range) changes nothing. Never strokes.
  const eyedropper = (clientX: number, clientY: number): void => {
    const ray = deps.cursorRay(clientX, clientY);
    if (!ray) return;
    const cs = substrate.store.cellSize;
    let voxel: [number, number, number];
    if (ray.eyeInRock) {
      voxel = [
        field.worldToVoxel(ray.origin[0], cs),
        field.worldToVoxel(ray.origin[1], cs),
        field.worldToVoxel(ray.origin[2], cs),
      ];
    } else {
      // Slice-coherent (sliceOpts): sample the class at the VISIBLE sliced
      // surface, never at hidden rock above the plane.
      const rc = field.raycastField(
        substrate.store,
        ray.origin,
        ray.dir,
        DIG_RANGE_M,
        deps.sliceOpts(),
      );
      if (!rc) return;
      voxel = rc.voxel;
    }
    const id = field.getMaterial(substrate.store, voxel[0], voxel[1], voxel[2]);
    // Paint is organic-only: the swatch strip disables kit classes while
    // paint is armed (a kit materialId arms a stroke core rejects every
    // time) — mirror that rule here, so a kit-cell Alt-click under paint
    // adopts nothing, like a miss. Guarded lookup, not classOf: an id
    // missing from the table keeps the pre-existing adopt-as-is behaviour
    // (the stroke path owns that setup-loud throw).
    if (
      tool.effect === "paint" &&
      substrate.table().classes.find((c) => c.id === id)?.kind === "kit"
    )
      return;
    if (id === tool.materialId) return;
    // Immutable replacement (never in-place mutation) so the effective tool
    // can't alias the momentary-saved slot; the saved base picks up the same
    // material so a later momentary release keeps the eyedropped class.
    tool = { ...tool, materialId: id };
    if (momentarySaved !== null)
      momentarySaved = { ...momentarySaved, materialId: id };
    notifyTool();
  };

  // Apply the active tool at a cursor position: compute the dig-feel centre,
  // build the op, and commit it through the shared failure contract.
  const applyTool = (clientX: number, clientY: number): void => {
    const at = deps.computeTarget(clientX, clientY);
    if (!at) return;
    commitToolOp(strokeShape(at));
  };

  // --- the radius ----------------------------------------------------------

  // The ONE funnel for a radius change — the panel's slider, the wheel and
  // `[` / `]` all land here. Clamped once, and the pending capsule re-fattens
  // with it (f2b item 9): three call sites each remembering to refresh is how
  // one of them would come to forget.
  const applyRadius = (next: number): void => {
    const clamped = clampRadius(next);
    if (clamped === digRadius) return;
    digRadius = clamped;
    deps.rebuildSegmentPreview();
    // MIRROR IT (F4.5 holistic gate, W-2). The wheel and `[` / `]` reach the radius
    // without going through the chrome, so before this the strip readout kept the
    // last number the chrome itself had set and drifted from the brush the viewport
    // was drawing. Pushing HERE rather than at the three call sites is the same
    // argument the clamp above already makes: this is the one funnel, so a fourth
    // way to change the radius cannot forget to announce it.
    //
    // WHAT THE EARLY RETURN ABOVE DOES AND DOES NOT DO, measured rather than assumed:
    // it suppresses a NO-OP set only. A chrome slider drag changes the value every step,
    // so every step DOES round-trip (measured: a four-step drag pushes 1.3, 1.35, 1.4,
    // 1.45). That is harmless for a different reason — `useFieldHostState` adopts the
    // pushed number with a plain `setState`, and React bails out on an identical value,
    // so the drag's own echo costs no render.
    //
    // The CLAMP not looping IS this guard's work: a set outside the range pushes once at
    // the boundary, and the next out-of-range set finds the boundary already current and
    // returns (measured: [4, 0.25], then silence).
    notifyTool();
  };

  // --- momentary tool overrides --------------------------------------------

  // Recompute the effective tool from (saved base, held modifiers). DERIVED,
  // not stacked: Shift (momentary smooth) wins over Ctrl (dig↔fill invert),
  // and Ctrl inverts only dig/fill (paint/smooth pass through). Because the
  // result is a pure function of the base + the two flags, any press/release
  // interleaving restores the ORIGINAL tool once both are released.
  // macOS caveat: Ctrl+CLICK is synthesized as a right-click (button 2), so a
  // fresh Ctrl+LMB press starts a look there — the invert still applies to a
  // stroke already in progress (LMB down, then hold Ctrl) and on Win/Linux.
  const deriveMomentary = (): void => {
    if (!momentaryShift && !momentaryCtrl) {
      if (momentarySaved === null) return;
      tool = momentarySaved;
      momentarySaved = null;
      notifyTool();
      return;
    }
    if (momentarySaved === null) momentarySaved = tool;
    let effect = momentarySaved.effect;
    if (momentaryCtrl && effect === "dig") effect = "fill";
    else if (momentaryCtrl && effect === "fill") effect = "dig";
    if (momentaryShift) effect = "smooth";
    tool = { ...momentarySaved, effect };
    notifyTool();
  };

  return {
    digRadius: () => digRadius,
    applyRadius,
    // The two listeners' whole share of the brush arithmetic: which direction,
    // how many notches. `-Math.sign(deltaY)` and the `]`-is-up mapping stay with
    // the events they are facts about.
    stepRadius(notches) {
      applyRadius(digRadius + notches * RADIUS_WHEEL_STEP);
    },
    set(patch) {
      if (momentarySaved !== null) {
        // A change while a momentary modifier is held lands on the BASE the
        // momentary derives from (and restores to), so releasing the modifier
        // lands on the caller's latest choice rather than a stale save.
        //
        // The patch merges over `momentarySaved`, NOT over `tool` — `tool` is the
        // DERIVED brush right now, and merging over it would feed the derive's own
        // `effect` back into the base on every set. That is the whole defect the
        // patch seam closes: a param nudge names its param and nothing else, so
        // the base keeps the effect the user actually picked, while a deliberate
        // pick names `effect` and is adopted. Both reach this one line.
        //
        // ABOVE the value guard, deliberately (the guard sits below this branch):
        // a set that equals the DERIVED tool can still be a real change to the
        // base the release will land on — picking smooth under a held ⇧ is exactly
        // that, and comparing the derived tool here would drop it and let go of ⇧
        // restore the wrong brush.
        momentarySaved = clampTool({ ...momentarySaved, ...patch });
        deriveMomentary();
        return;
      }
      const clamped = clampTool({ ...tool, ...patch }); // chassis-side range enforcement
      if (sameTool(tool, clamped)) return; // applyRadius' `clamped === digRadius`, one type up
      tool = clamped;
      notifyTool();
    },
    subscribe(cb) {
      return toolChannel.subscribe(cb);
    },
    reportError: reportToolError,
    subscribeError(cb) {
      return toolErrorChannel.subscribe(cb);
    },
    commitOp: commitToolOp,
    // The ONE re-arm, handed to BOTH brushes that own a gesture-length report: the
    // sphere stroke re-arms it at pointer-down (the machine's chain) and the
    // segment brush at each commit (`field-segment.ts`). One verb rather than
    // two inline arrows over one `let` — two spellings of a one-line write is
    // how a third acquires a subtly different one.
    armMaskDropReport() {
      maskDropReported = false;
    },
    isKitFill: isKitFillTool,
    eyedropper,
    apply: applyTool,
    // The three momentary verbs the host's key listeners call. Each carries the
    // guard the listener used to hold, and each writes the flag BEFORE deriving —
    // the order the momentary suite reaches through the real handlers.
    noteModifierDown(mod) {
      if (mod === "shift") {
        if (momentaryShift) return;
        momentaryShift = true;
      } else {
        if (momentaryCtrl) return;
        momentaryCtrl = true;
      }
      deriveMomentary();
    },
    noteModifierUp(mod) {
      if (mod === "shift") {
        if (!momentaryShift) return;
        momentaryShift = false;
      } else {
        if (!momentaryCtrl) return;
        momentaryCtrl = false;
      }
      deriveMomentary();
    },
    releaseModifiers() {
      if (!momentaryShift && !momentaryCtrl) return;
      momentaryShift = false;
      momentaryCtrl = false;
      deriveMomentary();
    },
  };
}
