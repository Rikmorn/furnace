---
summary: session.confirm commits are unstamped by ruling — the mixed-authorship question (human stages, agent triggers) is unruled, and threading it needs that answer first
---

# Whose work is a confirm?

**Context.** The undo-attribution slice (sealed 2026-08-14) stamps `origin` on every
agent-relayed committing path EXCEPT `session.confirm`, by planner ruling. A confirm is
mixed authorship: the human stages the session (draws the region, tunes the params) and
whoever calls confirm merely triggers the commit. Spec §5's rule — *origin = the actor of
the committing call* — assumed the caller authored the content, and a confirm breaks that
assumption: stamping it `agent:mcp` would let the agent undo content the human authored,
the one direction the guard exists to forbid. So confirm commits stay UNSTAMPED whoever
triggers them (`edit.undo` then reads them as the human's), pinned by the tripwire test in
`field-host-move.test.ts` ("session.confirm commits stay UNATTRIBUTED whoever triggers
them"). Cost is only the benign direction: an agent that `edit.grab`s and confirms its own
move cannot step it back (it can reverse via inverse ops, or ask). Posture documented at
`docs/reference/editor-architecture.md` §29.2.

**The open question.** Whose work IS a confirm — the stager's, the trigger's, or a third
thing (e.g. stamp from the session's own provenance)? The answer decides this verb and any
future trigger-vs-author split. Scope if taken: `field-machine.ts`'s two commit paths
(`commitStampSession`, `applyReconfigureSession`) plus the move drop, and the tripwire pin
is where the new promise lands WITH the mechanism.

**Trigger to revisit:** an agent world run hits the cannot-undo-own-confirm annoyance in
practice; or a second trigger-vs-author split appears anywhere in the editor.

**Reference:** the tripwire in `field-host-move.test.ts`; `stepsOwnWork` in
`frontend/lib/actions.ts`; the execution report's unthreaded-paths list (archived under
the undo-attribution slug); spec §5's actor rule.
