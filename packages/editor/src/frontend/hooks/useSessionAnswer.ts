import { useCallback } from "react";
import type { SessionRequest } from "../../shared/wire.ts";
import type { AgentPresenceStore } from "../lib/agent-presence.ts";
import { api } from "../lib/api.ts";
import { errorMessage } from "../lib/humanize.ts";
import type { SessionAnswerers } from "../lib/session-answerers.ts";

/**
 * The chrome's half of the backchannel (foundations T4b): a `session-request` frame
 * arrives on this tab's feed, a handler answers it, and the answer goes back as a POST
 * correlated by the request's own id.
 *
 * **NOTHING HERE INTERRUPTS THE HUMAN, and since T4c that is narrower than "invisible".**
 * The rule this seam was built on stands unchanged and is the important half: an agent's
 * question — and any refusal it earns — must not announce itself to the person sitting in the
 * tab. A refusal is about the ASKER, is answered to the asker, and is something a human who
 * did not ask cannot act on. So no toast, no dialog, no error line, either way.
 *
 * What changed is that T4b's agent could only READ, and T4c's can dig, generate, run verbs
 * and interrupt. A world changing under someone with no indication that anyone else is
 * working in it is a worse silence than the one this rule was written against — so the seam
 * records **presence-lite**: that a verb ran, and which one (`lib/agent-presence.ts`, which
 * carries the whole argument and the list of things it deliberately is not). It records no
 * outcome, so the quiet-refusals rule is kept by the SHAPE of the seam rather than by care
 * here — there is nothing to pass.
 *
 * **RECORDED AFTER THE LOOKUP, NEVER BEFORE**, which is the one ordering fact in this
 * function: a method the registry does not serve is refused below and never runs, and putting
 * it on the status bar would name a verb this editor did not perform.
 *
 * WHY IT MOUNTS AT `App` rather than beside `useActionContext`, which is where the facts
 * a richer method would need are already latched. Two reasons, and the second is the one
 * that decided it. (1) `session.ping` reads nothing, so structure bought for a method that
 * does not exist would be structure bought on a guess. (2) The chrome already has a NAMED
 * PATTERN for "a fact that lives far below App, read above it" —
 * `bakeBusyRef` and `viewportFocusRef` are each created in `App` and filled
 * from below. (This sentence named `claimLostRef` as one of them until T4b Task 4: that one
 * is created AND written inside `useSessionClaim`, a hook `App` itself calls, so only its
 * reader sits below and it is not this pattern. `viewportFocusRef` — `App`'s, installed by
 * `CanvasHost` — is, and `session.state`'s reader ref is the third. It named `worldNameRef`
 * too, until T4c retired that ref: the claim's world is no longer a value read from above
 * but a verb called from below, `setAuthoredWorld`, because a ref cannot say "this
 * CHANGED".) A method needing selection or camera can take the same route, so
 * mounting low is not the only way to reach low facts, and mounting HERE keeps the answerer
 * beside the one subscription that feeds it. The registry is a parameter either way, which
 * is what makes the mount point movable if that judgement turns out wrong.
 *
 * @param answerers - method → handler ({@link SessionAnswerers}). MUST BE STABLE across
 * renders: the callback returned from here lands in `useDaemonFeed`'s effect dep list,
 * where a fresh identity per render opens and closes one `EventSource` per render — the
 * same rule, and the same cost, that `SessionFeed` states for itself. A module constant
 * (today's `BASE_ANSWERERS`) or a `useMemo` satisfies it; an object literal at the call
 * site does not.
 * @param presence - where a served method is recorded (`lib/agent-presence.ts`). STABLE for
 * `answerers`' reason exactly — it lands in the same dep list — which `App` satisfies by
 * holding it in `useState`. Passed rather than imported, because a module singleton would be
 * one store shared by every shell in the process; that module's header carries the argument
 * and the bug that made it.
 * @returns the feed's `session-request` handler.
 */
