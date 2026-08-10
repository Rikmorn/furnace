// packages/editor/src/frontend/lib/session-answerers.ts
import type { RefObject } from "react";
import { type ActionResult, refused } from "../../action-registry/result.ts";
// TYPE-ONLY, so both are erased and this module stays a plain record with no runtime
// edge on the host — the rule `tests/frontend-no-engine-leakage.test.ts` machine-enforces
// for everything the chrome bundle pulls in.
import type { FieldHistory, FieldHost } from "../../field-host/index.ts";
import type {
  ActionRunRequest,
  EditApplyRequest,
  GenerateRequest,
  SessionState,
  ViewportCaptureRequest,
  ViewportCaptureResult,
} from "../../shared/wire.ts";
import type { ActionCtx } from "./actions.ts";

/**
 * What this editor session can be ASKED — method name → the function that answers it.
 *
 * A plain record, and the whole of the seam's policy. `useSessionAnswer` owns the wire
 * (which frame arrives, which POST goes back, what happens when a handler throws) and
 * knows no method names at all; this module knows the method names and no wire. Adding a
 * method is therefore a row here, which is the shape T4b Task 3 was asked to leave behind
 * for Task 4's `session.state`.
 *
 * A handler takes the request's `params` — `unknown`, because the envelope relays rather
 * than reads (`shared/wire.ts`) — and returns whatever the method's answer is.
 *
 * FIVE OUTCOMES, ALL FIVE HANDLED BY THE SEAM, which is what `unknown` is quietly promising
 * here and is worth saying rather than leaving to be discovered. A handler may return a
 * VALUE or a PROMISE of one — `unknown` admits both, and `useSessionAnswer` awaits — and it
 * may THROW or REJECT, either of which becomes a typed refusal rather than a silence. The
 * fifth is the one that took a review to find: a payload that will not SERIALIZE (a cycle, a
 * `BigInt`, a throwing `toJSON`) fails on the answer's own return leg, inside the POST, and
 * is converted there. That is what keeps "never a hang" true for a handler's own bugs and
 * not only for a missing method.
 *
 * It is also why an async method costs nothing here, which stopped being a prediction at
 * T4c: `viewport.capture` awaits a GPU readback and a PNG encode. A fact behind a round
 * trip is a legitimate answer, not a reason to fire-and-forget inside a synchronous body —
 * and the daemon's budget is per-method rather than a flat ten seconds precisely so a slow
 * honest answer is affordable (`daemon/backchannel.ts`'s `ask`).
 *
 * `undefined` IS A LEGITIMATE ANSWER. `JSON.stringify` drops the key, the daemon's schema
 * takes the body with `payload` absent, and the ask resolves `undefined` — the round trip is
 * pinned, because the schema rejected it until spec review found the hole
 * (`daemon/session-handlers.ts` carries the measurement).
 */
export type SessionAnswerers = Readonly<
  Record<string, (params: unknown) => unknown>
>;

/**
 * The methods a chrome can answer with NO mirrors at all — which today is exactly one.
 *
 * `session.ping` echoes its params back. It is a liveness probe and deliberately not a
 * useful read: what it proves is the whole path, which nothing smaller can — a claimed
 * connection, an addressed frame that arrived, a registry that resolved a method, a POST
 * that correlated back to its own ask. Every richer method rides that same path, so the
 * one thing worth pinning end to end before any of them exist is the path.
 *
 * It is a MODULE CONSTANT because it closes over nothing, and T4b Task 3 predicted that
 * `session.state` would not be able to be. It is not: {@link createSessionAnswerers} closes
 * over the reader the shell fills, which is why `useSessionAnswer` takes the registry as an
 * argument rather than importing this — the mount point can move to wherever the facts are
 * without the wire changing shape. Keeping the base row here means the moving version still
 * has one honest thing to spread, which is exactly what it does.
 */
export const BASE_ANSWERERS: SessionAnswerers = {
  "session.ping": (params) => ({ echo: params }),
};

