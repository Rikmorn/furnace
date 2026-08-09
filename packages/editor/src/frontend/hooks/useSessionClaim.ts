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
 * @param worldNameRef - the world this session is authoring, or null for the untitled
 * scratch. A ref filled by `WorldProvider` for the `bakeBusyRef` reason, one door over:
 * the world lives far below App and the claim is asserted above it. Read at claim time
 * rather than subscribed to, so a world SWITCH does not re-claim — see the filing above
 * for why that costs nothing today (nothing routes by the claim's world; Task 3
 * addresses the CONNECTION).
 * @param openConfirm - App's one confirm seam, which the steal prompt rides like every
 * other destructive question in the chrome.
 */
export function useSessionClaim({
  worldNameRef,
  openConfirm,
}: {
  worldNameRef: RefObject<string | null>;
  openConfirm: (request: ConfirmRequest) => void;
}): { feed: SessionFeed; lost: ClaimLost; claimLostRef: RefObject<boolean> } {
  const tokenRef = useRef<string | null>(null);
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

  const onToken = useCallback(
    (token: string) => {
      tokenRef.current = token;
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
      if (claimLostRef.current) return;
      const world = worldNameRef.current;
      void api.sessionClaim(world, token).catch((err: unknown) => {
        const held =
          err instanceof ApiClientError && err.code === "already-exists";
        if (!held) {
          notify.error(`could not claim this session: ${errorMessage(err)}`);
          return;
        }
        const what = worldPhrase(world);
        openConfirm({
          title: "Another editor session is authoring this world",
          message: `${what} is claimed by another tab or window. Taking over makes THIS tab the one an agent can read and drive; the other one is told it lost the claim and can reload to take it back.`,
          confirmLabel: "Take over",
          onConfirm: () => {
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
    [worldNameRef, openConfirm],
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

  return { feed, lost, claimLostRef };
}