export function useSessionAnswer(
  answerers: SessionAnswerers,
  presence: AgentPresenceStore,
): (request: SessionRequest) => void {
  return useCallback(
    (request: SessionRequest) => {
      const failed = (err: unknown): string =>
        `this editor session failed to answer "${request.method}": ${errorMessage(err)}`;

      const refuse = (error: string): void => {
        void api
          .sessionAnswer({ requestId: request.requestId, ok: false, error })
          .catch(() => {
            // TERMINAL, and deliberately silent — the only `.catch` in this seam that stays
            // a no-op. A refusal body is `{requestId, ok: false, error}`: three primitives
            // that always serialize, so the ways this POST can fail are the network and the
            // daemon being gone, and neither is something a retry or a second refusal could
            // repair. The asker then gets `session-timeout`, which is the honest outcome
            // when the answer could not travel at all, and it is delivered to the party the
            // failure concerns. A toast would tell the human about a question they did not
            // ask and cannot fix.
          });
      };

      const answer = (payload: unknown): void => {
        void api
          .sessionAnswer({ requestId: request.requestId, ok: true, payload })
          .catch((err: unknown) => {
            // THE FIFTH FAILURE MODE, and until spec review the only one this seam did not
            // convert. A handler's payload can fail INSIDE the POST — a cycle, a `BigInt`, a
            // throwing `toJSON` all raise in `call`'s `JSON.stringify` — and that is a
            // handler's own bug, exactly the class the four above are converted for. Left
            // silent it produced the misleading timeout the whole design is written against.
            //
            // The refusal is worth attempting precisely BECAUSE the cause is local: the seam
            // caused this one, and a refusal body always serializes (see `refuse`), so where
            // a network failure is unrepairable this is one POST away from an honest answer.
            refuse(failed(err));
          });
      };

      const handler = answerers[request.method];
      if (handler === undefined) {
        // ANSWERED, NOT IGNORED — the difference between an agent that reloads a stale tab
        // and one that retries a "timeout" forever. The reachable route is version skew:
        // the daemon restarts on every source change in the `bun run edit` loop while this
        // tab keeps its bundle, so a daemon can know a method this chrome has never heard
        // of. Naming what IS served turns the refusal into a diagnosis.
        refuse(
          `this editor session has no answerer for "${request.method}" — it serves ${Object.keys(answerers).join(", ")}`,
        );
        return;
      }
      // PRESENCE-LITE (T4c): a verb this tab really serves is about to run. Here rather than
      // at the top of the callback for the reason the header states — the refusal above is
      // not a verb — and before the call rather than after it because an answer may be a
      // promise: recording on settle would leave the indicator silent for the whole of a
      // capture or a generate, which are exactly the two the human most wants to know about
      // while they are happening.
      presence.ran(request.method);
      // A handler that fails is the same failure as a method that is missing, from the
      // asker's side: no answer is coming. Converting it here is what keeps "never a hang" a
      // property of the SEAM rather than a promise each future handler has to keep for
      // itself — and there are FIVE ways to fail, not one. A handler may return a value or a
      // promise of one, and may THROW or REJECT; the fifth is its payload failing to
      // serialize, which happens on the answer's own return leg and is caught in `answer`.
      try {
        // `Promise.resolve` NORMALIZES the two return shapes, and it is load-bearing rather
        // than defensive: `SessionAnswerers` permits an async handler, so calling `answer`
        // on the raw return would post `payload: {}` for one — a promise JSON-stringifies to
        // an empty object — and its rejection would escape as an unhandled one. That is a
        // POSITIVE claim about an answer that never arrived, which is the one thing the
        // backchannel must never make, and it is worse than the silence this seam already
        // converts because it looks like success at both ends.
        //
        // Async is SUPPORTED rather than forbidden — the type could have banned a promise
        // and made this a compile error instead. It is not the right trade: some chrome
        // facts sit behind a worker round trip, and a seam that only serves synchronous
        // answers pushes that work into a fire-and-forget inside a sync handler, which is
        // the same silence one door over. The daemon's 10 s budget only means something if
        // the seam can wait. What makes it safe is the correlation id: answers may now come
        // back out of order, which is the table's whole reason for existing.
        void Promise.resolve(handler(request.params)).then(
          answer,
          (err: unknown) => {
            refuse(failed(err));
          },
        );
      } catch (err) {
        // The synchronous throw, which the promise path CANNOT catch: `handler(…)` throws
        // before `Promise.resolve` is ever handed a value. Both arms are needed.
        refuse(failed(err));
      }
    },
    [answerers, presence],
  );
}
