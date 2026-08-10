# A chrome that has not claimed the session is not read-only — it is a full editor nobody can reach

The session-claim policy, settled at the foundations programme design (2026-08-04) and recorded
in `editor-ai-integration-milestone.md`, reads:

> exactly one chrome session may claim a world for authoring; the daemon tracks the claim; **a
> second tab gets read-only or an explicit steal**; an MCP call with no claimed session returns
> a typed error, never a hang.

**Foundations T4b Task 2 shipped the second half and DECLARED the narrowing of the first.** A
tab whose claim is refused gets a steal prompt, and a tab whose claim is taken gets a
full-viewport blocking cover (`frontend/components/ClaimLostOverlay.tsx`). A tab that declines
to steal keeps every control it had: it can dig, save, bake, rename and delete worlds exactly as
before. What it is not is the session an agent can read or drive.

That is not a hole in the implementation. It is a scope decision, taken because read-only is not
a flag.

## Context

**Read-only is a per-control decision across the whole shell.** Which verbs refuse; what a
refused control SAYS (T4a's rule: every refusal names its class, and a seventh `RefusalClass`
arm would be the honest home for "this tab is not the editing session"); whether the viewport
still digs; what happens to a gesture already in progress when the claim is lost mid-stroke;
whether ⌘S is refused or allowed (a read-only tab that cannot save is a tab that loses work).
That is a design pass, not a prop.

**Half of it would be worse than none.** `tests/frontend-overlay-focus-return.test.ts` states
the general form of this: *"a version wired into two of the six overlays would be worse than
none, because the inconsistency is exactly what makes a focus rule unlearnable."* A shell where
four verbs refuse and six do not teaches a user that the editor is unreliable.

**Nothing in T4b routes by the claim's world.** Task 3 addresses the CLAIMED CONNECTION, not a
world; Task 4's `session.state` reads through it. So the cost of the narrowing today is exactly
one thing: a second tab is a normal editor that the agent cannot see. It is not a correctness
gap, and no pin depends on it.

**A related narrowing rode the same decision and has since SHIPPED, which changes what is
left here.** The chrome used to claim at CONNECT under whatever world it was authoring at
that moment and never re-claim on a switch, so the claim's world was a label that could go
stale — and the whole-branch review found that a stale label composed with the load-bearing
claim COUNT into a silent two-claims state. Foundations T4c fixed it: `useSessionClaim` owns
the authored world and re-keys on every change, `editor-context.ts` carries the verb
(`setAuthoredWorld`) instead of the old `worldNameRef`, and a refused re-claim releases what
this tab left. See `editor-architecture.md` §26.1 for the shipped shape.

**What that leaves for THIS entry.** The claim's world is now TRUE, which makes it usable as
a routing key for the first time — a read-only mode would be read-only *for a world*, and
the design pass this entry asks for can now assume the key means what it says. The two were
filed to be designed together; one is done, and it removed the obstacle rather than the
question.

## Trigger to revisit

**The first time two chrome tabs are a real workflow rather than an accident**, which is one of:

- an agent driving one tab while a human watches another (the first thing anyone will try once
  T4c projects verbs as tools — a watcher tab that can silently dig into a world the agent
  believes it owns is the failure this policy was written against); or
- a demand report from actually using the editor with a second window open, which nobody has
  done yet.

Until one of those lands, the cover plus the steal prompt is the whole answer, and it is honest
about it.

## Reference

- `packages/editor/src/frontend/components/ClaimLostOverlay.tsx` — the cover, and the argument
  for why it is a cover rather than a read-only mode, stated where a reader meets it.
- `packages/editor/src/frontend/hooks/useSessionClaim.ts` — the claim, the steal prompt, and the
  world-name-at-connect narrowing.
- `packages/editor/src/daemon/claims.ts` — the table, and the connection-scoped-ephemera
  reconciliation.
- `docs/reference/editor-architecture.md` §5.1 — the as-built claim.
- `docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md` — the settled policy this
  entry narrows.
- `packages/editor/src/action-registry/result.ts` — `RefusalClass`, where a "not the editing
  session" arm would go. (The sibling entry for the other missing arm, `input`, was RESOLVED at
  T4c Task 3 — the class exists now, so `RefusalClass` has eight arms and the precedent for
  adding a ninth is the T4c commit rather than a backlog file.)
