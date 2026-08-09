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

/** WHY a refusal happened, as a CLASS rather than as a sentence — the one part of a
 *  {@link ActionResult} written for a caller that cannot read.
 *
 *  THE MESSAGE IS NOT A KEY. `refused`'s `message` is prose addressed to whoever is looking
 *  at the screen, and it is free to be reworded the moment the wording gets better; a caller
 *  branching on it breaks on a moved comma. `because` is the half that may be depended on —
 *  it names the CLASS and says nothing about how the class reads.
 *
 *  WHAT EACH ONE TELLS A CALLER TO DO, which is the whole reason a class beats a sentence:
 *
 *  - `modal` — a confirm dialog is up and owns the answer. TRANSIENT and not about the
 *    request at all: a human is being asked something. Retry once it closes.
 *  - `typing` — a text field has the keyboard, so this KEY is a character someone is typing.
 *    Transient, and a KEY caller's refusal only: naming the verb runs it.
 *  - `looking` — the right button is held and the look drag owns this letter. Same shape as
 *    `typing`: transient, key-caller only.
 *  - `menuOnly` — no key runs this verb. NOT transient and not about state: it is a property
 *    of the verb, and it too is a KEY caller's refusal, so a NAMED caller that ever sees this
 *    has found a bug rather than a locked door.
 *  - `session` — a stamp session owns the interaction and this verb would re-arm LMB. The one
 *    class a human is told about out loud, and the caller holds the two verbs that end it
 *    (`session.confirm` applies, `session.escape` discards).
 *  - `inert` — the verb cannot act on what it has: no world name, no selected stamp, no
 *    engine up yet, no generators registered, an argument it cannot use. Changing the state
 *    changes the answer, but the caller must change SOMETHING — an immediate retry gets the
 *    same word back. RAISED IN TWO PLACES and it is one class, not two spellings: the
 *    canonical one is the funnel's own (`refuseOrClaim` — the gate is OPEN and `enabled` is
 *    false, which is why the verb's LABEL is the honest sentence there), and the second is a
 *    verb's own body finding mid-run that what it needs is not there.
 *  - `member` — the tool family has no member by that id ({@link ActionResult} reaches this
 *    only through the member funnel). The one class about the REQUEST rather than the state:
 *    a retry cannot help, the id has to change, and the sentence lists the ids that exist.
 *
 *  FIVE OF THE SEVEN ARE THE GATE'S (`modal`, `typing`, `looking`, `menuOnly`, `session`) and
 *  two are raised past it — `inert` by the funnel and by verb bodies, as its own bullet
 *  states, and `member` at the member funnel's front door. Which side a class comes from is
 *  not a distinction a caller needs, which is why there is one union and not two.
 *
 *  NO `input` CLASS TODAY, deliberately: two of the refusals carrying `inert` are really about
 *  an ARGUMENT rather than about state, and splitting the class is a decision with no caller
 *  to settle it yet. That is the one thing this docblock owes a reader here — a split would be
 *  a WIDENING, which is why the union is exported rather than inlined into the arm below. The
 *  two sites, the candidate shape and the trigger are held in
 *  `docs/backlog/editor-and-tooling/refusal-class-has-no-input-arm.md`, whose job that is. */
export type RefusalClass =
  | "modal"
  | "typing"
  | "looking"
  | "menuOnly"
  | "session"
  | "inert"
  | "member";

/** What running an action MEANS.
 *
 *  - `{ ok: true }` — it ran, or it handed off to a layer that will answer for itself.
 *  - `refused` — the action's OWN verdict, with the sentence that used to be a
 *    `notify.error` call inside the verb, and — since foundations T4b — the
 *    {@link RefusalClass} that sentence is an instance of. The dispatcher says it; see the
 *    module header.
 *  - `failed` — an error SURFACED rather than thrown past the dispatcher. The layer that
 *    raised it owns its channel and has already said it; this carries the fact to a caller
 *    who cannot see the screen.
 *
 *  ONLY `refused` CARRIES A CLASS. A `failed` is by definition a message from a layer BELOW
 *  this one, and this file cannot classify what it did not decide — its own union would be
 *  the set of things that can go wrong inside the engine, the daemon and the filesystem,
 *  which is not a set anyone can close. A refusal is the action's own verdict, so the action
 *  layer is exactly the layer that can name its kinds. */
export type ActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "refused";
      readonly message: string;
      readonly because: RefusalClass;
    }
  | { readonly ok: false; readonly kind: "failed"; readonly message: string };

/** The verdict of a verb that ran, or that handed off to a channel of its own. A shared
 *  frozen value rather than a fresh literal per run: it carries no payload, most of the table
 *  returns it and nothing may mutate a verdict. (No count — see the note on `handOff` in
 *  `frontend/lib/actions.ts` for why this file states none.)
 *
 *  DECLARED AS THE ARM IT IS, not as the whole union — the rule for all three constructors
 *  below, stated here once. A signature narrower than {@link ActionResult} can then still be
 *  built from them: `ToolFamilyMember.arm` promises `ok` or `refused` and the TYPE holds it,
 *  which it cannot do while the one `ok` value and the one `refused` factory each claim they
 *  might be a `failed`. Every one of them is assignable to {@link ActionResult} exactly where
 *  it was before; this only stops them being LESS precise than what they return. */
export const ACTION_OK: Extract<ActionResult, { ok: true }> = Object.freeze({
  ok: true,
});

/** The action's own refusal, WITH the sentence and the class it is an instance of. Said once,
 *  by the dispatcher.
 *
 *  `because` is REQUIRED and has no default. A default would be one of two things: a real
 *  class, which every call site that forgot to think would then silently claim, or a
 *  `"other"` that is an eighth class with a name that admits nothing — and a discriminant
 *  whose commonest value means "nobody decided" is not one a caller can branch on. The type
 *  error at a new refusal site is the whole mechanism: naming the class is one word, and it
 *  is asked at the only moment anyone knows the answer. */
export const refused = (
  message: string,
  because: RefusalClass,
): Extract<ActionResult, { kind: "refused" }> => ({
  ok: false,
  kind: "refused",
  message,
  because,
});

/** An error surfaced from a layer that has already reported it on its own channel. Typed as
 *  its own arm, per the rule at {@link ACTION_OK}. */
export const failed = (
  message: string,
): Extract<ActionResult, { kind: "failed" }> => ({
  ok: false,
  kind: "failed",
  message,
});
