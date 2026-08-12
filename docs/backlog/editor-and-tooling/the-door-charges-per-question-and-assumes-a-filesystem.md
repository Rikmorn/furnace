# The door charges per question, and one answer assumes the caller shares its filesystem

Filed at sculpting-worlds cycle 2's review (2026-08-12), from that cycle's E1 monastery run.
Two small, independent items, kept in one file because each is a few hours' work and neither
justifies its own entry. Both are about the door's ECONOMY rather than its capability.

## 1. Reads are one-per-round-trip, and rays are the common case

The cycle-2 run spent **14 of its 58 door calls on single rays** — a quarter of its whole
budget on one verb, one question at a time. Nothing about the read path requires that: a
`rays: [...]` batch on `session_query` is a loop at the host and would have paid for itself
several times over in that run alone. The same argument applies to any read a caller issues in
a sweep.

This compounds with `field-read-surface-gaps.md` (*a ray answers only the FIRST hit*): a
first-hit-only ray forces MORE rays, and each of those is a round trip. Fixing either one
reduces the pressure on the other, which is a reason to price them together rather than a
reason to defer both.

## 2. `project_get` hands back a path, not the catalog

`project_get`'s advertised answer is *"The absolute filesystem path of the project this editor
daemon is serving … use it to resolve the world names `world_list` reports against your own
filesystem tools"* (`packages/editor/src/daemon/mcp.ts:307`). That is honest about what it
does and quietly assumes the caller shares the daemon's filesystem.

**Any agent driving a remote editor cannot read the catalog at all** — materials, entity
archetypes and the agent profile are all project files under that path. In the cycle-2 run,
materials / archetypes / `agent.json` were read straight off disk, which worked only because
that agent was local. A remote one would have no way to learn the material classes it is
allowed to paint with, and would walk face-first into the scatter `variants` trap
(`docs/backlog/engine-architecture/scatter-variants-not-bound-to-archetype.md`) — a trap the
`sculpting-worlds` skill can only warn about because it cannot be checked over the wire.

An `about="catalog"` arm on `session_query` closes it: material classes with their kinds, prop
archetypes with their real variant counts, and the agent profile's walkability constants. Note
the door's byte budget is the binding constraint on a new arm — 327 B of 8,192 remained after
cycle 2's `flags` arm (`packages/editor/tests/mcp.test.ts`), so this one has to be argued
against the prose cap before it is argued on merit.

**A third item from the same run is NOT here**, because it already has a home: an aimable
off-screen capture (`eye`/`target`, not touching the human's camera) is the fourth section of
`agent-can-add-but-cannot-revise.md`, which cycle 2 confirmed with fresh measurement rather
than duplicating.

**Trigger to revisit:** the next agent-facing door change of any size — both of these are
cheap enough that they should ride along rather than be scheduled. Item 2 sooner if anyone
drives this daemon from a machine that is not the one serving it, which is the first thing that
turns it from an inefficiency into a wall.

**Reference:** `packages/editor/src/daemon/mcp.ts:303-307` (the `project_get` row) and the
byte-budget pin in `packages/editor/tests/mcp.test.ts`;
`docs/learnings/2026-08-12-agent-world-building-cycle-2-e1.md` §9. Siblings:
`docs/backlog/engine-architecture/field-read-surface-gaps.md`,
`agent-can-add-but-cannot-revise.md`.
