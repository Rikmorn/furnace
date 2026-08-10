# `session.query {about:"entities"}` bounds its props and not its entities

Foundations T4c Task 4 shipped the spatial read with **two measured caps on the prop scan**
(`MAX_QUERY_PROPS = 2048` for work, `MAX_REPORTED = 32` per lint list) and a `truncated` flag
that makes a capped answer legible. The **entity list beside it has neither** — every
committed generator entity is projected, always
(`packages/editor/src/field-host/field-query.ts`'s `entitiesAnswer`).

## Context

**The two halves carry different risks, which is why one got bounds first.** The prop scan is
O(N²) and runs on the tab's main thread, so its cap is about the HUMAN's frame budget — an
agent's question must not stutter somebody's editor. The entity projection is a flat `map`
over `listEntities()`: linear, cheap, and no threat to a frame at any plausible count. What it
threatens is the **answer's SIZE**, which is the same risk the selection arm was explicitly
designed against (that arm refuses to send up to 262 144 cells and sends the replayable spec
instead).

**The scale is not there today, and the shape of the fix is not obvious — which is why this is
an entry rather than a two-line cap.** An `EntityFact` is eight fields plus a footprint box;
~1 000 entities is on the order of 100 KB of JSON, well past a comfortable tool result and a
long way past anything a human clicking stamps produces. An agent loop that generates in bulk
is the realistic producer, and that is exactly what T4c's own gate script prototypes.

**A cap alone would be the wrong fix**, and the module already argues why in its prop half: a
silently truncated list reads as a complete one. Any bound here needs a signal beside it, and
the answer's current shape has no place for one — `truncated` lives inside `props`, not at the
top level. So the candidates are a shape decision rather than a slice:

- a top-level `truncated`/`entityTotal` pair beside `entities`, mirroring the prop report;
- an `{about:"entities", detail:"summary"}` parameter — ids, generators and counts only, with
  a second arm for one entity's detail;
- splitting detail off entirely: the list arm carries ids + generator + footprint, and a new
  `{about:"entity", entityId}` arm carries the rest (this is also what a `session_query` tool
  description would rather advertise — "list, then ask about one").

The third is the most likely and is the most invasive, which is the argument for deciding it
once with evidence rather than bolting a cap on now.

## Trigger to revisit

**The first world whose entity list makes an answer unreadable, or T5's scale work — whichever
comes first.** Concretely, any of:

- a `session_query {about:"entities"}` result that a client truncates or that measurably eats
  an agent's context — the honest first signal, and the T4c review's gate walk is the first
  place it could appear (captures, tokens and wall time are already being recorded there);
- `listEntities()` routinely exceeding ~200 rows in a real project (at eight fields plus a box
  that is roughly where the answer stops being skimmable);
- any task adding a fourth `about` arm, at which point the request shape is open anyway and
  the summary/detail split costs a fraction of what it costs alone.

Not before then. The prop caps exist because they were MEASURED to matter at a reachable
count; putting a number here without the same evidence would be the guess this repo's planning
rule exists to prevent.

## Reference

- `packages/editor/src/field-host/field-query.ts` — `entitiesAnswer` (the unbounded `map`),
  `MAX_QUERY_PROPS` and `MAX_REPORTED` (the two that are bounded, each with its measurement),
  and `PropReport.truncated` (the signal shape an entity bound would need to mirror).
- `packages/editor/src/field-host/field-query.ts`'s `SelectionFact` — the same size risk
  answered a different way, by sending the replayable spec rather than the contents.
- `docs/reference/editor-architecture.md` §27.2 — the as-built, including why the prop report
  is exceptions rather than a roster.
- `packages/editor/tests/field-host/query.test.ts` — the cap and truncation cases, which an
  entity bound would extend rather than replace.