/**
 * Everything `session.state` reads, as ONE argument.
 *
 * `ctx` IS THE WHOLE OF IT, and taking it whole rather than destructured is the point:
 * {@link ActionCtx} is already this chrome's one assembled answer to "what can be seen from
 * here", built once per render by the provider that reads every state context the actions
 * name. Re-reading those contexts here would be a SECOND assembly of it — two records that
 * must agree about what is selected, drifting the first time one grows a field. The
 * projection below picks from it and derives nothing.
 *
 * `history` IS THE FULL PAYLOAD because the ctx carries only the two LABELS — it needs
 * exactly the top of each stack and says so. The tail is what the History palette shows,
 * and it comes from the seam's own payload rather than from a second derivation here.
 *
 * THE CAMERA IS NOT HERE, and its absence is the one thing about this record worth saying:
 * the pose is the single fact the payload needs that the ctx deliberately does not carry, so
 * it is polled off `ctx.host` at answer time. The argument for that lives in ONE place —
 * `FieldHost.cameraPose`'s docblock — and every other site that needs it points there.
 */
export type SessionStateInput = {
  ctx: ActionCtx;
  history: FieldHistory;
};

/**
 * Project the chrome's mirrors into the wire's {@link SessionState} — **React-free, and
 * testable without a component**, which is the same split `lib/actions.ts` keeps from
 * `hooks/useActionContext.tsx`: what an answer IS lives here, what it can SEE is assembled
 * up there.
 *
 * NOT PURE, and the word is avoided deliberately rather than by omission: `camera` is a live
 * poll off the host (see below), so two calls with identical arguments can differ. That is
 * the intended behaviour for that member and it is argued where it happens — but a docblock
 * calling this function pure would contradict the one three lines down that argues why one
 * member must not be a snapshot.
 *
 * `ctx.host === null` IS THE READINESS TEST, and there is deliberately no second one. The
 * ctx's own docblock states that App assigns the host ref once, synchronously, immediately
 * before the dispatch that makes the editor ready — so `host !== null` and "the engine is
 * up" are the same fact, and asking `EditorState.status` beside it would be a second
 * spelling of one thing that could disagree.
 *
 * Every other member is a PICK. Nothing here computes, sorts, formats or falls back, and
 * that is the property worth keeping: a projection that derived anything would be a place
 * where the agent's picture and the human's screen could differ. The two `=== true` reads
 * on the entity are the only conversions, and they turn the host's absent-means-false
 * spelling into the booleans `shared/wire.ts` states it relays.
 */
