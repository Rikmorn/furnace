# The advisor-idle notice can state something untrue, and never retracts it

`field-host.ts`'s analyzer pump reports *"walkability advisor idle — this project installs no
agent profile"* whenever it reaches `analyzerFire()` with `agentProfile === null`, guarded by
a one-shot `profileMissingReported`. The profile arrives over HTTP
(`useCatalogs.tsx` → `/catalog/agent.json` → `setAgentProfile`), and the pump does not wait
for it. So the sentence is not a fact about the project — it is a fact about **which of two
async arrivals won a race** — and because the flag is a one-shot, a profile that lands a
moment later never takes the claim back.

## Context

Found by F4.5c Task 17's machine smoke, and **proven rather than inferred**.

On `packages/dungeon`, which **does** ship `catalog/agent.json` (added `2b7a0f21`,
2026-07-26), the notice did not fire in **ten consecutive boots** — the fetch beats the pump
on a warm machine. F4.5b's smoke reported the opposite ("the status bar shows 1 unread error
at every boot", its rider R26), on the same project. That disagreement is the race, observed
from both sides.

Reproduced deterministically by delaying **only** that one request by 3 s in Playwright —
same daemon, same build, same project, a real `200`, just later:

```
walkability advisor idle — this project installs no agent profile
```

…displayed while `fetch("/catalog/agent.json")` returns `ok=true` in the same page. The
notice never updates.

**Two things follow, and they are worth separating.**

1. **`b-R26`'s original symptom is not reproducible on the dungeon today.** Anyone re-testing
   "does a clean boot paint a red badge?" will find it does not, and should not conclude the
   race is gone — only that it was won.
2. **F4.5c Task 1 fixed the HARM, not the cause.** The notice moved from `error` to `warn`,
   so it fades on the info clock and the ⚠ chip no longer counts it — a clean boot is no
   longer painted red. What remains is a transient false sentence about the user's project,
   which is a smaller problem of a different kind, and which no test can see (the harness
   never races an HTTP response against the pump).

## What a fix would have to decide

The one-shot is doing real work — without it the message repeats on every pump settlement —
so the fix is not "drop the flag". Options, none costed:

- **Wait for the catalogs to settle before the first analyzer pass.** `catalogSettled` already
  exists in the frontend and gates other things; the host would need it pushed in. Makes the
  message true, at the cost of a coupling the host currently does not have.
- **Retract on arrival.** `setAgentProfile` clears `profileMissingReported` and posts a
  correction. Cheap, but a toast that contradicts a toast is its own UX question.
- **Say less.** Report the idle state only when the catalogs have settled AND the profile is
  still absent — i.e. make the sentence conditional on the thing that makes it true.

## Trigger to revisit

Either of:

- **A user reports the notice on a project that does have a profile** — a cold machine, a slow
  disk, or a project served over a network mount is all it takes.
- **The advisor gains a second one-shot notice.** The `profileMissingReported` shape would then
  be a pattern rather than a single site, and the retraction question has to be answered once
  for the class rather than twice by hand.

Until then it is a fading amber toast that costs the user four seconds of a wrong sentence,
which is why Task 17 filed it rather than fixing it.

## Reference

- `packages/editor/src/viewport-host/field-host.ts` — `analyzerFire()`, the
  `profileMissingReported` one-shot and the `reportToolError(…, "warn")` call; `setAgentProfile`
  is the arrival that would retract it.
- `packages/editor/src/frontend/hooks/useCatalogs.tsx` — the `/catalog/agent.json` fetch, and
  its own comment that "a 404 is a project that simply has no agent".
- `packages/editor/tests/field-host-analyzer.test.ts` — pins the *severity* (`["warn"]` for
  advisor-idle against `"error"` for the no-profile verify refusal). Nothing pins the
  *truthfulness*, and nothing in the harness can: it never races a fetch against the pump.
- `packages/dungeon/catalog/agent.json` — the profile whose existence makes the shipped
  sentence false whenever the race is lost.
