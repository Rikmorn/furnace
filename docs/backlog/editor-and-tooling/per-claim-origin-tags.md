---
summary: AGENT_ORIGIN is one shared tag while the door admits two agents through one claim — the guard cannot tell agents apart; the claim should mint the tag
---

# Per-claim origin tags — the claim mints the tag

**Context.** `AGENT_ORIGIN` (`shared/wire.ts`) is a single hardcoded `"agent:mcp"`, and
the door explicitly permits two agents through one claim (the undo-attribution exit
evidence pins "TWO agents read through ONE claim" end-to-end). Two concurrent agents
therefore stamp the same tag, are indistinguishable to the undo guard, and each can step
the other's top entry. The guard's honest guarantee — stated in its refusal message and
docblock since the 2026-08-14 wording fix — is "an agent steps only AGENT-AUTHORED work",
not "only its own". Ruled a deliberate non-goal at the undo-attribution seal
(`docs/learnings/seals/2026-08-14-undo-attribution.md`); the human-work direction is fully closed
regardless.

**The shape of the fix.** The wire already affords it: the spec chose `origin?: string`
over an `"agent"` literal precisely so a second tag needs no new envelope version. The
design question is minting and lifecycle — the CLAIM mints a per-agent tag (e.g.
`agent:<claim>`), the answerer stamps the minted tag instead of the constant, the guard
compares against the caller's own, and the `undoAgentAuthoredOnly` pin is where the
promise upgrades WITH the mechanism, never before it.

**Trigger to revisit:** two concurrent agents on one editor session become a real
workflow rather than a permitted edge; or any feature needs to tell agents apart in the
log (per-agent blame, per-agent quotas).

**Reference:** `AGENT_ORIGIN` in `shared/wire.ts`; `stepsOwnWork` +
`undoAgentAuthoredOnly` in `frontend/lib/actions.ts` / `actions.test.ts`;
`docs/learnings/seals/2026-08-14-undo-attribution.md`.
