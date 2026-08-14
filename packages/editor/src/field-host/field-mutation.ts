// THE MUTATION SEAM — how a caller that WROTE a change gets it into the field.
//
// Foundations T4c, and the counterpart to `field-capture.ts`: that module gave the agent
// eyes, this one gives it hands. Both exist because the interactive path cannot serve a
// caller with no pointer, and both are compositions of seams the host already had rather
// than new machinery underneath them.
//
// THE FAILURE POSTURE IS THE WHOLE DESIGN, and it is the OPPOSITE of the one three metres
// away in `field-tool.ts`. `commitToolOp` wraps its `logApply` in a try/catch and turns
// every setup-loud throw into a `reportToolError` — the op is DROPPED and the failure never
// escapes the pointer handler. That is right for a pointer drag for a reason that does not
// generalise: a human is watching, the toast reaches them, and a throw out of `pointerdown`
// would strand the gesture mid-capture (that function's own comment works the mechanism
// through). None of it holds here. A caller that composed a list of ops is not looking at
// the screen, a toast is a sentence written for somebody else, and the thing it needs is the
// verdict — so every refusal on this seam is RETURNED, typed, and never spoken. That is the
// T4b ruling carried forward: an agent-caused refusal is not toasted, because the human in
// the tab did not ask for anything and has nothing to do about it.
//
// WHY IT SPEAKS `action-registry`'s VOCABULARY, which is a layer edge worth stating rather
// than discovering. `ActionResult`/`RefusalClass` live in `src/action-registry/result.ts`,
// which sat BESIDE this directory under the chrome until this commit and sits BENEATH it
// now; `tests/no-chrome-leakage.test.ts` bans the arrow the other way and, since this
// commit, asserts THIS one deliberately — field-host may hold the refusal vocabulary and
// nothing else from that directory. The two were SIBLINGS while neither imported the other;
// they are a chain now, and both halves are pinned. The alternative was a host-local result type converted in the chrome verb, and
// `result.ts`'s own header rules it out in advance: there is ONE vocabulary of refusal in
// this editor, and a second name for a subset of it is a second thing to keep in step. The
// import is `./result.ts` DIRECTLY rather than the barrel, so `action-registry/schemas.ts`'s
// zod never becomes reachable from anything the host pulls in.
import * as field from "@furnace/core/field";
import {
  ACTION_OK,
  type ActionResult,
  failed,
  refused,
} from "../action-registry/result.ts";
import type { BrushOpInput } from "../shared/field-op.ts";
import type { StampRegion, StampSession } from "./field-stamp.ts";
import type { HostSubstrate } from "./substrate.ts";

type Vec3T = [number, number, number];
type Box = { min: Vec3T; max: Vec3T };

/** What the mutation seam needs from the rest of the host.
 *
 *  THE FIRST TWO ARE THE VISIBILITY LINES, and they are the reason this is a module rather
 *  than two calls inlined at the facade. `field-tool.ts`'s `commitToolOp` pairs every
 *  `logApply` with exactly these — `markDirtyWithNeighbors` so the touched chunks (plus the
 *  apron neighbours a surface extraction needs) re-mesh, and `notifyHistory` because a
 *  log-mutating path that rewrites no entity record is the one path that cannot reach the
 *  history feed through `notifyEntities`. A write that skipped either would land in the
 *  store and be invisible: no remesh, no history row, a screen that disagrees with the
 *  field. Copying the pair is what makes an agent's edit and a human's edit the same event
 *  to every surface downstream. */
export type MutationDeps = {
  substrate: HostSubstrate;
  /** Re-mesh what an op touched, apron included (`field-world.ts`'s). */
  markDirtyWithNeighbors(changed: Set<string>): void;
  /** Publish the named history — see this record's own note for why it is not optional. */
  notifyHistory(): void;
  /** "The entity list may have changed" — `generate` commits one, so it fires. */
  notifyEntities(): void;
  /** A committed generator's placements are new prop-layer content. */
  rebuildProps(): void;
  /** The live stamp/reconfigure/move session, or null. Both verbs refuse under one. */
  session(): StampSession | null;
  /** The current cell selection's metre AABB, or null — `generate`'s region default. */
  selectionRegion(): { aabb: Box; truncated: boolean } | null;
  /** A fresh stamp seed (`field-machine.ts`'s `randomStampSeed`, threaded like
   *  `field-entities.ts` threads it — this module imports no RNG of its own). */
  randomSeed(): number;
};

