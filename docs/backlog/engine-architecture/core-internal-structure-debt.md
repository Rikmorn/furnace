# Core internal structure debt

Tracker for **core files and modules whose internal shape is wrong** — no public surface
changes, no behaviour changes, just organisation that a future toucher should fix rather
than extend. Each section is one previously standalone entry, keeping its Context, *Trigger
to revisit* and *Reference*.

They are merged because they share a shape of trigger that is unusual in this register:
**"the next substantial edit to this file"**, not a consumer or a scale threshold. That
makes them cheap to act on opportunistically and pointless to schedule. Every observation
below was taken at a specific dated moment against a specific file — line counts and site
counts **must be re-derived at pickup**, not trusted from the text.

One of them is cited live from source: `packages/editor/src/daemon/mcp.ts` names the
locator re-throw entry as the thing that fires on a seventh site. Sections are ordered
field-module first (three files), then the cross-module observations.

## `field/artifact.ts` is four codecs in one file

`packages/core/src/field/artifact.ts` is 1370 lines carrying four unrelated
serialization formats that share nothing but a directory:

- the **chunk file** (`FFC1`) — `encodeChunkFile` / `decodeChunkFile`
- the **material file** (`FFM1`) — `encodeMaterialFile` / `decodeMaterialFile`
- the **oplog** (v1 bare array / v2 / v3 envelope) — `serializeOps` / `parseOps`
- the **placement artifact** (D-F3-10) — `serializePlacements` / `parsePlacements`

plus `bakeFieldWorld`, which is the only thing that touches more than one of them.

Measured at `1c47b84e` (T4a Task 4): 80 top-level declarations, 13 exported. The
**oplog codec alone is 822 lines and 47 declarations** (L175–L996, `OPLOG_VERSION`
to the placement-artifact banner) for **two** exported names. T4a Task 4 added 262
lines to this file and removed 61 — nearly all of it in that one region, which is
what surfaced this.

### Context

The oplog decoder is no longer a decoder. T4a reframed it as the field's
**security boundary** (`docs/reference/core-modules.md` §field, "The oplog wire
format"): untrusted bytes in, typed engine objects out, and nothing downstream
re-examines them. That region now holds a wire-shape layer, per-member vector
tables, a locator wrapper, an entity-record validator and the seam onto the
engine's value predicates — a coherent module wearing a filename about baking
artifacts, sharing a file with three binary formats that have no validation story
at all.

Extraction needs **no public-API change**: `parseOps` / `serializeOps` are already
re-exported by name from `packages/core/src/field/index.ts`, so an `oplog-codec.ts`
is an internal move. `bakeFieldWorld` would import it exactly as it imports
`chunks.ts` and `mesher.ts` today.

This is the sibling of the *`field/ops.ts` wants a four-concern split* section, one file over. Both were
named by the same pressure — the field's op vocabulary and its wire format are
each outgrowing the file they were filed in.

### Trigger to revisit

- The next tranche that adds to the oplog codec specifically (a `MaterialTable`
  parameter for class-id resolution — `field-reconfigure-and-parse-edges.md` §`parseOps` cannot resolve a class id
  — would land squarely here).
- Or a fifth format arriving in this file.
- Or the *`field/ops.ts` wants a four-concern split* section firing: if `ops.ts` splits, the oplog
  codec's dependency on it becomes a set of module edges worth drawing once.

Not before then. The file is legible today and the split is pure motion; doing it
inside a tranche that also changes behaviour would make the behaviour change
unreviewable.

### Reference

- `packages/core/src/field/artifact.ts`; the four format groups above.
- `docs/reference/core-modules.md` §field — "The oplog wire format".
- Siblings: the *`field/ops.ts` wants a four-concern split* section,
  `field-reconfigure-and-parse-edges.md` §`parseOps` cannot resolve a class id.

## `field/types.ts` is a god-module

Named at the foundations programme's disposition sweep (2026-08-04); never filed; filed
at the T3 objectives audit (2026-08-08). `packages/core/src/field/types.ts` accumulates
type surface across the field feature's concerns; the programme-era note earmarked its
undo cluster for the T3 transaction seam — **that seam was then DROPPED by decision**
(T3c, 2026-08-07: OpLog + `logApplyGroup` + derived labels are the transaction story),
so the earmark has no successor and the cluster stays where it is. Spec-era observation —
re-derive the module's actual concern map at pickup.

### Trigger to revisit

- The `field/ops.ts` four-concern split executes (sibling entry) — the type surface
  should follow the same walls.
- A change to undo/inverse types, which will otherwise land in a file that mixes them
  with everything else.

### Reference

- `packages/core/src/field/types.ts`;
  the *`field/ops.ts` wants a four-concern split* section.

## `field/ops.ts` wants a four-concern split

Named at the foundations programme's disposition sweep (2026-08-04) as one of eight
entries to file; never filed; filed at the T3 objectives audit (2026-08-08). The
programme-era reading: `packages/core/src/field/ops.ts` mixes four concerns (the op
vocabulary/validation, application, the OpLog with inverses, and group/composite
assembly) that would be four modules under the editor-side standard the T3 extractions
set. Concern boundaries are spec-era observations — re-derive the seams at pickup.

### Context

Three sibling entries each hold one corner of this file without proposing the split:
`oplog-group-apply-is-not-a-transaction.md` (group semantics),
`oplog-entry-assembly-duplicated-three-ways.md` (assembly),
`field-reconfigure-and-parse-edges.md` §`parseOps` cannot resolve a class id (parse). A split would give each question a
module to land in. T3c's `txn` DROP (core's OpLog + `logApplyGroup` + derived labels ARE
the transaction story) makes this file the transaction story's whole home — one more
reason its concerns deserve walls.