export function sessionState({
  ctx,
  history,
}: SessionStateInput): SessionState {
  const host = ctx.host;
  if (host === null) return { ready: false };
  const session = ctx.session;
  const selection = ctx.selection;
  const entity = ctx.selectedEntity;
  const stats = ctx.stats;
  return {
    ready: true,
    // OFF THE HISTORY MIRROR, and the inversion is the point. The first cut of this line
    // polled the host, on the reasoning that a token must answer for the instant of the
    // question — and that is exactly backwards for a token whose job is to certify a
    // PAYLOAD. Everything below is latched at the last commit; a polled token would run
    // AHEAD of it, so an ask landing between a log mutation and React's next commit would
    // answer with a post-edit cursor over a pre-edit picture, and every later ask would
    // return that same cursor and confirm the staleness for ever. The token now rides the
    // history payload itself (`field-history.ts`'s `FieldHistory.revision`), so it and the
    // `history` member below cannot describe different moments. What that does NOT certify
    // is stated at `SessionState.cursor`.
    cursor: history.revision,
    // COPIED, not handed over — and it is THREE members, not two: `world` and `tool.mask`
    // here, and `history.tail` below. Those are exactly the members whose wire shape
    // matches a record the chrome is already holding, so they are the only ones that could
    // travel by reference, and a caller mutating what it was given would be reaching into
    // live chrome state. `tail` has the wire's `readonly string[]` in front of it, which is
    // a compile-time guard and not a runtime one; the other two have nothing. Nothing
    // mutates a payload today (it is serialized immediately), which is exactly why the
    // reason is written here rather than re-derived by whoever adds the second caller.
    // Pinned by identity in `tests/chrome/session-state.test.tsx`.
    world: { ...ctx.world },
    tool: {
      effect: ctx.tool.effect,
      materialId: ctx.tool.materialId,
      mask: { ...ctx.tool.mask },
    },
    gesture: ctx.gesture,
    session:
      session === null
        ? null
        : {
            generator: session.generator,
            phase: session.phase,
            mode: session.mode,
            entityId: session.entityId,
          },
    selection:
      selection === null
        ? null
        : { count: selection.count, truncated: selection.truncated },
    selectedEntity:
      entity === null
        ? null
        : {
            entityId: entity.entityId,
            generator: entity.generator,
            frozen: entity.frozen === true,
            baked: entity.baked === true,
          },
    // POLLED — the only member that is, and the reason is `FieldHost.cameraPose`'s to
    // state. It is therefore FRESHER than everything around it, which is safe precisely
    // because the cursor certifies nothing about it (`SessionState.cursor`).
    camera: host.cameraPose(),
    stats:
      stats === null
        ? null
        : {
            totalOps: stats.totalOps,
            undoDepth: stats.undoDepth,
            redoDepth: stats.redoDepth,
          },
    history: {
      // The two labels off the CTX rather than off `history` here, so the sentence an
      // agent reads and the sentence the Undo menu shows come from one derivation.
      undoLabel: ctx.history.undoLabel,
      redoLabel: ctx.history.redoLabel,
      tail: [...history.undo],
    },
  };
}

/** The chrome's live {@link SessionState} reader — `null` until the shell has committed a
 *  render, which is the only window in which nobody can answer. */
export type SessionStateReader = () => SessionState;

/**
 * The chrome's live NAMED-ACTION dispatcher — `null` until the shell has committed a render.
 *
 * A REF, AND THE REASON IS THE CTX. {@link runNamedById} is pure and takes an
 * {@link ActionCtx}; this registry is memoized `[]` for the feed's stability rule and holds
 * a serialized PROJECTION of the chrome rather than the ctx itself. The ctx is
 * `ActionContextProvider`'s, rebuilt whenever anything it reads moves, and this module's
 * own header argues why a second assembly of it here would be wrong — two records that must
 * agree about what is selected, drifting the first time one grows a field. So what travels
 * is a closure over the LIVE ctx, filled by the provider that builds it, exactly as
 * {@link SessionStateReader} is.
 *
 * ONE REF FOR ALL 39 VERBS rather than a ref per verb, which is what makes `action.run` a
 * door rather than a switch: the chrome hands over the ability to dispatch BY ID, and which
 * ids exist stays the registry's answer.
 */
export type ActionDispatch = (
  id: string,
  input?: unknown,
) => Promise<ActionResult>;

