# Skill-cycle worlds have no durable home — run numbers rest on one machine's scratch bake

Cycle 1 of the sculpting-worlds skill named the gap from the inside: the RED
baseline's world (`red-1`) stayed a local bake under the gitignored
`packages/dungeon/worlds/`, so the review had to label the run-record numbers
honestly-UNVERIFIABLE — "a cycle designed as a before/after kept no committed
before" (`docs/learnings/2026-08-11-agent-world-building-cycle-1.md`).

At the cycle-2 planning session (2026-08-12) the owner ruled the deferral
**deliberate**: cycle worlds stay local and gitignored, verification runs on
the authoring machine, "avoid all the world baggage (at least for now) until
we have a more permanent and scalable solution" — sole contributor today, so
the cost is bounded. This entry keeps the ruling from becoming folklore.

## Shape, when taken

Sized during that planning session (`du -sh packages/dungeon/worlds/red-1` and
`du -h` over its contents, 2026-08-12 — the artifact is local by this same
ruling, so the numbers are one machine's): the full baked dir is ~13 MB, of
which meshes 5.8 MB + chunks 4 MB + kit 1.3 MB are bake derivatives; the
authoring record — `oplog.json` 1.7 MB + `manifest.json` 100 K +
`placements.json` 3 K — is ~1.8 MB of diffable JSON. A compact durable form
would commit the authoring subset only, gated by a probe that a reload/re-bake
from just those files reproduces the world. Alternatives if the probe fails:
full-dir exception, or artifact storage outside git.

## Trigger to revisit

A second contributor or CI needs to re-run a cycle's numbers — or the tooling
session (doc strategy, `infrastructure/docs-registers-findability.md`) takes
artifact storage into its scope, whichever fires first.

## Reference

- `docs/learnings/2026-08-11-agent-world-building-cycle-1.md` — the gap, named
  ("The artifact that is not there").
- `docs/learnings/seals/2026-08-12-sculpting-worlds-cycle-1.md` — the cycle-1
  close this ruling follows from.
- `packages/dungeon/.gitignore` — the `worlds/*` exclusion (index.json +
  default excepted) that makes worlds local today.
