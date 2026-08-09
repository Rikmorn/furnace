// WHAT RUNNING AN ACTION MEANS — the verdict a run hands back, and the one thing in this
// directory that describes a run rather than a row.
//
// Until foundations T3b2 Task 4 every `run` was `(ctx) => void` and NOTHING read a result,
// because there was none: all 39 returned undefined and failure reached the user by three
// other roads (the host's `reportToolError` channel, a `notify.error` inside the world seam,
// or silence). A result is a NEW channel for all 39, not a widening of an existing one.
//
// THE RECONCILIATION, decided the day this type was born (spec T5's rule) and stated here
// because a reader meeting `ActionResult` is the reader who needs it. There are THREE
// provenances for a sentence the user sees, and each owns its own:
//
//   1. THE HOST's — `reportToolError` → `subscribeToolError` → a toast. 41 CALL sites across
//      `field-host/` at head (33 in `field-host.ts`, 6 in `field-voidcast.ts`, 2 in
//      `field-segment.ts`); the planning digest said 46 because it counted every MENTION of
//      the name — the extra five are one interface declaration, two dep-object passes and
//      two prose mentions, all still there. They are not actions and they do not move. A verb that hands off to
//      the host returns `{ ok: true }` on the hand-off: the host answers for itself, later,
//      on its own channel.
//   2. THE WORLD SEAM's — `frontend/lib/world-actions.ts` composes and says its own save and
//      load sentences ("bake failed: ENOSPC"). Same shape as the host's, one layer up: a
//      seam with its own voice.
//   3. THE ACTION's — this type. The dispatcher (`runAction` in `frontend/lib/actions.ts`)
//      is the one funnel for a NAMED action, and it says a {@link ActionResult} out loud
//      exactly once. Since foundations T4a it has a sibling, `runMember`, for picking a
//      member out of a tool family: same gate, same voice, same Result — a second way into
//      an existing row rather than a fourth provenance. The rule below binds both.
//
// WHICH IS WHY THERE ARE TWO NON-OK KINDS AND NOT ONE. `refused` is a verdict the action
// itself reached and NOBODY has said yet, so the funnel says it. `failed` is an error a
// layer below already surfaced on its own channel — the Result carries it to a caller who is
// not looking at the screen (an MCP tool call gets the Result; a human already got the
// toast), and the funnel stays quiet rather than saying it twice. Three provenances, never a
// doubled toast — and the funnel of clause 3 is the pair above, which is one rule and two
// doors, not two rules.
//
// Here rather than in the chrome because the daemon is the consumer that makes the type
// worth having: an agent calling a verb needs the verdict, and it runs on Node.

/** What running an action MEANS.
 *
 *  - `{ ok: true }` — it ran, or it handed off to a layer that will answer for itself.
 *  - `refused` — the action's OWN verdict, with the sentence that used to be a
 *    `notify.error` call inside the verb. The dispatcher says it; see the module header.
 *  - `failed` — an error SURFACED rather than thrown past the dispatcher. The layer that
 *    raised it owns its channel and has already said it; this carries the fact to a caller
 *    who cannot see the screen. */
export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "refused"; readonly message: string }
  | { readonly ok: false; readonly kind: "failed"; readonly message: string };

/** The verdict of a verb that ran, or that handed off to a channel of its own. A shared
 *  frozen value rather than a fresh literal per run: it carries no payload, most of the table
 *  returns it and nothing may mutate a verdict. (No count — see the note on `handOff` in
 *  `frontend/lib/actions.ts` for why this file states none.) */
export const ACTION_OK: ActionResult = Object.freeze({ ok: true });

/** The action's own refusal, WITH the sentence. Said once, by the dispatcher. */
export const refused = (message: string): ActionResult => ({
  ok: false,
  kind: "refused",
  message,
});

/** An error surfaced from a layer that has already reported it on its own channel. */
export const failed = (message: string): ActionResult => ({
  ok: false,
  kind: "failed",
  message,
});
