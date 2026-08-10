// packages/editor/src/frontend/lib/session-answerers.ts
import type { RefObject } from "react";
// TYPE-ONLY, so both are erased and this module stays a plain record with no runtime
// edge on the host — the rule `tests/frontend-no-engine-leakage.test.ts` machine-enforces
// for everything the chrome bundle pulls in.
import type { FieldHistory, FieldHost } from "../../field-host/index.ts";
import type {
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
 * simplest case of all, a ref `App` owns end to end. The two-precedent list above is
 * therefore unchanged by it and must not grow a third entry. What
 * makes it a ref at all is different and simpler: the registry is memoized `[]` for the
 * feed's stability rule, so it cannot close over a value that arrives after the first
 * render, and a ref object is the only thing React guarantees never changes identity.
 *
 * `undefined`, not `null`, because that is what `useRef<FieldHost | undefined>(undefined)`
 * spells and normalising it here would be a conversion whose only purpose is to make two
 * refs look alike. The two answerers therefore test their readiness differently — `null`
 * for the reader, `undefined` for the host — and each tests the value its owner actually
 * writes.
 *
 * @param reader - the `SessionState` projection, filled by `ActionContextProvider`.
 * @param host - the field host, filled by `App`'s engine bootstrap. `undefined` until the
 * engine module has loaded, which is a state `viewport.capture` refuses out loud.
 */
export function createSessionAnswerers(
  reader: RefObject<SessionStateReader | null>,
  host: RefObject<FieldHost | undefined>,
): SessionAnswerers {
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
