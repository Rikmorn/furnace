// THE MUTATION SEAM — the agent's hands (foundations T4c).
//
// TWO LEVELS, deliberately, because the seam has two kinds of claim in it.
//
//   - MODULE level (`createMutation` over a real store/log/table and stub deps) for
//     everything that is about the COMPOSITION: which visibility lines fire, what a refusal
//     says, that a live session refuses, that the outcome is read back off the committed
//     record. Those are this module's own decisions and a stub dep record is what makes
//     them assertable one at a time.
//   - HOST level (`createFieldHost`) for the WIRING: that the facade's two members reach
//     the seam at all, with the real substrate behind them. No GPU is involved — every path
//     here is store and log work, exactly like `field-host-headless.test.ts`'s set.
//
// The split is worth stating because the obvious alternative — testing everything through
// the host — cannot reach the session guard: opening a stamp session needs a selection, and
// a selection needs a camera, which needs a device. At module level `session()` is a thunk
// and the state is one line.
import { expect, test } from "bun:test";
import {
  createFieldStore,
  createOpLog,
  type FieldStore,
  type MaterialTable,
  type OpLog,
} from "@furnace/core/field";
import { createFieldHost } from "../../src/field-host/field-host.ts";
import {
  createMutation,
  type MutationDeps,
} from "../../src/field-host/field-mutation.ts";
import type { StampSession } from "../../src/field-host/index.ts";
import type { BrushOpInput } from "../../src/shared/field-op.ts";

/** A dig sphere at `center`. The op every case here that does not care about the op uses,
 *  so a reader can tell "this case is about the op" from "this case is about the seam". */
const dig = (center: [number, number, number], radius = 1): BrushOpInput => ({
  kind: "brush",
  effect: "dig",
  shape: { kind: "sphere", center, radius },
});

/** A 3-class table with a KIT class, because every stamp generator requires one — a fresh
 *  host's `BUILTIN_TABLE` is rock-only and `hall` refuses against it ("stamp generators need
 *  a kit material class in the catalog"), which is correct behaviour and not what these
 *  cases are about.
 *
 *  DECLARED LOCALLY, following this suite's own convention: THIRTEEN other editor test files
 *  carry their own trimmed copy of a kit-bearing table (re-measured at T4c Task 4 —
 *  `grep -rl 'kind: "kit"' packages/editor/tests --include="*.ts"`, fourteen hits including
 *  this one; it was thirteen when this comment was written, and `tests/field-host/query.test.ts`
 *  is the one that made it fourteen). That duplication predates this file and extracting it
 *  would touch all fourteen, which is a tidy-up rather than part of the seam being pinned
 *  here. The count is stated because an earlier draft of this comment guessed "five" off a
 *  glob that double-counted, which is the class of number this repo does not let stand
 *  unmeasured — and the correction above is the same rule applied to its successor. */
const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

type Harness = {
  store: FieldStore;
  log: OpLog;
  table: MaterialTable;
  /** What the seam TOLD the rest of the host, in call order — the visibility lines. */
  fired: string[];
  session: StampSession | null;
  selection: {
    aabb: { min: [number, number, number]; max: [number, number, number] };
    truncated: boolean;
  } | null;
};

function harness(): { h: Harness; deps: MutationDeps } {
  const h: Harness = {
    store: createFieldStore(),
    log: createOpLog(),
    table: TABLE,
    fired: [],
    session: null,
    selection: null,
  };
  const deps: MutationDeps = {
    substrate: {
      store: h.store,
      log: h.log,
      table: () => h.table,
      // The seam reads exactly three substrate members. The rest of `HostSubstrate` is not
      // modelled and must not be: a fixture that filled sixteen fields would go stale
      // against a record this module never touches.
    } as unknown as MutationDeps["substrate"],
    markDirtyWithNeighbors: (changed) =>
      h.fired.push(`dirty:${[...changed].sort().join(",")}`),
    notifyHistory: () => h.fired.push("history"),
    notifyEntities: () => h.fired.push("entities"),
    rebuildProps: () => h.fired.push("props"),
    session: () => h.session,
    selectionRegion: () => h.selection,
    randomSeed: () => 4242,
  };
  return { h, deps };
}

/** A live session, as the guard sees it. Only `session() !== null` is read, so a cast off a
 *  minimal literal is honest here — modelling a whole `StampSession` would assert nothing
 *  extra and would break whenever that type grew a field. */
const LIVE_SESSION = { generator: "hall" } as unknown as StampSession;

