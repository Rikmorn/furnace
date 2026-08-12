---
summary: the structural-housekeeping arc merged to master 2026-08-04 with no seal file, so its promotion gate never ran
---

# Structural housekeeping shipped without a seal

Found 2026-08-12 by the docs-system archive sweep, which matched every scaffolding file
against the seal record and could not place this arc's three papers.

## Context

The structural-housekeeping arc — the `seals/` directory split, tests-beside-modules with a
proven publish boundary, the dungeon `src/` split, and the field-host cluster map plus its
first extraction — was verified and merged to master on 2026-08-04. **No seal file exists for
it.** Derive:

```
grep -rl "housekeeping" docs/learnings/seals/
```

returns nothing, and no seal's prose mentions the arc.

Its outcomes did land in tracked docs (`packages/dungeon/README.md` records
tests-beside-module; `docs/reference/field-host-clusters.md` is the decomposition map;
`packages/editor/README.md` carries the extraction record), so this is not lost work. What is
missing is the seal itself — and therefore the things only a seal does: the computed counts,
the orphaned-surface record, the disproportionate-growth question, and now the promotion gate
added 2026-08-12.

Its scaffolding was deliberately LEFT in the live dirs by that sweep rather than archived,
because the rule is that live dirs hold unsealed work. That is the correct state, and it is
also the visible symptom — those files will sit there until the arc is sealed or explicitly
ruled not-a-slice.

## Trigger to revisit

Either the owner rules it "not a slice, no seal owed" (in which case archive its three
scaffolding files and delete this entry), or the next session with the arc's context writes
the seal retroactively. The second is worth more: the arc is the origin of the append-only
record rule that the docs-system canon now depends on.

## Reference

- `docs/learnings/seals/README.md` §Writing a seal — what a seal must answer, including the
  promotion gate added 2026-08-12.
- `docs/reference/field-host-clusters.md` and `packages/dungeon/README.md` — where the arc's
  outcomes did land.
