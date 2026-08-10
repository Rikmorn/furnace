// PRESENCE-LITE: that an agent is working in this tab, and what it last did (foundations
// T4c, Task 5).
//
// WHY THE CHROME SAYS ANYTHING AT ALL, given that T4b decided it would not. That decision
// was about the ANSWER — a question an agent asks must not interrupt the person sitting in
// the tab — and it stands untouched below. What T4b did not have was verbs: an agent could
// only read, so there was nothing happening that the human could not already see. T4c gives
// it hands, and a world that changes under someone with no indication of who changed it is a
// worse silence than a toast would have been. So the chrome states the FACT (an agent ran
// something, and this was the last one) and nothing else.
//
// WHAT IT DELIBERATELY IS NOT: a chat surface, a transcript, a log of agent actions, or a
// channel for what an agent was REFUSED. The refusals stay quiet on screen — they are about
// the asker, they are answered to the asker, and a human who did not ask cannot act on one.
// This module cannot say a refusal even if a caller wanted it to: nothing here takes an
// outcome (see `ran`).
//
// IT IS ALSO NOT ATTRIBUTION. It says nothing about which op in the log came from an agent;
// that needs a field on `LogEntry` and a wire-format decision, is fenced to post-T4 by user
// ruling, and is designed together with the agent undo verb. A reader who mistakes this for
// attribution would conclude the last verb OWNS the last edit, which is exactly the kind of
// join T4c spent a whole member removing (`shared/wire.ts`'s `ArmedState`).
//
// FRAMEWORK-FREE, the `notify-store.ts` discipline: subscribe/getSnapshot is the
// `useSyncExternalStore` contract and nothing more, so what is recorded and what is shown are
// decided in one place a bare test can drive with no DOM. It needs no injected clock, because
// it records no time — see {@link AgentPresence}.
//
// THERE IS NO SINGLETON HERE, and that is the one place this module departs from
// `notify-store.ts`. `notify` is a module constant because its two ends are unrelated surfaces
// all over the chrome (any host refusal, the toast stack, the ⚠ chip, the log palette); this
// store has exactly one writer and one reader, both inside one App, so it is CREATED by App
// and travels on `EditorContext` — the route `sessionStateRef` and `bakeBusyRef` already take.
//
// The choice was made twice. A module singleton was written first, and the full suite caught
// it before it left the task: every chrome test file is a second shell in one process, so a case
// asserting "no agent has been here" read the verb an earlier FILE had recorded. That hazard
// is written down in this chrome already — `useFieldHostState.tsx`'s cells are created per
// provider and *"never module-level: two shells in one process, which every chrome test file
// is, must not share"* — and the remedy `notify` uses for it is a per-suite reset that
// SIXTEEN test files carry as `afterEach(() => notify.clear())` (a seventeenth,
// `chrome/material-swatches.test.tsx`, calls it inline mid-case). That remedy works only
// because `clear` has a production caller — the log palette's Clear verb — so it is a real
// method the tests borrow rather than a hatch cut for them.
// Inventing one here to serve the tests would have been a test-only API wearing a
// justification; the ownership was simply wrong.

/** What the chrome knows about the agent working in this tab.
 *
 *  TWO FIELDS AND NO TIMESTAMP, which is the whole scope of "lite". A time would demand a
 *  policy — does the indicator fade, at what age, and does a stale one mean the agent LEFT? —
 *  and none of those questions has an answer this substrate can give: an agent that stops
 *  asking is indistinguishable from one that is thinking, and the claim (`useSessionClaim`)
 *  is what actually knows whether anybody is there. Recording no time is what keeps this
 *  honest rather than merely small.
 *
 *  `count` earns its place by making REPEAT activity legible: an agent polling one method
 *  moves nothing else here, and an indicator that never changes under a busy agent reads as
 *  a dead one. */
export type AgentPresence = {
  /** The last method this tab RAN for an agent — `null` until it has run one. It is the
   *  wire's own method name (`edit.apply`, `session.state`), verbatim and unmapped: a
   *  friendlier label would be a second vocabulary to keep in step with a registry that is
   *  a plain record, and it would drift silently the first time a method was added. */
  readonly verb: string | null;
  /** How many have run, this tab's lifetime. */
  readonly count: number;
};

export type AgentPresenceStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AgentPresence;
  /** Record that a method RAN — called by the backchannel seam once it has resolved a
   *  handler and is about to invoke it.
   *
   *  AT THE POINT OF DISPATCH RATHER THAN OF ARRIVAL, and the difference is a real one: a
   *  method this tab does not serve (version skew between a restarted daemon and an older
   *  tab) is refused by the seam and never runs, so naming it here would put a verb on the
   *  status bar that nothing in this editor did.
   *
   *  IT TAKES NO OUTCOME, and that is a decision the type enforces rather than a convention
   *  the caller keeps: the indicator says what ran, never how it went. A refused
   *  `edit.apply` and an applied one are the same fact here, which is what "agent-caused
   *  refusals stay quiet on screen" means when it is built rather than promised. */
  ran(verb: string): void;
};

const NOBODY: AgentPresence = { verb: null, count: 0 };

export function createAgentPresence(): AgentPresenceStore {
  const listeners = new Set<() => void>();
  // The cached snapshot, replaced on every record. `useSyncExternalStore` compares
  // getSnapshot's RESULT by identity, so a fresh object per call would re-render every
  // consumer on every render, for ever — `notify-store.ts`'s rule, and the same trap.
  let snapshot: AgentPresence = NOBODY;
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    ran: (verb) => {
      snapshot = { verb, count: snapshot.count + 1 };
      for (const listener of listeners) listener();
    },
  };
}

/** Nothing is exported below this line, deliberately — see the header. `App` makes the one
 *  store a tab has and puts it on `EditorContext`; `useSessionAnswer` writes it and
 *  `StatusBar`'s chip reads it. */
