# `SessionState` answers "what is armed?" across two fields with non-obvious semantics

Filed at the T4b review's live gate walk (2026-08-09) — found by the walk itself.

## Context

The gate compared `session_state`'s payload against the human's screen. The payload
read `tool: {effect: "dig", materialId: 0, mask: {kind: "none"}}` and
`gesture: "pointer"`; the human saw "nothing armed, just the Select button." Both are
true: `gesture` is the arming fact (`useFieldHostState.tsx:143` — "What LMB is armed to
do — `null` = the brush strokes"; a fresh host opens at `"pointer"`), while
`SessionState.tool` is the DORMANT brush configuration — what the brush *would* do.

**The reviewing agent misread the composite live** — reported "dig armed" to the human
— exactly the misreading any T4c agent will make. The projection is truthful but
requires joining two fields whose semantics live in a chrome hook's docblock the agent
cannot see.

## The fix (decide at T4c, with the mutation verbs — arming is what they manipulate)

Candidates, one to pick: a synthesized `armed: "pointer" | "brush" | …` member; or
nesting (`brush: {…}` dormant config + top-level `armed`); or `tool: null` while the
pointer is armed. Whichever lands must also land in the instructions/tool description —
the agent-facing prose is where the last misreading came from.

## Trigger to revisit

**T4c planning** (imminent): the verbs that arm tools and stroke brushes make
"what is armed" the single most consequential read in the payload.

## Reference

- `packages/editor/src/frontend/lib/session-answerers.ts:145` — the `tool` pick.
- `packages/editor/src/hooks/useFieldHostState.tsx:136-148` — the armed-brush seam and
  the `"pointer"` gesture semantics (the docblock the agent can't see).
- `docs/learnings/seals/2026-08-09-foundations-t4b-claim-backchannel-mount.md` — the
  walk that surfaced it.