// --- the batched write ------------------------------------------------------

test("a valid group applies, dirties its chunks, and pushes exactly ONE undo entry", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);

  // THREE ops, one call. The single entry is the whole point of the batched shape — an
  // agent's batch is one ⌘Z for the human — so the count is asserted on the LOG rather than
  // inferred from a seam that might coalesce.
  expect(m.applyOps([dig([0, 0, 0]), dig([1, 0, 0]), dig([2, 0, 0])])).toEqual({
    ok: true,
  });
  expect(h.log.undoStack.length).toBe(1);
  // …and all three ops are IN it, so "one entry" is not "two ops were dropped".
  expect(h.log.ops.length).toBe(3);

  // THE VISIBILITY LINES, in order and both present. This is the pair `commitToolOp` keeps
  // and the reason this seam is a module: a write that skipped either would sit in the
  // store with no remesh and no history row — invisible on screen, which is the one failure
  // mode a headless suite can still catch.
  expect(h.fired.filter((f) => f === "history")).toEqual(["history"]);
  // NOT `startsWith("dirty:")` — the harness renders an EMPTY set as the bare string
  // `"dirty:"`, so the prefix test passed for a remesh of nothing, which is precisely the
  // failure this paragraph is about. ONE call, carrying at least one chunk key: that is the
  // whole assertion, and `not.toBe("dirty:")` is the part doing the work. An earlier
  // version of this comment also claimed a SORTED list asserted against the set
  // `logApplyGroup` returned — neither was true (sortedness is the harness's rendering, and
  // the returned set never reaches this test, since `applyOps` answers `ACTION_OK`), and it
  // carried a third assertion that could not fail: `"".split(",").length` is 1.
  const dirtied = h.fired.filter((f) => f.startsWith("dirty:"));
  expect(dirtied.length).toBe(1);
  expect(dirtied[0]).not.toBe("dirty:");
});

test("ids are the LOG's — a caller's placeholder never survives into the log", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  h.log.nextId = 7;
  m.applyOps([dig([0, 0, 0]), dig([4, 0, 0])]);
  // Sequential from the log's own counter, not the `0` the seam passes as a placeholder.
  expect(h.log.ops.map((o) => o.id)).toEqual([7, 8]);
});

test("an invalid op is REFUSED naming ops[N], as `input`, with nothing written", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  const result = m.applyOps([
    dig([0, 0, 0]),
    dig([1, 0, 0]),
    // A non-finite radius: `assertOpValid`'s own rejection, at a KNOWN index.
    {
      ...dig([2, 0, 0]),
      shape: { kind: "sphere", center: [2, 0, 0], radius: Number.NaN },
    },
  ]);
  if (result.ok) throw new Error("expected a refusal");
  expect(result.kind).toBe("refused");
  // THE INDEX IS THE ADDRESS, and it is the reason the batched verb is usable at all: the
  // ops carry no ids yet, so the list POSITION is the only thing that names the record to
  // fix. Asserted as a substring rather than by whole sentence — the predicate's own half
  // of the message is core's to reword.
  if (result.kind !== "refused") throw new Error("expected refused");
  expect(result.message).toContain("ops[2]");
  expect(result.because).toBe("input");
  // VALIDATE-ALL-THEN-APPLY: the two GOOD ops before the bad one are not in the store and
  // not in the log. That is core's guarantee and the half of it this seam depends on.
  expect(h.log.ops.length).toBe(0);
  expect(h.log.undoStack.length).toBe(0);
  // Nothing was announced either — a refusal must not fire the visibility lines, or the
  // chrome would re-mesh and publish a history step for a write that never happened.
  expect(h.fired).toEqual([]);
});

test("an empty list is a no-op answering ok — core's contract, passed through", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  expect(m.applyOps([])).toEqual({ ok: true });
  // NO PHANTOM ENTRY. Core declines to push one because a history step nobody drew costs a
  // real one; the door refuses an empty batch a layer up, where a schema can say so.
  expect(h.log.undoStack.length).toBe(0);
});