### Trigger to revisit

- Any of the three sibling entries fires and its fix wants a home the mixed file blurs.
- ~~T4's agent op-stream work touches op validation (the parse/validate corner becomes a
  security boundary — the sibling entries say so).~~ **Fired at T4a (2026-08-08) and did
  NOT pull the split with it:** the parse corner IS now the security boundary
  (`assertOpStructure`, the table-independent half of `assertOpValid`, wired into
  `parseOps`), and the change landed inside the existing file without wanting a new
  module. One data point that the vocabulary/validation concern is not the one straining
  the walls.

### Reference

- `packages/core/src/field/ops.ts`; the three sibling entries above.

## One locator re-throw, spelled six times — and already diverging

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

**The MCP clause was CHECKED AGAIN at T4c Task 7, at its own named trigger, and did not fire
— still six sites, count re-derived rather than assumed.** T4c projected the mutation verbs
this entry predicted would be the tempting moment (*"whose failures name a target the agent
chose"*). It stayed six, and the mechanism is worth recording because it is the shape a future
verb should copy. `FieldHost.applyOps`
(`packages/editor/src/field-host/field-mutation.ts`) **passes core's locator through
unchanged** — `logApplyGroup` rejects with `field op group: ops[2] — <predicate's message>`
and that sentence becomes the refusal's message verbatim, because the ops carry no ids until
pass 2 and the list position is the only address a caller can act on. Rewording it under an
editor-side locator would have LOST the one thing the caller can use. The applier-failure leg
appends a note (`strandedNote`) rather than prefixing a locator, and both legs answer a VALUE
(`refused` / `failed`) rather than throwing — so nothing on the editor side catches, wraps and
re-throws. `generate` is the same: its two attributable causes are settled before the call and
its unattributable ones return core's own sentence. Re-derivation at head, 2026-08-10:
`grep -rn "cause: " packages/core/src packages/editor/src` returns the four chaining sites
below plus `maintenance.ts`'s unrelated one, and `grep -rn "instanceof Error ? e" packages/core/src`
returns the same six locator sites — no seventh in either package.

**Extraction was weighed at T4c and declined, with the same two reasons as T4a.** It still
reaches `artifact.ts`, which no task in this tranche touched, and it still carries the
`cause`-or-not decision for the two JSON sites — a real design question. Both AGENTS.md
inline-fix conditions still fail, so filing remains the right answer rather than the lazy one.

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

## Two value-level import cycles in core

Named at the foundations programme's disposition sweep (2026-08-04); never filed; filed
at the T3 objectives audit (2026-08-08). The programme's core sweep found two
value-level (not type-only) import cycles between core modules. Cycle membership is
spec-era — re-derive with madge or a hand trace at pickup; the architecture test
(`packages/core/tests/architecture.test.ts`) checks tier direction and surface
membership but not acyclicity, so nothing regresses loudly if a third appears.

### Trigger to revisit

- A build/bundler behaviour that smells like initialization order (cycles are the usual
  cause).
- The architecture test gaining clauses — acyclicity is a natural candidate row.

### Reference

- `packages/core/tests/architecture.test.ts`.

## `resources/internal.ts` carries ~33 mechanical wrappers

Named at the foundations programme's disposition sweep (2026-08-04); never filed; filed
at the T3 objectives audit (2026-08-08). The programme's package sweep counted ~33
mechanical wrapper functions in `packages/core/src/resources/internal.ts` — pass-through
shapes whose value is the package-private seam, not logic. Count is spec-era (sweep
scope: the T1 core package audit) — re-derive at pickup.

### Trigger to revisit

- The next tranche that touches the resources module's surface (a deletion pass should
  ask each wrapper "does the seam still need you").
- The R8 surface-membership rule gaining an automated check that would make thin
  wrappers visible as surface.

### Reference

- `packages/core/src/resources/internal.ts`; `docs/reference/api-posture.md` §R8.
