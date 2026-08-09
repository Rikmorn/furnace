import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import { ApiClientError, api } from "../lib/api.ts";
import { errorMessage, worldPhrase } from "../lib/humanize.ts";
import { notify } from "../lib/notify-store.ts";

/** What this session lost, once another one took it. `null` while it still holds (or
 *  never held) its claim — the overlay renders from exactly this. */
export type ClaimLost = { world: string | null } | null;

/** The three feed frames the claim cares about, as named handlers rather than one
 *  `onEvent` — `useDaemonFeed` stays the ONE place in the chrome that reads an event
 *  `type`, and this hook never learns the wire.
 *
 *  THIS OBJECT MUST BE STABLE ACROSS RENDERS. It sits in the feed effect's dep list, so
 *  a fresh identity per render opens and closes one `EventSource` per render — and the
 *  cost here is worse than the churn that warning carries for `bakeBusyRef`, because
 *  every reconnect mints a NEW token and re-claims. {@link useSessionClaim} keeps `lost`
 *  out of this object for that reason: losing a claim must not re-subscribe the feed
 *  that would then re-claim it. */
export type SessionFeed = {
  onOpen(): void;
  onToken(token: string): void;
  onLost(world: string | null): void;
};

/**
 * The chrome's half of the session claim (foundations T4b): assert that THIS tab is the
 * one an agent may drive, offer to take over when another tab already is, and say so
 * when another tab takes over from us.
 *
 * WHY THE CLAIM RIDES THE TOKEN FRAME AND NOT `onOpen`, which is where the plan's
 * sketch put it. It could not ride `onOpen`: the token a claim must present is minted
 * when the daemon accepts the subscription and arrives as the stream's FIRST frame, so
 * at `onopen` there is nothing to present yet and a claim sent there could only be
 * refused. The token frame is the strictly stronger signal — it means "connected AND
 * named" — and it fires on every reconnect, which is exactly the set of moments a
 * connection-scoped claim has to be re-asserted at. `onOpen` keeps the one job it can
 * honestly do: FORGET the dead connection's token, so a POST cannot go out carrying a
 * name the daemon has already dropped.
 *
 * WHY A REFUSAL IS NOT NORMALLY WHAT A RELOAD GETS, which is the reasonable worry about
 * refusing a second claim at all. The daemon drops a claim 3.5 ms after its connection
 * dies (measured, T4b Task 0), and this feed is opened only at engine-ready — i.e.
 * after a fresh document has fetched its bundle, booted React, probed WebGPU and pulled
 * `/engine.js`, which the daemon BUILDS on demand. The old tab's claim is long gone by
 * then. The overlapping order is reachable in principle (the spike measured a new
 * subscribe landing 52 ms before an old close), and its outcome is this dialog: one
 * click, never a wedge, and never a silently unclaimed session.
 *
 * TRUE READ-ONLY MODE IS NOT BUILT. The settled policy says a second tab gets "read-only
 * or an explicit steal"; this tranche ships the steal and a blocking claim-lost overlay,
 * and a tab that declines to steal keeps every control it had — it simply is not the
 * session an agent reaches. That narrowing is deliberate and is filed with its trigger
 * at `docs/backlog/editor-and-tooling/read-only-chrome-for-an-unclaimed-session.md`.
 *
 * WHICH IS EXACTLY WHY THE COVER SUPPRESSES THE KEYBOARD, and why `claimLostRef` exists beside
 * `lost`. With no read-only mode, the cover is the WHOLE enforcement of that narrowing:
 * a tab that authors on behind it is the failure the policy was written against. A
 * pointer cannot reach past a full-viewport layer, but the window keydown listener never
 * saw one — so `useGlobalKeybindings` reads this ref and returns before it matches
 * anything. A SEPARATE ref rather than `confirmRef`, deliberately: that one also feeds
 * `ctx.isConfirmOpen()` into the gate env, so reusing it would make a claim-lost refusal
 * answer `because: "modal"` — a lie in the vocabulary T4a's first task built.
 *
 * THE CLAIM RE-KEYS ON A WORLD SWITCH (T4c), and the version of this hook that did not is
 * what the sentence here used to defend: the world was read at claim time, never
 * subscribed to, "because nothing routes by the claim's world". That reasoning expired
 * inside its own tranche. T4b Task 3 made the global claim COUNT load-bearing through
 * `soleTarget()`, and a key that lies composes with it: a tab that boots on the untitled
 * scratch, claims `null`, and is then pointed at world `W` holds `null` while authoring
 * `W`, so a SECOND tab opening `W` claims it with no conflict, no steal prompt and no
 * toast — two claims, and every agent read from then on is the two-claims refusal with
 * nothing anywhere explaining why. The conflict test only works if the key is true.
 *
 * ONE COMMAND DOES THE RE-KEY, not two, and that is the claim table's own design rather
 * than a shortcut: a connection holds AT MOST ONE world, so a successful claim of `W`
 * drops `null` in the same step (`daemon/claims.ts`). {@link api.sessionRelease} is
 * therefore reached only on the REFUSED path, where the old key would otherwise survive.
 *
 * @param openConfirm - App's one confirm seam, which the steal prompt rides like every
 * other destructive question in the chrome.
 */
