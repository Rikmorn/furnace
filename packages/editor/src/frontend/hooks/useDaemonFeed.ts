import { type RefObject, useEffect, useState } from "react";
import { subscribeEvents } from "../lib/events.ts";

/**
 * The daemon's SSE feed, reduced to the two things the chrome does with it: a version
 * counter that anything rendering the world list refetches on, and the hard reload a
 * stale engine bundle needs.
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
 * @returns a counter bumped on every `worlds-changed` / `generation-baked` event.
 */
export function useDaemonFeed(
  ready: boolean,
  bakeBusyRef: RefObject<boolean>,
): number {
  const [worldsVersion, setWorldsVersion] = useState(0);

  useEffect(() => {
    if (!ready) return;
    return subscribeEvents({
      // Nothing to catch up on: the editor mirrors no daemon-owned document. The
      // field world lives in the host until the user saves it.
      onOpen: () => undefined,
      onEvent: (event) => {
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
  }, [ready, bakeBusyRef]);

  return worldsVersion;
}
