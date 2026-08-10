# The backchannel's refusals blur two causes at the lifetime edges

> **Narrowed at T4c Task 3 (2026-08-10), not closed — and item 1's trigger did NOT fire the
> way this entry expected.** The trigger read: *"the first caller that must distinguish a
> chrome refusal from a daemon fault (T4c's mutation verbs are the likely one — a refused
> write and a broken write want different retries)"*. T4c's three write verbs landed
> (`edit.apply`, `generate`, `action.run`) and **that clause still has not fired**, for a
> reason worth recording because it changes what the entry is waiting for.
>
> **A refused WRITE never reaches `ask()`'s failure path at all.** The chrome answers a
> refusal as a successful ANSWER whose payload is an `ActionResult` — `{ok: false, kind:
> "refused", because: …}` — so it travels the `ok: true` leg of `SessionAnswer` and arrives
> at the agent as data it can branch on, with a machine-readable class. The `internal` code
> is raised only when the chrome cannot answer at all (an unserved method, a handler that
> threw), which is still exactly the version-skew-or-daemon-fault pair this entry is about.
> So the mutation verbs made the distinction MORE available rather than more urgent: the
> refusal channel an agent actually uses is typed and separate, and `internal` stayed the
> rare case.
>
> **What that means for item 1.** The eleventh code (`session-refused`) is still unbuilt and
> still right, but its caller is now narrower than predicted: not "any write verb", but a
> client that must tell a STALE TAB from a broken daemon — which is a deployment concern
> (the `bun run edit` loop restarting the daemon under an open tab) rather than an
> authoring one. Item 2 is unchanged and unreached.
>
> **Trigger, restated:** item 1 fires on the first client that RETRIES differently for a
> version-skewed tab than for a daemon fault — most likely a long-running agent session
> that survives an editor rebuild. Item 2 fires unchanged, on the first ask that outlives a
> daemon restart. Neither is T4c's.

Foundations T4b's whole thesis is that a refusal must be TRUE and ACTIONABLE — `no-session`
rather than a polite timeout when a tab departs, `session-timeout` rather than a hang when one
goes quiet. Two places at the relay's lifetime edges do not reach that bar. Neither is
reachable in a way a user meets today; both become live the moment an agent's ask can outlive
the thing it was asked of. They are filed together because they share a trigger and a subject:
*the daemon says one thing when the truth is one of two.*

## 1. A chrome REFUSAL and a daemon FAULT are the same code

`ask()` throws `internal` when the answering session replies `ok: false` — *"the chrome does
not know that method"* — and `daemon/mcp.ts`'s `toolFailure` also maps any non-`EditorError`
throw to `internal`. So at the agent door these two are indistinguishable at the CODE level:

- the editor tab is a different vintage than the daemon (routine: the `bun run edit` loop
  restarts the daemon on every source change while the tab keeps its bundle), and
- something failed inside the daemon.

Only the sentence carries the difference. `AGENT_REMEDY`'s `internal` row is written for it
(*"the daemon and the editor tab disagree, or something failed inside the daemon … a tab left
open across an editor upgrade usually just needs a reload"*), which is the right stopgap — an
agent reading the text gets a correct remedy for both. What it cannot do is let a client
**branch**. A version-skew refusal has a remedy a human can perform in two seconds; a daemon
fault has none.

The shape a fix takes is an eleventh code — `session-refused`, say, 502 by the same
gateway reasoning that earned `session-timeout` its 504. That is real contract surface, so it
waits for a caller that must tell the two apart.

## 2. A daemon shutdown leaves a pending ask to its timer instead of telling it

`EventHub.close()` ends every subscriber's response and clears both tables, and it deliberately
does **not** fire `closeHandlers` — the comment argues ownership: *"this runs only from
`startServer`'s `close()`, the hub and the claim table are built together and die together
there, and a listener told about a connection on a hub that no longer exists has nothing to
do."* That reasoning holds for the CLAIM table, which is what it was written about.

It does not hold for the backchannel, which registers `abandonAsksOn` through that same
`hub.onClose`. On shutdown, a pending ask is therefore never rejected: it sits on its
`unref`'d timer and either fires `session-timeout` up to 10 s later, or never fires because the
process exited first. Either way the caller is told *"the session is silent"* when the truth is
*"the daemon shut down"* — verbatim the sentence-swap this tranche exists to remove, with the
polarity that sends a caller off to wait rather than to restart.

**Unreachable today**, and that is a property of the callers rather than of the code:
`close()` runs at process teardown and in tests, and no MCP call currently spans one. It goes
live the day a daemon restart happens under a held ask — which is exactly the `bun run edit`
inner loop, once an agent is calling during development.

The fix is small and the DECISION is the part that is not: either the hub fires close handlers
on `close()` (which changes what `claims.release` sees at shutdown, harmlessly but not
provably so from here), or `startServer`'s `close()` drains the backchannel explicitly before
closing the hub, or `Backchannel` grows its own `close()` rejecting every pending ask with a
code that says the daemon is going away. The third is the honest one and needs the code from
item 1's family.

## Trigger to revisit

Either half fires it: **the first caller that must distinguish a chrome refusal from a daemon
fault** (T4c's mutation verbs are the likely one — a refused write and a broken write want
different retries), or **the first ask that can outlive a daemon restart**, which arrives with
any agent driving through the `bun run edit` loop.

## Reference

- `packages/editor/src/daemon/backchannel.ts` — `ask`'s `@throws` list, `abandonAsksOn`, and
  the `hub.onClose(abandonAsksOn)` registration.
- `packages/editor/src/daemon/events.ts` — `close()`, and the comment stating why
  `closeHandlers` are not fired there.
- `packages/editor/src/daemon/mcp.ts` — `AGENT_REMEDY`'s `internal` row, which is the stopgap.
- `packages/editor/src/daemon/errors.ts` — `session-timeout`'s row, whose 504 argument is the
  precedent a `session-refused` code would follow.
- `docs/reference/editor-architecture.md` §26.1, §26.3 clause 1.