/** What a caller asks `generate` for. Everything but the generator id is optional and every
 *  default is READ from something that already exists — see {@link Mutation.generate}. */
export type GenerateRequest = {
  generatorId: string;
  params?: Record<string, unknown>;
  seed?: number;
  region?: StampRegion;
};

/**
 * What a commit ANSWERS WITH — the committed record, read back, plus how much it moved.
 *
 * A SEPARATE TYPE RATHER THAN A WIDENED {@link ActionResult}, and the obvious "fix" someone
 * will propose later is exactly the thing this paragraph exists to refuse. `ActionResult`'s
 * `ok` arm is `ACTION_OK` — a shared frozen singleton with no payload — and that is load-
 * bearing rather than incidental: it is returned by most of a 39-row table, and giving it a
 * payload would make every one of those rows either carry a meaningless field or stop
 * sharing the value. So the refusal half is reused verbatim (`Extract` below, one
 * vocabulary) and only the SUCCESS half is this seam's own. Which is also the honest shape:
 * the two halves answer different questions, and only one of them has anything to say.
 *
 * EVERY FIELD IS READ BACK OFF THE COMMITTED RECORD, never echoed from the request, and that
 * is what "drift-free" means here. A caller that omitted `seed` gets the seed that was
 * rolled; one that omitted `region` gets the region that was used; one that passed params
 * gets the params core actually recorded after its own validation and cloning. An echo would
 * confirm the REQUEST — which the caller already has — and would quietly lie the moment any
 * default, clamp or clone changed a value on the way through.
 */
export type GenerateOutcome =
  | {
      readonly ok: true;
      readonly entityId: number;
      readonly generator: string;
      readonly seed: number;
      readonly region: StampRegion;
      readonly params: Record<string, unknown>;
      /** How many chunks the commit dirtied. Zero is legitimate and worth being able to
       *  see: a placements-only generator (a scatter) writes no cells at all. */
      readonly dirtyChunks: number;
    }
  | Extract<ActionResult, { ok: false }>;

/** The two verbs a caller that cannot point gets to mutate with.
 *
 *  BOTH TAKE A TRAILING `origin`, and it is the same parameter core's committing paths
 *  take: who is authoring THIS call, stamped durably on the ops and volatilely on the undo
 *  entry. Omitted for the human's own work — absent means human, and the editor's only
 *  writer of a non-absent value is the session-answerer seam
 *  (`frontend/lib/session-answerers.ts`'s `AGENT_ORIGIN`). */
export type Mutation = {
  applyOps(ops: readonly BrushOpInput[], origin?: string): ActionResult;
  generate(req: GenerateRequest, origin?: string): GenerateOutcome;
};

/** A throw's own sentence, however it was thrown. The third occurrence is what earns it —
 *  the two verbs below raise four of these between them. */
const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Did `logApplyGroup` reject this list in PASS 1 — before it wrote anything?
 *
 * **THE DISCRIMINATOR IS STRUCTURAL, NOT PROSE**, which is what makes it usable at all: an
 * earlier version of this seam claimed the two cases "cannot be told apart" and classed
 * every throw as the caller's fault. That claim was false, and the code it cited disproves
 * it. `logApplyGroup` wraps a pass-1 rejection in its own `Error` **with `cause` set to the
 * predicate's original** (`core/src/field/ops.ts`, the one and only `{ cause: … }` in that
 * file — verified by grep, not by memory). A pass-2 applier throw propagates RAW: no wrapper,
 * no `cause`. So `cause !== undefined` IS "validation refused this before touching the
 * store", and nothing here has to read a message to know it.
 *
 * WHY IT MATTERS ENOUGH TO CHECK. The two cases have opposite answers to the only question a
 * caller actually has — *did the world move?* Pass 1 is genuinely all-or-nothing, so the
 * answer is no and `"input"` (*"the ARGUMENT was wrong, and the world is fine"*) is exactly
 * true. Pass 2 leaves every earlier op's writes in the store with no entry describing them,
 * so the world DID move; telling that caller its argument was wrong and the world is fine is
 * two false claims in one word.
 *
 * WHAT IT DOES NOT PROVE, stated because a guard trusted past its evidence is worse than
 * none: it identifies where the throw came from, not whether the store is clean. Those
 * coincide today because pass 1 writes nothing — if core ever gave a pass-2 throw a `cause`,
 * this would silently misread it. That is a change to a function whose contract this file
 * quotes, so it would not pass unnoticed; the pin is `tests/field-host/mutation.test.ts`.
 */