test("an APPLIER failure is `failed`, not the caller's fault — and it says the world moved", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  // THE PASS-2 CASE, which is the one the classification exists for. A finite-but-absurd
  // radius clears `assertOpValid` whole (finite, positive — pass 1 has no opinion) and dies
  // in the applier's scratch-buffer allocation. Core documents this exact hole; the backlog
  // entry measures it.
  const result = m.applyOps([
    dig([1, 1, 1]),
    dig([2, 1, 1]),
    {
      kind: "brush",
      effect: "smooth",
      shape: { kind: "sphere", center: [4, 4, 4], radius: 1e12 },
      smooth: { strength: 16, iterations: 1, mode: "both" },
    },
  ]);
  if (result.ok) throw new Error("expected a failure");
  // `failed`, NOT `refused(…, "input")`. The distinction is the whole point: `"input"`
  // promises *"the ARGUMENT was wrong, and the world is fine"*, and the world is NOT fine —
  // two ops are written below. Telling a caller to fix its argument here is two false
  // claims in one word.
  expect(result.kind).toBe("failed");
  // THE RESIDUE IS COMMUNICATED, not merely declared in a docblock the caller cannot read.
  if (result.kind !== "failed") throw new Error("expected failed");
  expect(result.message).toContain("WRITTEN to the field");
  expect(result.message).toContain("no remesh");

  // …and the residue is REAL, reproduced here rather than described: the store moved and
  // the log did not. This is core's declared non-transaction, pinned at the editor's layer
  // so a future rollback reds something self-describing.
  expect(h.store.chunks.size).toBeGreaterThan(0);
  expect(h.log.ops.length).toBe(0);
  expect(h.log.undoStack.length).toBe(0);
  // NOTHING was marked dirty either — the second half of the sentence the message carries.
  expect(h.fired).toEqual([]);
});

test("a pass-1 rejection and a pass-2 failure are told apart STRUCTURALLY", () => {
  // THE DISCRIMINATOR, asserted as the pair rather than as two separate cases — what makes
  // it a discriminator is that the same seam answers the two differently. `logApplyGroup`
  // sets `cause` on its pass-1 wrap and on nothing else; a docblock in this seam once
  // claimed the two "cannot be told apart", which was false.
  const { deps } = harness();
  const m = createMutation(deps);
  const passOne = m.applyOps([
    {
      ...dig([0, 0, 0]),
      shape: { kind: "sphere", center: [0, 0, 0], radius: Number.NaN },
    },
  ]);
  const passTwo = m.applyOps([
    {
      kind: "brush",
      effect: "smooth",
      shape: { kind: "sphere", center: [4, 4, 4], radius: 1e12 },
      smooth: { strength: 16, iterations: 1, mode: "both" },
    },
  ]);
  if (passOne.ok || passTwo.ok) throw new Error("expected two failures");
  expect([passOne.kind, passTwo.kind]).toEqual(["refused", "failed"]);
});

// --- the generator commit ---------------------------------------------------

test("generate commits atomically and leaves NO stamp session behind", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  const out = m.generate({
    generatorId: "hall",
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  });
  if (!out.ok) throw new Error(`expected a commit, got: ${out.message}`);

  // THE SESSION IS THE POINT. `startStamp` would have opened one (or armed region-draw and
  // waited for clicks that never come); a session left standing refuses `world.bake` and
  // every family key, so the gate script's generate→save→bake would die at the step after
  // this one. The seam never touches session state at all, which is why this reads it off
  // the harness rather than off a host: there is nothing here that COULD open one.
  expect(h.session).toBeNull();
  // ONE undo entry for the whole commit — `commitGenerator`'s contract, the same guardrail
  // the batched op verb has.
  expect(h.log.undoStack.length).toBe(1);
  // The entity is IN the log and the id it reports is the one that landed.
  expect(out.entityId).toBeGreaterThan(0);
  expect(out.generator).toBe("hall");
});

test("the outcome is READ BACK, not echoed — an omitted seed reports the one that was used", () => {
  const { deps } = harness();
  const m = createMutation(deps);
  const out = m.generate({
    generatorId: "hall",
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  });
  if (!out.ok) throw new Error(`expected a commit, got: ${out.message}`);
  // THE DEFAULTED SEED COMES BACK. A caller that named none has no other way to reproduce
  // the world it just made, and an echo of the request would have reported `undefined`.
  expect(out.seed).toBe(4242);
  // The params are the DEF's defaults, not `{}` — a caller that named none gets what the
  // stamp form would have opened with, and can read what that was.
  expect(Object.keys(out.params).length).toBeGreaterThan(0);
});