export function useSessionClaim({
  openConfirm,
}: {
  openConfirm: (request: ConfirmRequest) => void;
}): {
  feed: SessionFeed;
  lost: ClaimLost;
  claimLostRef: RefObject<boolean>;
  setAuthoredWorld: (world: string | null) => void;
} {
  const tokenRef = useRef<string | null>(null);
  // The world this tab is authoring, and the key every claim goes out under. It lives HERE
  // rather than in a ref App hands down, which is the shape it had through T4b: the claim
  // is the only reader, and the write is now an EVENT (re-key under the new name) rather
  // than a value someone else's reader picks up later. A ref that two parties agreed to
  // read at the right moment cannot express that, and the moment it has to is the one the
  // stale-key defect was made of.
  const worldRef = useRef<string | null>(null);
  const [lost, setLost] = useState<ClaimLost>(null);
  // The same fact as `lost`, written SYNCHRONOUSLY for the one reader that cannot wait
  // for a commit: the window keydown listener binds once and must see the current value
  // (`useConfirmDialog`'s `confirmRef` is this exact pattern, one door over).
  const claimLostRef = useRef(false);

  const onOpen = useCallback(() => {
    // The previous connection is gone and its name with it. Clearing here rather than
    // overwriting on the next token means the window between a reconnect and its token
    // frame holds NO token, so nothing can post one the daemon would answer
    // `no-session` to.
    tokenRef.current = null;
  }, []);

  /** Assert this tab's claim on `world` over `token`, and handle every way that can go.
   *
   *  ONE BODY FOR BOTH ROUTES IN — a fresh connection's token frame, and a world switch on
   *  a live one — because a refusal has to mean the same thing whichever reached it. Two
   *  copies is how the switch path ends up with, say, a steal prompt and no release. */
  const claimUnder = useCallback(
    (world: string | null, token: string) => {
      // A LOST TAB NEVER CLAIMS AGAIN, and the reachable case is routine rather than
      // exotic: B steals from A, A raises the cover, then the daemon restarts (the
      // `bun run edit` loop does this on every source change) or the stream blips —
      // `EventSource` reconnects BOTH tabs, and without this line A re-claims and may win
      // the race, because the daemon has no memory of who lost what. A would then HOLD
      // the claim while displaying "another editor session took over" and suppressing its
      // own keyboard: an agent driving "the session" wired to a tab the human cannot
      // operate, and B — the tab the human is actually in — refused and steal-prompted.
      //
      // The cover's own sentence is what makes the early return the right shape rather
      // than clearing `lost` on a successful re-claim: it says RELOAD to claim it back,
      // and a reload is the one thing that legitimately produces a fresh tab with no
      // memory of having lost. Clearing instead would mean rewording the cover to promise
      // something it cannot deliver — the re-claim is a race it can lose.
      //
      // It guards the WORLD SWITCH too, and has to: a covered tab whose human loads
      // another world would otherwise claim its way back in behind the cover.
      if (claimLostRef.current) return;
      void api.sessionClaim(world, token).catch((err: unknown) => {
        // THE AUTHORED WORLD CAN MOVE UNDER THIS CATCH — narrowly, and the narrow version
        // is what this says, because the obvious example does not hold. Two world OPENS
        // cannot overlap: `useWorld.tsx`'s `open` serialises on `inFlight` and writes the
        // name only after its own daemon round trip, so a second open cannot outrun a
        // localhost `session.claim`. What CAN land inside this window is a world change
        // that talks to no daemon — `reset()` and the delete path both `setName(null)`
        // synchronously.
        //
        // The cost if it does is the same as the prompt's below: the release would drop a
        // claim taken since, and the prompt would name a world the tab has left. This is
        // the cheaper of the two guards and the less reachable; the one in `onConfirm`
        // holds the human-scale window and is the one with a pin of its own.
        //
        // A bare return, and it covers the non-409 arm too: the newer claim is already in
        // flight and will report its own failure if it has one. A toast about a question
        // this tab has stopped asking is noise with a wrong subject.
        //
        // VALUE-BASED, so `W → U → W` inside one round trip defeats it and the late 409
        // releases the `W` claim the third switch just won. Named rather than closed: a
        // sequence counter is machinery for an order nothing in the chrome can currently
        // produce, and the failure it would prevent is one unclaimed tab.
        if (worldRef.current !== world) return;
        const held =
          err instanceof ApiClientError && err.code === "already-exists";
        if (!held) {
          notify.error(`could not claim this session: ${errorMessage(err)}`);
          return;
        }
        // A REFUSED CLAIM LEAVES THIS TAB UNCLAIMED, which is what the connect path gets
        // for nothing (a fresh connection holds no world) and the switch path does not:
        // the daemon drops the old key only when a new claim SUCCEEDS, so without this a
        // tab refused `W` would go on holding the `null` it had already left — the exact
        // lying key this re-key exists to end, now produced by the fix. Not conditioned on
        // which route arrived here: on the connect path it releases nothing, and one
        // meaning for one refusal is worth more than one saved round trip.
        //
        // Swallowed, because reaching this line means the daemon answered — so the only
        // way the release fails is a token that died between the two posts, and a dead
        // connection has already had everything it held released.
        void api.sessionRelease(token).catch(() => undefined);
        const what = worldPhrase(world);
        openConfirm({
          title: "Another editor session is authoring this world",
          message: `${what} is claimed by another tab or window. Taking over makes THIS tab the one an agent can read and drive; the other one is told it lost the claim and can reload to take it back.`,
          confirmLabel: "Take over",
          onConfirm: () => {
            // THE WORLD MOVES UNDER THIS PROMPT TOO, and here the window is HUMAN-scale
            // rather than the catch's milliseconds — which makes this the more reachable
            // of the two, not the less. `WorldProvider`'s boot restore is the automated
            // world-changer that runs while a modal stands: on a clean session it opens
            // the remembered world without a discard confirm, so it never trips
            // `openConfirm`'s never-clobber guard, and the catalog it waits on can settle
            // long after this 409 did.
            //
            // Stealing the world this prompt NAMES would then be strictly destructive:
            // `claims.steal` drops everything the connection holds before it takes
            // (`take` → `dropAll`), so it would revoke the claim the restore legitimately
            // just won, hand a `claim-lost` cover to whoever holds the named world, and
            // report success for both. The user would be back to a tab holding a key it
            // is not authoring — the defect this whole re-key exists to end, manufactured
            // by its own remedy.
            //
            // Silent, like the dead-token bail below: the question the user answered is
            // no longer this tab's question, and the world it moved to has already
            // claimed for itself.
            if (worldRef.current !== world) return;
            // Re-read rather than close over `token`: the user answers a prompt at
            // human speed, and the feed may have reconnected under it. A dead token
            // would earn `no-session`, so the honest move is to let the NEW token's
            // claim (already in flight by then) be the attempt.
            const current = tokenRef.current;
            if (current === null) return;
            void api
              .sessionSteal(world, current)
              .then(() => notify.success("this tab is now the editing session"))
              .catch((stealErr: unknown) => {
                notify.error(`could not take over: ${errorMessage(stealErr)}`);
              });
          },
        });
      });
    },
    [openConfirm],
  );

  const onToken = useCallback(
    (token: string) => {
      tokenRef.current = token;
      claimUnder(worldRef.current, token);
    },
    [claimUnder],
  );

  /**
   * The world this tab is authoring has changed — re-key the claim under it.
   *
   * `WorldProvider` is the caller, from the one effect that already tracked the name
   * (`useWorld.tsx`), and it rides the editor context to get here because the world lives
   * far below `App` while the claim is asserted above it. A VERB travelling down rather
   * than a ref travelling up, which is the whole difference from the T4b shape: the switch
   * is an event, and only the party that owns the claim can decide what an event means.
   *
   * VALUE-GUARDED, and honestly: the guard is INSURANCE, not a live requirement. The claim
   * it protects against is a caller reporting the same world twice, and today nothing can —
   * `WorldProvider`'s effect has `[name, setAuthoredWorld]` for deps, this callback is
   * stable all the way down (`openConfirm` is a `useCallback` over `[]`), and `main.tsx`
   * renders without `StrictMode`, so React elides the re-run before it reaches here. Any of
   * those three moving makes it matter, and a re-post is a wasted round trip rather than a
   * fault, so it is kept and labelled rather than defended. Unlike `CanvasHost`'s teardown
   * chain — the other thing T4c left without a caller — this one is directly exercisable,
   * because the verb is exposed: `tests/chrome/session-claim.test.tsx` calls it twice.
   *
   * NO TOKEN, NO POST. Between a reconnect and its token frame this tab has no name to
   * present, and there is nothing to re-key anyway — `onToken` claims under whatever
   * `worldRef` holds by the time it arrives.
   */
  const setAuthoredWorld = useCallback(
    (world: string | null) => {
      if (worldRef.current === world) return;
      worldRef.current = world;
      const token = tokenRef.current;
      if (token === null) return;
      claimUnder(world, token);
    },
    [claimUnder],
  );

  const onLost = useCallback((world: string | null) => {
    claimLostRef.current = true;
    setLost({ world });
  }, []);

  // Every member is a `useCallback` over stable deps, so this object is built once —
  // which is the contract `SessionFeed` states, and the feed effect depends on it.
  const feed = useMemo<SessionFeed>(
    () => ({ onOpen, onToken, onLost }),
    [onOpen, onToken, onLost],
  );

  return { feed, lost, claimLostRef, setAuthoredWorld };
}
