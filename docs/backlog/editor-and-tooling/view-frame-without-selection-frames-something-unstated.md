# `view.frame` with nothing selected returns `ok:true` and moves the camera — to where?

Filed at the T4c gate walk (2026-08-11) — demonstrated live.

## Context

The walk's agent called `action_run {id:"view.frame"}` with no selection standing. The
result was `{ok:true}` and the human's camera moved (yaw 0.6 → 4.58). Whatever the verb
framed (last selection? the world? a fallback pivot?) may be perfectly designed — but
neither the result nor the tool description says, so an agent cannot know what it just
did to the human's view, and a human watching cannot know why their camera jumped. The
T4a `named-run-bodies` fix cured false-`ok` on missing HOSTS; this is the sibling:
true-`ok` with an unstated referent.

## The fix

Two halves, either sufficient: (a) the verb's result carries what was framed (a one-word
payload beside `ok`); (b) the `action_run` description / per-action docs state the
no-selection fallback. Decide whether the no-selection behaviour is even wanted for
agent callers — a refusal ("nothing selected to frame — select or use view.frameWorld")
may be more honest than a fallback.

## Trigger to revisit

First agent-facing polish pass (with [[inert-refusals-answer-with-their-label]] — same
class, same session).

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — the `view.frame` def.
- `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md` — the walk.