/**
 * The full registry: the base rows plus `session.state`, over a reader the shell fills.
 *
 * A FACTORY OVER A REF, which is the shape T4b Task 3 predicted when it said the moving
 * version would still have one honest thing to spread. The wire mounts at `App`
 * (`useSessionAnswer`'s header argues where and why) and the mirrors live far below it, so
 * the reader travels the route this chrome already uses for exactly this — a ref created in
 * `App` and filled from below. TWO precedents, named precisely because an earlier version
 * of this sentence named the wrong set: `bakeBusyRef` (filled by the shell's world verbs)
 * and `viewportFocusRef` (created in `App`, installed by `CanvasHost`). It was three until
 * T4c: `worldNameRef` (filled by `WorldProvider`) was retired when the session claim learnt
 * to re-key, because a ref carries a VALUE and what the claim needed was the EVENT — the
 * seam is now a verb travelling the other way, `setAuthoredWorld`. NOT `claimLostRef`
 * either, which is created AND written inside `useSessionClaim` — a hook `App` itself calls
 * — so only its READER is below and it is a different shape. Nothing about the wire moved
 * to make this reachable.
 *
 * **AN UNFILLED REF ANSWERS `{ ready: false }` rather than throwing or refusing**, and the
 * distinction matters to whoever asked. A refusal would say "this tab cannot serve that
 * method", which is false — it serves it, and the honest content of the answer is that
 * there is no session state yet. The window is the one render before the shell's first
 * effect runs, and it is the same state a mounted chrome with no engine reports, which is
 * why they share an arm.
 *
 * The result is a NEW OBJECT per call, so the caller must memoize it — `useSessionAnswer`
 * states that rule and why the feed's dep list imposes it.
 *
 * **THE SECOND REF IS NOT A THIRD INSTANCE OF THAT PATTERN, and saying so is the point of
 * this paragraph.** `host` is `App`'s `fieldHostRef`, which App creates AND fills itself —
 * one assignment inside its own engine-bootstrap effect, synchronously before the dispatch
 * that makes the editor ready. Neither its writer nor its reader is below `App`, so it is
 * not `viewportFocusRef`'s shape (created above, installed from far below) and it is not
 * even `claimLostRef`'s (written by a hook `App` calls, read from below) — it is the
 * simplest case of all, a ref `App` owns end to end. What
 * makes it a ref at all is different and simpler: the registry is memoized `[]` for the
 * feed's stability rule, so it cannot close over a value that arrives after the first
 * render, and a ref object is the only thing React guarantees never changes identity.
 *
 * **THE THIRD REF IS `reader`'s SHAPE EXACTLY, so the precedent list above DOES grow by one
 * — and the one it grows by is this file's own first ref, not a new outside pattern.**
 * `dispatch` (T4c) is created in `App` and filled by `ActionContextProvider`, which is
 * where the ctx it closes over is built; that is `sessionStateRef` to the letter, and for
 * the same underlying reason — both need something the chrome assembles far below the mount
 * point. So of the three parameters here, two travel the created-above/filled-below route
 * (`reader`, `dispatch`) and one does not (`host`, App's end to end). Counting them as
 * "three refs, one pattern" would be wrong in the way this paragraph exists to prevent.
 *
 * `undefined`, not `null`, for `host` only, because that is what
 * `useRef<FieldHost | undefined>(undefined)` spells and normalising it here would be a
 * conversion whose only purpose is to make refs look alike. The answerers therefore test
 * their readiness differently — `null` for the reader and the dispatcher, `undefined` for
 * the host — and each tests the value its owner actually writes.
 *
 * @param reader - the `SessionState` projection, filled by `ActionContextProvider`.
 * @param host - the field host, filled by `App`'s engine bootstrap. `undefined` until the
 * engine module has loaded, which is a state `viewport.capture` refuses out loud and the
 * two mutation rows refuse quietly (see `noEngine`).
 * @param dispatch - the named-action dispatcher over the LIVE ctx, filled by
 * `ActionContextProvider`. `null` for the one render before its first effect runs.
 */
