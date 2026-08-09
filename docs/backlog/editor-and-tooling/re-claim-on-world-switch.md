# The claim key goes stale across a world switch — re-claim when the world changes

Filed at the T4b review (2026-08-09), closing a dangling citation: `editor-architecture.md`
§26.1 already documents this scenario and named "the filed re-claim-on-world-switch entry"
as the fix's home before the file existed. This is that file.

## Context

`useSessionClaim` claims at CONNECT under the world the tab is authoring at that moment and
never re-claims on a world switch — the claim's world is a label in T4b, never a routing key
(Task 3 addresses the claimed CONNECTION; `session.state` reads through it). True when
Task 2 wrote it. But Task 3 made the global claim COUNT load-bearing through `soleTarget()`,
and the two compose (§26.1's worked scenario, found by the whole-branch review):

> A tab boots on the untitled scratch and claims key `null`. The human loads world `W`. The
> tab still holds `null` until a reconnect re-keys it — and `bun run edit` restarts the
> daemon on every source change, so reconnects are routine. In that window a second tab on
> the scratch claims `null` with no conflict, no steal prompt, no toast — and the daemon
> holds two claims. Every `session_state` from then on is the two-claims refusal, and the
> human has seen nothing that would explain it.

The refusal is typed, immediate, and carries an actionable remedy ("close all but the tab
you want driven"), so the never-a-hang thesis survives — what is missing is any warning on
the way in.

## The fix

`useSessionClaim` re-claims under the new world name when the authored world changes
(`editor-context.ts`'s `worldNameRef` already tracks it; the release+claim round trip is two
existing commands). Designed together with
[[read-only-chrome-for-an-unclaimed-session]] — that entry records the same narrowing from
the read-only side and says the two should be one design pass.

## Trigger to revisit

**T4c planning** (imminent): the moment an agent drives a session routinely, a silent
two-claims state produced by ordinary tab usage becomes an agent-visible failure with no
human-visible cause — exactly the class T4c's presence/attribution work exists to prevent.
Take it there or before.

## Reference

- `docs/reference/editor-architecture.md` §26.1 — the worked scenario and the honest
  "thesis survives, chrome gives no warning" verdict.
- `packages/editor/src/frontend/hooks/useSessionClaim.ts` — the claim-at-connect site.
- `packages/editor/src/daemon/backchannel.ts` — `soleTarget()`, where the count became
  load-bearing.
