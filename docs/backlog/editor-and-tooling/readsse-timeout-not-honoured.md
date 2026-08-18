---
summary: `readSse`'s `timeoutMs` bounds only how many further reads it attempts, never the one it is blocked inside — the daemon's 15 s SSE heartbeat is what turns a hang into a ~15 s failure whose message names 8 s
---

# `readSse`'s `timeoutMs` is not honoured on a silent stream

**Context.** Surfaced 2026-07-30 while diagnosing the flake in `flaky-daemon-sse-test.md`. `readSse`
(`readSse` in `packages/editor/tests/server.test.ts`) takes a `timeoutMs` (default 8 s) and
reads as though it bounds the wait. It does not: the deadline is consulted only at the top
of the `while`, and `await state.reader.read()` has no timeout of its own. On a stream that
goes quiet the helper blocks INSIDE the read, indefinitely as far as its own logic is
concerned — the parameter bounds only how many further reads it will attempt, never the
one it is sitting in.

What hides this today is the daemon's SSE heartbeat (`HEARTBEAT_MS = 15_000` in
`daemon/events.ts`): every 15 s a `: ping` frame wakes the read, the predicate fails, and
the now-expired deadline throws. So the failure mode is not a hang but a ~15 s failure
whose message ("SSE timeout; buffer so far:") names an 8 s timeout — which is precisely how
that flake got mis-attributed once already. Two consequences worth naming: any test
using this helper has a real floor of one heartbeat interval, not `timeoutMs`; and if the
heartbeat is ever removed, shortened, or made per-subscriber, these tests stop failing in
15 s and start hanging to the test budget instead.

**The fix when it is worth doing:** race the read against a timer
(`Promise.race([state.reader.read(), timeout])`) and cancel the reader on expiry, so the
helper fails at the deadline it advertises and with a message that is true.

**Trigger to revisit:** the flake in `flaky-daemon-sse-test.md` being diagnosed for real (this helper is the
instrument that would measure it, and a lying instrument is the wrong place to start), or
any change to the heartbeat. Not urgent on its own — no test is currently WRONG because of
it, they are only slower and vaguer than they claim.

**Reference:** `readSse` in `packages/editor/tests/server.test.ts` (the helper),
`HEARTBEAT_MS` in `packages/editor/src/daemon/events.ts` (the heartbeat that masks it).
*(All line citations in this entry dropped for symbol ones at T4a, 2026-08-09: every one had
already drifted, and that tranche's additions to both files moved them again.)*
