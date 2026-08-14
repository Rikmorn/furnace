---
summary: the stamping seam's trust argument rests on "the chrome never calls edit.apply/generate/action.run over HTTP" — held by convention only, no test reds if it breaks
---

# The chrome-never-calls-mutating-verbs premise is unpinned

**Context.** The undo-attribution slice (sealed 2026-08-14) stamps `AGENT_ORIGIN` at the
session-answerer seam on the premise that everything arriving over the daemon
backchannel is agent-initiated — verified at execution time (the chrome's `api.ts` calls
include none of `edit.apply`/`generate`/`action.run`; every chrome surface dispatches
locally through `dispatchRef`). But the daemon's command registry documents itself as
serving "every client", so the premise is held by convention: if a chrome path ever
calls one of the three mutating verbs over HTTP, its writes would be stamped
`agent:mcp` — silently mis-attributed as agent work, with the guard then letting an
agent step them. Nothing reds today if that happens.

**The cheap fix:** one test asserting `api.ts`'s derived verb set (`grep -oE
'"[a-z]+\.[a-zA-Z]+"'` over the file, or an import-level extraction) excludes the three
mutating verbs, named so it reads as the seam's premise pin. Makes the silent-wrongness
failure mode loud at the moment someone adds the call.

**Trigger to revisit:** next slice touching `api.ts` or the answerer seam (door-set is
the obvious candidate — it reworks the door anyway).

**Reference:** the trust-argument docblocks in `frontend/lib/session-answerers.ts`
(the `AGENT_ORIGIN` authoring note) and `tests/session-mutation.test.ts`;
`editor-architecture.md` §29.1.