test("generate defaults its region to the SELECTION, and refuses when there is neither", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);

  // No region, no selection: REFUSED rather than a box invented around the origin. The
  // interactive path has no third answer either — it asks the human to draw one.
  const noRegion = m.generate({ generatorId: "hall" });
  if (noRegion.ok) throw new Error("expected a refusal");
  if (noRegion.kind !== "refused") throw new Error("expected refused");
  expect(noRegion.because).toBe("input");
  // THE EXACT SENTENCE, and the whole-string match is the point rather than pedantry.
  // Written as `because === "input"` plus `message.toContain("region")` this case passed
  // with the guard DELETED — measured by sabotage, not supposed: without it the null region
  // reaches `commitGenerator`, which throws, and the catch below turns every throw into
  // `refused(…, "input")` whose message also happens to mention a region. Two assertions
  // that both describe the fallback are not a pin on the guard. This sentence is produced
  // at exactly one place and says the thing a caller needs — that the remedy is to name a
  // region or select cells, not to fix the generator.
  expect(noRegion.message).toBe(
    "hall needs a region — name one, or select cells first (there is no default place to put a generator)",
  );
  expect(h.log.ops.length).toBe(0);

  // With a selection standing, the same call commits — and into the SELECTION's box.
  h.selection = { aabb: { min: [0, 0, 0], max: [8, 5, 8] }, truncated: false };
  const out = m.generate({ generatorId: "hall" });
  if (!out.ok) throw new Error(`expected a commit, got: ${out.message}`);
  expect(out.region).toEqual({ min: [0, 0, 0], max: [8, 5, 8] });
});

test("an unregistered generator id is refused as `input`, before any commit", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  const out = m.generate({
    generatorId: "no-such-generator",
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  });
  if (out.ok) throw new Error("expected a refusal");
  if (out.kind !== "refused") throw new Error("expected refused");
  expect(out.because).toBe("input");
  expect(h.log.ops.length).toBe(0);
});

test("a failure INSIDE the generator is `failed` — not a claim about the request", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  // `commitGenerator` reaches `def.evaluate`, so what comes back out of it spans the
  // caller's params, a defect in the DEF, and a bug in arbitrary generator code — and this
  // seam has no structural way to tell them apart (`applyOps` does; that is why the two
  // verbs classify differently). `failed` is the arm that claims nothing about whose fault
  // it was. Under `"input"` an agent meeting a broken def would retry with different params
  // for ever, because that class means *ask again differently*.
  const out = m.generate({
    generatorId: "hall",
    params: { width: "enormous" },
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  });
  if (out.ok) throw new Error("expected a failure");
  expect(out.kind).toBe("failed");
  // Core's own sentence survives — it names the generator and the offending field, which is
  // the actionable half whatever the class says.
  if (out.kind !== "failed") throw new Error("expected failed");
  expect(out.message).toContain("hall");
  expect(h.log.ops.length).toBe(0);
});

test("the two causes generate CAN attribute keep `input` — id and region", () => {
  // THE OTHER SIDE of the case above, so "everything became `failed`" cannot pass. Both are
  // settled BEFORE `commitGenerator` is called, which is exactly why they can be attributed
  // with certainty while the throws behind it cannot.
  const { deps } = harness();
  const m = createMutation(deps);
  const badId = m.generate({
    generatorId: "no-such-generator",
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  });
  const noRegion = m.generate({ generatorId: "hall" });
  if (badId.ok || noRegion.ok) throw new Error("expected two refusals");
  expect([badId.kind, noRegion.kind]).toEqual(["refused", "refused"]);
  if (badId.kind !== "refused" || noRegion.kind !== "refused")
    throw new Error("expected refused");
  expect([badId.because, noRegion.because]).toEqual(["input", "input"]);
});

// --- the live-session guard, both verbs -------------------------------------
//
// ONE RULE, TWO VERBS, and they are asserted together because that is the claim: both write
// cells, a session's ghost was computed against those cells, and neither is allowed to
// desynchronise a preview the human is steering. The interactive path cannot produce this
// state (D-7 suspends the brush under a session) — an agent is the only caller that can.

test("both mutation verbs refuse under a live stamp session, in the same words", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  h.session = LIVE_SESSION;

  const applied = m.applyOps([dig([0, 0, 0])]);
  const generated = m.generate({
    generatorId: "hall",
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  });
  if (applied.ok || generated.ok) throw new Error("expected two refusals");
  if (applied.kind !== "refused" || generated.kind !== "refused")
    throw new Error("expected two refusals");

  expect(applied.because).toBe("session");
  expect(generated.because).toBe("session");
  // THE SAME SENTENCE, because it is one rule. A reader meeting either should not have to
  // wonder whether the other means something subtly different.
  expect(applied.message).toBe(generated.message);
  expect(applied.message).toContain("session.confirm");

  // NOTHING happened on either path — no write, no entry, no announcement.
  expect(h.log.ops.length).toBe(0);
  expect(h.fired).toEqual([]);
});