export function createSessionAnswerers(
  reader: RefObject<SessionStateReader | null>,
  host: RefObject<FieldHost | undefined>,
  dispatch: RefObject<ActionDispatch | null>,
): SessionAnswerers {
  /** The sentence and class the two MUTATION rows refuse a missing engine with.
   *
   *  THEY REFUSE RATHER THAN THROW, which is the opposite of `viewport.capture` below and
   *  is decided by what an honest answer would be. A read has none: there is no picture of
   *  a viewport that does not exist, so that row throws and lets the seam convert it. A
   *  WRITE has one, and it is the ordinary one every verb in this editor gives — *I did not
   *  do it, and here is why* — in the vocabulary the caller is already branching on.
   *  Throwing would turn a routine "not yet" into a transport-level failure and cost the
   *  caller the CLASS, which is the half it can act on: `"inert"` says the engine arrives on
   *  its own, so change nothing and ask again.
   *
   *  The same sentence and class as `handOffToHost` in `lib/actions.ts`, which is where a
   *  NAMED verb meets this state. Two doors, one answer. */
  const noEngine = (): Extract<ActionResult, { ok: false }> =>
    refused("the engine is not up yet — nothing has been done", "inert");

  return {
    ...BASE_ANSWERERS,
    "session.state": (): SessionState => {
      const read = reader.current;
      if (read === null) return { ready: false };
      return read();
    },
    // THE FIRST ANSWER THAT IS NOT A PROJECTION OF A MIRROR (foundations T4c). Every
    // method before it read a latch the chrome was already holding and shaped it for the
    // wire; this one asks the ENGINE to do work — render the viewport's own composition
    // into an off-screen texture, read it back, encode a PNG — and hands over the result.
    // That is why it is `async` and why the daemon raises its ask budget for this method
    // alone (`daemon/session-handlers.ts`); the seam has always permitted a promise
    // (`useSessionAnswer` awaits, and its header argues why), and this is the first row to
    // spend it.
    //
    // IT REFUSES BY THROWING, which is the honest shape here and the opposite of
    // `session.state`'s `{ ready: false }`. That method has a truthful answer for a chrome
    // with no engine — "there is no session state yet" — and this one does not: there is no
    // picture of a viewport that does not exist, and inventing a blank image would be a
    // POSITIVE claim about what the human is looking at. `useSessionAnswer` converts the
    // throw into a typed refusal the caller reads, so the failure lands where the question
    // came from.
    "viewport.capture": async (
      params: unknown,
    ): Promise<ViewportCaptureResult> => {
      const engine = host.current;
      if (engine === undefined) {
        throw new Error(
          "this editor tab has no engine yet — there is nothing to photograph",
        );
      }
      // ONE cast, at the relay boundary, and it is the same one every daemon-side handler
      // takes: `params` is `unknown` because the envelope relays rather than reads, and the
      // daemon has already validated it against `viewport.capture`'s schema.
      const req = (params ?? {}) as ViewportCaptureRequest;
      // NO SECOND CAST ON `view`, and its absence is the load-bearing part. Both sides name
      // the SAME `CaptureView` — `shared/capture.ts` declares it on the neutral floor
      // precisely so the daemon can validate it without touching the engine — so the wire
      // type and the host's parameter are one union and this assignment type-checks on its
      // own. A cast here would have been a no-op wearing a justification.
      const shot = await engine.captureScene({
        view: req.view,
        size: req.size,
        overlays: req.overlays,
      });
      return {
        // THE ONE PLACE BYTES BECOME BASE64. `shared/wire.ts` argues why here and nowhere
        // else. Chunked rather than one `String.fromCharCode(...bytes)` spread: a 1024 px
        // capture is ~1 MB of PNG and a spread that wide overflows the argument limit in
        // every engine — the failure is a `RangeError` at capture time, on the size that
        // is the DEFAULT, which is the kind of bug that ships because the small fixture
        // never hits it.
        png: base64(shot.png),
        width: shot.width,
        height: shot.height,
        view: shot.view,
      };
    },
    // THE FIRST ANSWER THAT WRITES (foundations T4c). Everything above reads — a mirror, a
    // ref, a rendered frame — and this is where the agent's hands arrive.
    //
    // IT GOES STRAIGHT TO THE HOST rather than through the dispatcher below, and that is a
    // decision rather than a shortcut. `edit.apply` is NOT an action row: putting it in
    // `ACTION_DESCRIPTORS` would list "Apply ops" in the ⌘K palette and the burger's Edit
    // submenu (`CommandPalette.tsx` renders every descriptor), offering a human a command
    // they cannot meaningfully invoke — nobody types a JSON op list into a command palette.
    // What the registry would have bought is the GATE, and the host applies the only clause
    // of it that means anything here: `applyOps` refuses under a live stamp session, which
    // is the one editor state a batched write can actually corrupt
    // (`field-mutation.ts` works the mechanism through).
    "edit.apply": (params: unknown): ActionResult => {
      const engine = host.current;
      if (engine === undefined) return noEngine();
      // The relay cast every answerer takes: `params` is `unknown` because the envelope
      // relays rather than reads, and the daemon has validated it against this method's
      // schema (`daemon/op-schema.ts`).
      //
      // NO `?? {}` HERE, unlike `viewport.capture` below, and the asymmetry is the point:
      // every field of a capture request is optional, so `{}` IS a valid capture — while
      // `ops` is REQUIRED, so `{}` is not a valid apply and manufacturing one turns a
      // missing field into `req.ops.map` on `undefined`. `useSessionAnswer` would convert
      // that throw into a refusal, but a TYPE ERROR relayed as `internal` tells an agent the
      // editor broke when it simply sent no ops. Guarded rather than validated: the daemon's
      // schema is what REJECTS a bad batch, and this is the one shape assertion that keeps a
      // hole in it from becoming a crash instead of a sentence.
      const req = params as EditApplyRequest | undefined;
      if (req === undefined || !Array.isArray(req.ops))
        return refused(
          "edit.apply needs an `ops` array and none arrived",
          "input",
        );
      return engine.applyOps(req.ops);
    },
    // The second write, and the one that makes a world rather than editing one. It answers
    // a `GenerateOutcome` — the committed record read back, or a refusal in the same
    // vocabulary — and `field-mutation.ts` owns why the success half is its own type rather
    // than a widened `ActionResult`. Host-direct for `edit.apply`'s reason exactly.
    generate: (params: unknown) => {
      const engine = host.current;
      if (engine === undefined) return noEngine();
      const req = (params ?? {}) as GenerateRequest;
      // NO SECOND CAST AND NO FIELD-BY-FIELD COPY. The wire's `GenerateRequest` and the
      // host's are structurally the one shape — both are plain JSON with the same four
      // members — so this assignment type-checks on its own, the way `viewport.capture`'s
      // `view` does one row up. If they ever diverge the compiler says so here, which is
      // the whole value of not casting.
      return engine.generate(req);
    },
    // THE NAMED-VERB DOOR, and the only row that goes through the dispatcher — because it
    // is the only one whose subject is the ACTION TABLE rather than the engine. An agent
    // reaches `world.save`, `world.bake`, `edit.undo`, `view.frame` and the rest through
    // here, which is what makes the gate script's save-and-bake step expressible at all.
    //
    // THE REF CAN BE NULL, and the answer for that is a refusal rather than a throw for the
    // mutation rows' reason: it is the one render before the provider's first effect runs,
    // the chrome recovers on its own, and `"inert"` says exactly that. It is a DIFFERENT
    // absence from a missing engine (the shell has not committed, rather than the engine
    // bundle has not landed) and says so, because an agent that cannot tell them apart
    // cannot tell whether waiting will help — it will, for both, which is why they share a
    // class and not a sentence.
    "action.run": (params: unknown): Promise<ActionResult> => {
      const run = dispatch.current;
      if (run === null)
        return Promise.resolve(
          refused(
            "this editor tab has not finished rendering — no action can be dispatched yet",
            "inert",
          ),
        );
      const req = (params ?? {}) as ActionRunRequest;
      // `input` is relayed UNPARSED because the daemon has already parsed it against this
      // id's own schema — the one place per-id input validation lives. `runNamedById`
      // refuses an id the table does not carry, which is the half the daemon cannot check.
      return run(req.id, req.input);
    },
  };
}

/** How many bytes per `fromCharCode` call. 8 KiB is comfortably inside every engine's
 *  argument-count limit (the smallest documented is ~64 K) with room to spare, and large
 *  enough that a 1 MB capture is ~128 calls rather than a million. */
const BASE64_CHUNK = 8192;

/** Bytes → base64, for the one wire hop that cannot carry bytes.
 *
 *  `btoa` over a binary string, which is the platform's only synchronous encoder — the
 *  alternative (`FileReader` over a `Blob`) is async and would add a second await to a path
 *  that already has two. Chunked for the reason the call site states. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}
