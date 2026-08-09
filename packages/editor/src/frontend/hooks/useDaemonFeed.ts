import { type RefObject, useEffect, useState } from "react";
import type { SessionRequest } from "../../shared/wire.ts";
import { subscribeEvents } from "../lib/events.ts";
import type { SessionFeed } from "./useSessionClaim.ts";

/**
 * The daemon's SSE feed, reduced to what the chrome does with it: a version counter
 * that anything rendering the world list refetches on, the hard reload a stale engine
 * bundle needs, and — since foundations T4b — the two frames the session claim rides plus
 * the one the backchannel asks its questions on.
 *
 * It remains the ONE place in the chrome that reads an event `type`. The claim's own
 * logic lives next door in `useSessionClaim` and the answerer's in `useSessionAnswer`;
 * what arrives here are named handlers, so this file learns no policy and neither of those
 * learns the wire.
 *
 * A hook rather than App-local state for the reason Shell's header gives: App owns the
 * WebGPU probe and the dynamic import of /engine.js, neither of which reaches `ready`
 * outside a browser — so a feed wired INSIDE App is a feed no test can drive. Here the
 * gate is a parameter and the whole chain (EventSource → refetch trigger → reload
 * refusal) is reachable from a test.
 *
 * @param ready - the engine bootstrap finished. The feed stays closed until then: a
 * `bundle-outdated` reload before the editor is up would restart a boot already in
 * progress, and nothing is showing a world list yet.
 * @param bakeBusyRef - whether a world write is in flight. A ref rather than state
 * because this subscription re-binds only when `ready` changes, so the handler has to
 * see the CURRENT value without re-subscribing. It must be a STABLE ref (App's `useRef`,
 * or one built outside render): the ref is in this effect's dep list, so an
 * inline-constructed `{ current: … }` re-subscribes on every render — one EventSource
 * opened and closed per render, against a daemon that holds each one.
 * @param session - the claim's three handlers ({@link SessionFeed}). It is in this
 * effect's dep list under the same STABILITY rule as `bakeBusyRef` above, and the cost
 * of breaking it is worse here: a re-subscribe mints a new connection token and
 * re-claims, so an unstable object would make the editor fight itself once per render.
 * @param onRequest - the backchannel's answerer (`useSessionAnswer`), taken as its own
 * parameter rather than folded into `SessionFeed` because it is a different owner: the
 * claim hook cannot supply it and would only be passing it through. Same stability rule as
 * `session`, for the same reason — it is in this effect's dep list.
 * @returns a counter bumped on every `worlds-changed` / `generation-baked` event.
 */
export function useDaemonFeed(
  ready: boolean,
  bakeBusyRef: RefObject<boolean>,
  session: SessionFeed,
  onRequest: (request: SessionRequest) => void,
): number {
  const [worldsVersion, setWorldsVersion] = useState(0);

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents({
      // Nothing to CATCH UP on: the editor mirrors no daemon-owned document, and the
      // field world lives in the host until the user saves it. What a (re)connect does
      // mean is that the previous connection's name is dead — the claim forgets it here
      // and re-asserts on the token frame below, which is the first frame of the new
      // stream and the earliest moment a claim can be made at all.
      onOpen: () => session.onOpen(),
      onEvent: (event) => {
        if (event.type === "session-token") {
          session.onToken(event.token);
          return;
        }
        if (event.type === "claim-lost") {
          session.onLost(event.world);
          return;
        }
        if (event.type === "session-request") {
          // Every field but `type` IS the request (`shared/wire.ts`), so it goes on whole
          // rather than being unpacked into positional arguments — the one arm this file
          // does not have to know the shape of, because both ends import it.
          onRequest(event);
          return;
        }
        if (event.type === "bundle-outdated") {
          // Generator/extension source changed: the engine bundle is stale. A hard
          // reload is the only way to pick it up, and it would kill an in-flight
          // world write, so refuse while one is running (the shell's world verbs
          // hold the ref for the duration of the upload).
          if (!bakeBusyRef.current) window.location.reload();
          return;
        }
        if (
          event.type === "worlds-changed" ||
          event.type === "generation-baked"
        ) {
          // Both mean the worlds directory on disk moved under us (a world verb, or
          // a bake that just wrote one) — anything showing the world list refetches.
          setWorldsVersion((v) => v + 1);
        }
      },
    });
  }, [ready, bakeBusyRef, session, onRequest]);

  return worldsVersion;
}