const isValidationRejection = (err: unknown): boolean =>
  err instanceof Error && err.cause !== undefined;

/** What a caller is told when the applier died mid-list. The residue is core's and declared
 *  (see {@link Mutation.applyOps}); what belongs in the SENTENCE is the part a caller cannot
 *  find out any other way — that the world moved, and that the cells it moved are not in any
 *  mesh. Prefixed rather than replacing core's own message, which names what actually blew
 *  up. */
const strandedNote =
  " — the ops before it are WRITTEN to the field with no undo entry and no remesh (this seam does not roll back; see the oplog-group-apply backlog entry). Reload the world, or re-dig over the affected region, before trusting what is on screen.";

/** The sentence both verbs refuse a live session with. ONE spelling, because the two
 *  refusals are one rule and a reader meeting either should not have to wonder whether the
 *  other means something slightly different. */
const SESSION_REFUSAL =
  "a stamp session is open in this editor — its ghost was computed against the field as it is now, so a write underneath it would leave the human steering a preview that no longer describes what committing would do. Apply or cancel the session first (session.confirm / session.escape)";

export function createMutation(deps: MutationDeps): Mutation {
  const { substrate } = deps;

  /**
   * WHY BOTH VERBS REFUSE UNDER A LIVE SESSION, argued once and pointed at twice.
   *
   * A session holds a GHOST: `field-machine.ts`'s `previewStamp` evaluates the generator
   * against the store as it stands and draws the result, and `commitStampSession` then
   * commits from those same inputs — the ghost is not an approximation, it IS what will
   * land, on the charter's determinism contract. That equality has one documented
   * exception, and it is precisely a store that moved underneath the preview. The
   * interactive path cannot reach it by hand (D-7 suspends the brush for the whole of a
   * session), so the only way to produce it is a write that does not come from the pointer
   * — which is this module.
   *
   * THE TWO VERBS ARE TREATED THE SAME BECAUSE THE MECHANISM DOES NOT DISTINGUISH THEM,
   * which was worth checking rather than assuming: `logApplyGroup` writes cells and
   * `commitGenerator` writes cells, and the ghost was computed from those same cells. A
   * `generate` under a live session desynchronises the human's preview exactly as an
   * `applyOps` does. `generate` then has a second reason of its own — it commits an entity
   * and fires `notifyEntities`, so a human mid-session would watch the entity list gain a
   * row they did not make while their own commit is still pending — but the shared reason
   * is sufficient on its own, which is why the sentence is shared too.
   *
   * A PENDING STAMP IS NOT A SESSION and deliberately does not refuse. `pendingStamp` is a
   * generator ARMED for region-draw: no evaluate has run, there is no ghost, and nothing
   * has been computed against the store that a write could invalidate. Refusing it would
   * cost an agent a verb for a state with no defect in it.
   *
   * TYPED AS THE ARM IT IS, not as the whole `ActionResult`, which is `result.ts`'s own
   * rule for its three constructors read one layer up. `generate` answers a
   * {@link GenerateOutcome}, whose success half is NOT `ActionResult`'s — so a guard
   * declaring it might return `{ok: true}` would not compile at that call site even though
   * it can never do so. Narrowing here is what lets one guard serve both verbs.
   */
  const refuseUnderSession = (): Extract<ActionResult, { ok: false }> | null =>
    deps.session() === null ? null : refused(SESSION_REFUSAL, "session");

  return {
    /**
     * Apply a batch of ops as ONE undo entry — the named stroke.
     *
     * `field.logApplyGroup` is the whole of the write, and it was built for this caller
     * before this caller existed: it validates the WHOLE list before any store write,
     * stamps ids on COPIES from the log's own counter, pushes exactly ONE undo entry, and
     * returns the union of dirty chunk keys. The single entry is the guardrail the batched
     * shape exists for — an agent's batch is one ⌘Z for the human, however many ops it
     * held.
     *
     * THE REFUSAL CARRIES CORE'S OWN LOCATOR. `logApplyGroup` rejects with
     * `field op group: ops[2] — <the predicate's message>`, the INDEX into the list as
     * passed in, first failure winning — and that sentence becomes the refusal's message
     * unchanged. Rewording it here would lose the one address a caller can act on: the ops
     * carry no ids yet (pass 2 mints them), so the list position is the only thing that
     * names the record to fix.
     *
     * `"input"` IS THE CLASS FOR ALL OF IT. Every rejection this seam can raise is about
     * the ops that were handed over — a shape number that is not finite, a length that is
     * not positive, a kit class under a non-box shape, an unknown material — and none of
     * them is fixed by changing the editor's state. That is the distinction the class was
     * split from `inert` to carry.
     *
     * WHAT THIS DOES NOT BUY IS A TRANSACTION, and the residue is core's, declared rather
     * than fixed. `logApplyGroup`'s all-or-nothing guarantee covers VALIDATION only:
     * `assertOpValid` checks that a shape's numbers are finite and its lengths positive,
     * never that a length is BUILDABLE, so a finite-but-absurd radius clears pass 1 and
     * dies in the APPLIER — leaving the earlier ops' writes sitting in the store with no
     * entry describing them. The log's id space stays gapless across that failure (ids
     * commit only once the apply pass finishes) and the store is NOT rolled back. Building
     * pass-2 rollback is out of scope by ruling, not by oversight —
     * `docs/backlog/engine-architecture/oplog-group-apply-is-not-a-transaction.md` holds
     * the shape a fix would take.
     *
     * SO THE TWO CASES ARE ANSWERED DIFFERENTLY, and telling them apart is the difference
     * between a true answer and a false one. A pass-1 rejection is `refused(…, "input")` —
     * nothing moved, fix the op. A pass-2 applier throw is `failed(…)`, because it is not
     * the caller's argument that broke and the world is NOT fine: `failed` is the arm that
     * carries an error a layer below raised without claiming anything about whose fault it
     * was. Its MESSAGE carries what a caller cannot discover any other way — that the ops
     * before the failure are written, unrecorded and UNMESHED. {@link isValidationRejection}
     * is the discriminator and carries why it is sound. An earlier version of this seam
     * lumped both onto `"input"` under a docblock claiming they could not be told apart;
     * that claim was false and it made this verb lie in exactly the case that matters most.
     *
     * AN EMPTY LIST IS A NO-OP answering `ok`, which is core's contract passed through
     * unchanged: no entry is pushed and the redo stack survives, because a phantom history
     * step would cost a real one. The agent door refuses an empty batch one layer up, where
     * a schema can ADVERTISE the rule (`daemon/op-schema.ts`) rather than leaving it to be
     * discovered.
     *
     * `origin` IS THE CALLER'S, NOT THE OPS', and the asymmetry is core's contract read
     * from here: one gesture has one author, so the single value stamps every op in the
     * group plus the one entry they share. An `origin` a caller had already written onto
     * an op it handed over is OVERWRITTEN — a batch is authored by whoever applies it.
     */
    applyOps(ops, origin) {
      const busy = refuseUnderSession();
      if (busy !== null) return busy;
      let dirty: Set<field.ChunkKey>;
      try {
        dirty = field.logApplyGroup(
          substrate.store,
          substrate.log,
          // The id is a PLACEHOLDER and core says so: pass 2 stamps the real one onto a
          // copy. Spelled `0` rather than an index because a caller reading a rejected
          // op's id back would be reading a number this line invented.
          ops.map((op) => ({ ...op, id: 0 })),
          substrate.table(),
          // Passed straight through, `undefined` included: core reads it as a value and
          // branches, so the conditional-spread rule that governs the OP literal does not
          // reach a positional argument. Absent = human, and that is what a chrome-side
          // caller passing nothing produces.
          origin,
        );
      } catch (err) {
        return isValidationRejection(err)
          ? refused(messageOf(err), "input")
          : failed(`${messageOf(err)}${strandedNote}`);
      }
      deps.markDirtyWithNeighbors(dirty);
      // The pair `commitToolOp` keeps, for its reasons — this is the one log-mutating path
      // that rewrites no entity record, so it cannot reach the history feed any other way.
      deps.notifyHistory();
      return ACTION_OK;
    },

    /**
     * Commit a generator in ONE act — no session opened, none left behind.
     *
     * THE ATOMICITY IS THE POINT AND IT IS ABOUT THE SESSION, not about the store.
     * `startStamp` is the interactive route and it OPENS a session — on the current
     * selection, or, with nothing selected, by arming region-draw and waiting for two
     * clicks that will never come from a caller with no pointer. Worse than useless: a
     * session left standing is a refusal generator for everything after it, because
     * `world.bake` requires `ctx.session === null` and the family keys refuse while one
     * owns the interaction. So this verb goes straight to `field.commitGenerator`, which is
     * what `commitStampSession` calls at the END of the interactive path, and touches the
     * session machinery not at all — there is no state for it to leak because it opens
     * none.
     *
     * EVERY DEFAULT IS READ, NEVER INVENTED, which is one rule applied three times:
     *
     *  - `params` — the generator def's own `defaults`, shallow-overlaid with whatever the
     *    caller named. Those defaults are core's, projected from the same zod shape that
     *    validates the commit (`field/registry.ts`'s `defineGenerator`), so a caller naming
     *    nothing gets exactly what the stamp form would have opened with. Overlaid rather
     *    than replaced so naming ONE param does not silently blank the rest.
     *  - `seed` — the caller's, else a fresh roll. Read back in the outcome either way,
     *    which is what makes a generated world reproducible by a caller that never named
     *    one.
     *  - `region` — the caller's, else the CURRENT SELECTION's box. There is deliberately
     *    no third answer: with neither, this refuses. `startStamp` has no third answer
     *    either (it asks the human to draw one), and the alternative here would be a box
     *    invented around the origin — a silent guess at the one input that decides where
     *    the world changes, which is the class of default that produces a confident commit
     *    in the wrong place. Setup-loud beats a guess.
     *
     * NO `policy` PARAMETER. `replace` is what `duplicate` and `openEntity` both fall back
     * to, for the reason `field-entities.ts` records — `GeneratorEntity` does not record the
     * policy its commit used, so it is not recoverable anyway — and a merge policy is a
     * refinement to add when a caller asks for one rather than a knob to ship untested.
     *
     * IT DOES NOT PRE-CHECK FOR AN EMPTY RESULT the way the interactive path does.
     * `reportEmptyPreview` exists because a human tuning a scatter to zero props deserves
     * advice ("widen the region, raise density") rather than core's hard failure, and it
     * reads a SETTLED PREVIEW — which this verb, having no session, does not have. Core's
     * own rejection is returned instead, and for a caller that composes rather than tunes it
     * is the better sentence: it names the generator and says the result was empty.
     *
     * `origin` reaches `commitGenerator`'s opts and stamps the WHOLE authored span — the
     * evaluated field ops, the placement op, the `entity` op recording the recipe — plus
     * the commit's undo entry. A generator does not author its own output; the caller that
     * commits it does, which is core's own wording and the reason an `origin` already
     * sitting on an evaluated op is overwritten.
     */
    generate(req, origin) {
      const busy = refuseUnderSession();
      if (busy !== null) return busy;
      let def: field.GeneratorDef;
      try {
        def = field.generatorById(req.generatorId); // setup-loud on unknown ids
      } catch (err) {
        // Resolved FIRST and refused as `"input"`: an id no registry carries is a fact
        // about the request, and it must not reach `commitGenerator` where the same
        // message would arrive wrapped in a commit failure (`entities.duplicate`'s stance).
        // ONE of the two causes this verb can attribute with certainty — the catch below
        // carries why the rest cannot be.
        return refused(messageOf(err), "input");
      }
      const region = req.region ?? selectionBox(deps.selectionRegion());
      if (region === null)
        return refused(
          `${req.generatorId} needs a region — name one, or select cells first (there is no default place to put a generator)`,
          "input",
        );
      let committed: {
        dirty: Set<field.ChunkKey>;
        entity: field.GeneratorEntity;
      };
      try {
        committed = field.commitGenerator(substrate.store, substrate.log, def, {
          // `commitGenerator` deep-clones for provenance, so this record is never aliased
          // by the log; the spread is only to overlay the caller's half onto the def's.
          params: { ...def.defaults, ...req.params },
          seed: req.seed ?? deps.randomSeed(),
          region,
          policy: "replace",
          table: substrate.table(),
          // A MEMBER OF THE OPTS RATHER THAN A TRAILING ARGUMENT, which is core's shape for
          // this verb and not a second spelling of the rule: `commitGenerator` reads
          // `opts.origin` into a local and branches on `undefined`, exactly as the
          // positional form does, so writing it here unconditionally is safe. What must
          // never be written unconditionally is `origin` onto an OP or an ENTRY, and core
          // owns both of those.
          origin,
        });
      } catch (err) {
        // `failed`, NOT `refused(…, "input")`, and the reason is that this catch covers a
        // set whose members disagree about whose fault they are. `commitGenerator` reaches
        // `def.evaluate` — ARBITRARY generator code — so the throws behind it are at least
        // three different things: the def's own param rejection (the caller's argument), an
        // `emits` contradiction or an invalid op in the evaluated span (a defect in the
        // GENERATOR DEF, which no retry with different params will fix), and whatever a
        // buggy `evaluate` raises on its own. An earlier version of this seam called all of
        // them `"input"` under a comment asserting they were all validation; that was wrong
        // about the code — `evaluateGenerator` runs `def.evaluate` before any of core's own
        // checks — and it sent an agent meeting a broken def into an endless param-tweaking
        // loop, because `"input"` means *"ask again differently"*.
        //
        // AND THEY CANNOT BE SPLIT HERE WITHOUT KEYING ON PROSE, which `result.ts` forbids
        // in as many words ("the message is not a key"). `applyOps` has a structural
        // discriminator and uses it; this path has none — the wrap `commitGenerator` puts
        // `cause` on covers only its span-validation pass, and the two cases that most need
        // separating (bad params vs. a bad def) both arrive raw from `evaluateGenerator`.
        // So the honest class is the one that claims NOTHING about whose fault it is:
        // `failed` carries the layer-below error and its sentence, which names the generator
        // and says what it did. The two causes this seam CAN attribute — an unresolvable id
        // and a missing region — are settled ABOVE, before the call, and keep `"input"`.
        return failed(messageOf(err));
      }
      deps.markDirtyWithNeighbors(committed.dirty);
      deps.rebuildProps();
      // LAST, once every piece of state has settled — `field-entities.ts`'s ordering rule:
      // a subscriber may read the host back synchronously from inside either notification,
      // and none may observe a half-committed world.
      deps.notifyHistory();
      deps.notifyEntities();
      const { entity } = committed;
      return {
        ok: true,
        entityId: entity.entityId,
        generator: entity.generator,
        seed: entity.seed,
        region: entity.region,
        params: entity.params,
        dirtyChunks: committed.dirty.size,
      };
    },
  };
}

/** The selection's metre box as a {@link StampRegion}, or null when nothing is selected.
 *
 *  A COPY, because the region travels into `commitGenerator` and then into the returned
 *  outcome, and the selection's own box is live host state. `truncated` is deliberately
 *  dropped: it records that a FLOOD hit the UI budget and so under-covers what the user
 *  asked for, which is a fact about the selection rather than about the region, and the
 *  interactive path carries it only to warn the human steering the session this verb does
 *  not open. */
function selectionBox(
  selection: { aabb: Box; truncated: boolean } | null,
): StampRegion | null {
  if (selection === null) return null;
  const { min, max } = selection.aabb;
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
}