test("a PENDING stamp is not a session — an armed generator does not block a write", () => {
  const { h, deps } = harness();
  const m = createMutation(deps);
  // `pendingStamp` is a generator armed for region-draw: no evaluate has run and there is
  // no ghost, so there is nothing a write could invalidate. The guard reads `session()` and
  // nothing else, and this is what stops a future reader "tidying" it into a wider check.
  h.session = null;
  expect(m.applyOps([dig([0, 0, 0])])).toEqual({ ok: true });
  expect(h.log.undoStack.length).toBe(1);
});

// --- the facade wiring ------------------------------------------------------

test("the HOST's two members reach the seam over the real substrate", () => {
  // No GPU: both paths are store and log work (`field-host-headless.test.ts`'s set).
  const host = createFieldHost();
  host.setMaterialTable(TABLE);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const histories: number[] = [];
  host.subscribeHistory((h) => histories.push(h.undoDepth));

  expect(host.applyOps([dig([0, 0, 0]), dig([1, 0, 0])])).toEqual({ ok: true });
  // THE HISTORY SEAM FIRED, which is the facade half of the visibility pair and the one a
  // headless test can see: the depth the chrome renders went to 1 for a two-op batch.
  expect(histories.at(-1)).toBe(1);

  // THE SESSION SEAM, watched across the commit. The module-level case above asserts
  // `h.session === null`, and that pin is weak BY CONSTRUCTION — the stub deps expose no
  // setter, so the seam could not open one if it tried. What could really go wrong is a
  // FACADE rewiring (someone routing `generate` through `startStamp` to reuse its region
  // handling), and only a real host can see it: `subscribeStamp` pushes on every session
  // transition, so a session opened and committed would show as a non-null push even if it
  // did not survive the call.
  const sessions: unknown[] = [];
  host.subscribeStamp((s) => sessions.push(s));
  // BOTH staged-grammar seams, because watching only the session one is not enough —
  // measured by sabotage rather than assumed. Routing `generate` through `startStamp` with
  // no selection ARMS region-draw instead of opening a session, so `subscribeStamp` never
  // moves and a session-only assertion stays green over exactly the rewiring it was written
  // to catch. `pendingStamp` is the seam that shows it.
  const pending: unknown[] = [];
  host.subscribePendingStamp((p) => pending.push(p));
  const out = host.generate({
    generatorId: "hall",
    region: { min: [20, 0, 20], max: [28, 5, 28] },
  });
  if (!out.ok) throw new Error(`expected a commit, got: ${out.message}`);
  expect(host.listEntities().map((e) => e.entityId)).toContain(out.entityId);
  // Only the subscribe-time `null`. No session was opened, so none had to be cleaned up —
  // which is what makes the next verb in an agent's script (`world.bake`, whose `enabled`
  // requires no session) reachable at all.
  expect(sessions).toEqual([null]);
  expect(pending).toEqual([null]);

  // NOT ONE WORD ON THE HOST'S OWN CHANNEL. Every refusal these two verbs raise is
  // RETURNED, never toasted — the T4b ruling that an agent-caused refusal must not
  // interrupt the human. A refusal proves it better than a success, so one is provoked.
  const refusal = host.applyOps([
    {
      ...dig([0, 0, 0]),
      shape: { kind: "sphere", center: [0, 0, 0], radius: -1 },
    },
  ]);
  expect(refusal.ok).toBe(false);
  expect(errors).toEqual([]);
});

test("an agent's batch is ONE undo step for the human — the named-stroke guardrail", () => {
  // THE END-TO-END FORM of the single-entry claim, through the facade and back out through
  // `undo()`: five ops in, one ⌘Z, and the world is where it started. A per-op verb would
  // have needed five.
  const host = createFieldHost();
  const histories: number[] = [];
  host.subscribeHistory((h) => histories.push(h.undoDepth));

  host.applyOps([
    dig([0, 0, 0]),
    dig([1, 0, 0]),
    dig([2, 0, 0]),
    dig([3, 0, 0]),
    dig([4, 0, 0]),
  ]);
  expect(histories.at(-1)).toBe(1);
  host.undo();
  expect(histories.at(-1)).toBe(0);
});
