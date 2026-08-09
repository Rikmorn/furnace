# The six action schemas STRIP an invented argument where every daemon command REFUSES one

Two doors into this editor will validate an agent's arguments with two different postures, and
the split is invisible until an agent makes exactly one mistake at each.

**The daemon's posture is strict.** Every command in `handlers.ts` / `session-handlers.ts`
declares `z.strictObject(...)`, so an unknown key is rejected. Foundations T4b Task 5 leaned on
that deliberately: `daemon/mcp.ts` FORWARDS the caller's arguments into `dispatch()` rather than
composing `{}`, precisely so that *"a tool's advertised input schema and the schema that
actually decides cannot drift apart in silence"* — an invented argument earns `invalid-input`
at the agent door exactly as it does over HTTP, and `tests/mcp.test.ts` pins it (*"an invented
argument is REFUSED, not dropped"*).

**The action registry's posture is lenient.** All six rows in
`src/action-registry/schemas.ts` are `z.object`, which **strips** unknown keys, and the JSON
Schema `toJsonSchema` reflects out of them carries no `additionalProperties` at all — so the
advertisement never promised to refuse one either.

Task 6's `tests/action-registry/projection-round-trip.test.ts` found this, named it in its
header and pinned the admitting half rather than papering over it. It is genuinely **not** a
round-trip failure: both sides *admit* the value, so the verdicts the test compares agree. The
divergence is in the OUTPUT — zod's parsed data has the stray key removed; the advertisement
never said it would be.

## Why it bites at T4c and not before

Nothing projects these six rows today (`grep -rn "action-registry" packages/editor/src/daemon/`
is empty; the door's three tools carry a hand-written `NO_ARGUMENTS` document). The moment T4c
projects them, an agent that invents an argument to `tool.stamp` gets **silent stripping**,
while the same mistake against `session_state` gets a **typed refusal with a remedy**
(`AGENT_REMEDY`'s `invalid-input` row: *"Re-read its inputSchema and call it again passing only
what it declares"*). Same client, same session, two behaviours — and the stripping one is the
worse half, because it is indistinguishable from success and the agent learns nothing.

## The decision this needs, which is why it is filed rather than fixed

Not a one-line change, and not one a plumbing commit should make:

1. **Six rows to `z.strictObject`.** Cheapest to write; makes the advertisement grow
   `additionalProperties: false`, which the completeness case is already watching for (it reds
   on the new keyword by design — *"the day a row goes `strictObject` the completeness case
   reds on `additionalProperties`, which is the intended door"*). Costs: the chrome dispatches
   these same rows, so any chrome caller passing a superset starts failing; and it commits the
   registry to a posture the daemon chose for a *transport* boundary the registry does not sit
   on.
2. **Keep `z.object` and make the projection edge strict** — the door composing the
   advertisement adds `additionalProperties: false` itself. Keeps the registry's own parsing
   lenient for in-process callers and makes the wire strict. Costs: two spellings again, which
   is the thing Task 6 exists to prevent.
3. **Keep both and declare the divergence in the tool description.** Cheapest of all and almost
   certainly wrong — it puts a validation rule in prose an agent may or may not read.

The house position leans (1): `AGENTS.md`'s single-source-of-truth rule, and the fact that the
daemon already decided this question the same way for the same class of caller. But it is a
posture change across six rows with a chrome caller each, so it earns its own commit and its
own sabotage pass.

## Trigger to revisit

**T4c, at the moment the action rows are first projected as agent tools** — before any of them
is advertised, not after. It is cheap now and a wire-contract change later.

## Reference

- `packages/editor/src/action-registry/schemas.ts` — the six rows, and the header's argument
  that "JSON Schema comes from `toJsonSchema` at the projection edge".
- `packages/editor/tests/action-registry/projection-round-trip.test.ts` — the header's
  *"THE ONE PLACE THE TWO SIDES DIVERGE"* clause, and the completeness case that will red when
  a row changes posture.
- `packages/editor/src/daemon/mcp.ts` — `createMcpDoor`'s forwarded-arguments comment, which is
  the strict half of the split.
- `docs/reference/editor-architecture.md` §4 (the one-validator rule), §26.3 clause 6.
