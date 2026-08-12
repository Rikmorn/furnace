# `action_run`'s `input` is schema-untyped, and objects do not survive the client

Filed 2026-08-12 from the sculpting-worlds cycle-2 E1 monastery run; validated and accepted at
that cycle's review the same day.

`action_run` declares `input` with an EMPTY JSON Schema (`"input": {}`) — it is `input?:
unknown` at `packages/editor/src/shared/wire.ts:257`, and `z.toJSONSchema` can project nothing
narrower from that. **The row's PROSE names all six input-taking actions and their fields; the
SCHEMA names none of them**, and a client marshals against the schema. Six actions
require an object there — `world.saveAs {name}`, `world.makeDefault {name}`,
`edit.duplicate {entityId}`, `edit.delete {entityId}`, `edit.grab {entityId}`,
`tool.stamp {generatorId}`. Because the field declares no type, at least one MCP client
(Claude Code, 2026-08-12) serialises the value to a STRING, and the daemon rejects it:

```
invalid input for "world.saveAs" at "": Invalid input: expected object, received string
```

Measured in that run: the failure is at the client boundary, not in the daemon. The same
call issued as raw JSON-RPC to `http://127.0.0.1:4500/mcp` with a genuine object
succeeds (`{"ok": true}`). So the daemon's contract is fine and its schema is the defect
— an untyped field gives the client nothing to marshal against.

The blast radius is larger than it looks: `world.bake` REFUSES an unnamed world, and
`world.saveAs` is the only verb that takes a name (`world.save` takes none and merely
opens a naming drawer for the human). So an agent that cannot pass an object cannot name
a world, and therefore **cannot bake one at all** — the whole write path terminates at a
parameter-encoding bug. In the run this was worked around by bypassing the MCP client and
POSTing JSON-RPC directly, which is not something a skill should have to teach.

The fix is to give `input` a declared schema — a discriminated union keyed on the action
`id`, covering the six input-taking actions and admitting nothing for the rest. That also
moves the existing "an undeclared key is refused rather than ignored" contract into the
schema layer, where a client can see it before the call rather than after.

Note a second, independent finding from the same probe: even with a correctly-typed
object, `edit.delete {entityId}` refuses with *"needs a selected stamp and no live
session — Delete confirms against the SELECTED stamp"*. The `entityId` is a confirmation
token, not a selector, and no agent verb selects an entity — so entity deletion stays
unreachable even once this entry is fixed. That half belongs to
`agent-can-add-but-cannot-revise.md`.

**Trigger to revisit:** Next time an agent-facing door change is made, or the first time
anyone tries to drive `world.saveAs` / `tool.stamp` / `edit.*` over MCP from any client.

**Reference:** `packages/editor/src/shared/wire.ts:257` (`input?: unknown` — the untyped
field); `packages/editor/src/daemon/mcp.ts:339-343` (the `action_run` row, whose prose carries
what the schema does not); `packages/editor/src/action-registry/schemas.ts` (the per-action
zod the union would be built from);
`docs/backlog/editor-and-tooling/agent-can-add-but-cannot-revise.md` for the
selection/revision half.
