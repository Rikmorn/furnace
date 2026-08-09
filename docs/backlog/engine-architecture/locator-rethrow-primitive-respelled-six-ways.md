# One locator re-throw, spelled six times — and already diverging

**Context.** "Catch a predicate's error, re-throw it under a locator, keep the original on
`cause`" is now a convention in `@furnace/core/field`, and it exists as six hand-written
copies of the same four lines rather than as one primitive:

```ts
const detail = e instanceof Error ? e.message : String(e);
throw new Error(`<locator> — ${detail}`, { cause: e });
```

- `atOp` — `packages/core/src/field/artifact.ts:294-301` (the oplog decoder; T4a Task 4,
  the first of them)
- `logApplyGroup` — `packages/core/src/field/ops.ts:1123-1126` (T4a Task 5)
- `commitGenerator` — `packages/core/src/field/generators.ts:1036-1041` (T4a Task 5)
- `evaluateSpan` — `packages/core/src/field/reconfigure.ts:263-268` (T4a Task 5)
- `parseOplogJson` — `packages/core/src/field/artifact.ts:908-913`
- `parsePlacementJson` — `packages/core/src/field/artifact.ts:1087-1092`

Only the locator string differs between them, and the locator is the part that SHOULD
differ — it is the one thing each call site knows and the primitive cannot. Everything
else is the convention: the `—` separator, the `String(e)` fallback for a non-`Error`
throw, and the `cause` chain.

**It has already diverged, which is why this is filed and not just noticed.** The last two
sites do NOT pass `cause`. That may be defensible — a `SyntaxError` from `JSON.parse` has
nothing in it the message does not already carry — but nothing records the decision, so
the next reader cannot tell a judgement from an omission. Four sites chain, two do not,
and the rule that would settle it is written down nowhere. `docs/reference/core-modules.md`
now describes the locator form as a cross-module family, which makes the divergence
something a reader can trip over rather than an internal detail.

**Proposed shape:** `rethrowUnder(locator: string, e: unknown): never` — one function
owning separator, fallback and `cause`, leaving each site to pass only its own locator:

```ts
} catch (e) {
  rethrowUnder(`commitGenerator: generator "${def.id}"`, e);
}
```

`ops.ts` is the established home: it already exports in-core-only helpers to exactly these
modules (`QUAT_NORM_TOLERANCE` to `placement-collision.ts`, `imagesOf` and `spliceOps` to
`reconfigure.ts`), all deliberately off the public field index. This would join them —
no new public API surface, no new module. The migration also forces the open question:
whether the two JSON sites keep dropping `cause` (then the primitive takes a flag, or they
stay hand-written with a comment saying why) or join the other four.

**Why it was not extracted when the fourth copy landed.** T4a Task 5 wrote three of the six
and the AGENTS.md inline-fix threshold gates on "< 10 LOC **and** in a file you are already
touching". The extraction reaches `artifact.ts`, which that task did not touch, and it
carries the `cause`-or-not decision above — a real design question, not a mechanical lift.
Filing it is the rule the threshold points at.

**Trigger to revisit:** a SEVENTH site; or the first divergence beyond the known `cause`
one (a different separator, a swallowed original, a locator that eats the predicate's
message instead of prefixing it); or T4b/T4c adding locators on the MCP verb boundary,
which would put the convention in front of an agent rather than a developer.

**The MCP clause was CHECKED at T4b Task 5 and did not fire — still six sites.**
`packages/editor/src/daemon/mcp.ts` mounts the agent door and its error edge
(`toolFailure`, one `Record<EditorErrorCode, string>`) does neither of the two things this
entry is about: it **converts** a throw into a VALUE — an `isError: true` tool result an
agent reads — rather than re-throwing one, and it adds **no locator**, because MCP
correlates a result to the call that produced it, so naming the tool in the text would be
the convention respelled for a reader already holding the answer to it. The `<code>:`
prefix it does write is the `EditorErrorCode` crossing the transport edge (`errors.ts`'s
"the domain speaks codes"), not a call-site name. **T4c is the clause's remaining live
half**: it projects mutation verbs, whose failures name a target the agent chose, and that
is where a locator becomes tempting.

**Reference:** the six sites above; `docs/reference/core-modules.md`'s `logApplyGroup`,
`commitGenerator` and `reconfigureGenerator` entries, which document the resulting error
strings as a family; `oplog-entry-assembly-duplicated-three-ways.md`, the same
shape of finding one layer down (that one is about the apply-and-assemble block, this one
about the error-wrapping block, and neither is extracted yet).
