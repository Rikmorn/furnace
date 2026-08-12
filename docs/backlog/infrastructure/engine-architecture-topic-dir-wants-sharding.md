---
summary: `engine-architecture/` is the crowded topic dir and was deferred for sharding once, in a report nothing tracked cited
---

# `engine-architecture/` is the topic dir that wants sharding

Promoted 2026-08-12 from gitignored scaffolding during the docs-system archive sweep. The
2026-07-23 consolidation worklist carried a forward ruling — *the `engine-architecture/`
directory SPLIT is deliberately DEFERRED* — and no tracked doc carried it, so archiving that
report would have dropped the commitment.

## Context

`docs/reference/docs-system.md` §2 states the rule: one record per file, and **directories
shard by topic when crowded**. It does not say what "crowded" is, deliberately — a file count
is a poor instrument (that is the finding of
`docs/backlog/infrastructure/docs-registers-findability.md`).

`engine-architecture/` is nonetheless the standing candidate. Derive the current shape with:

```
for d in docs/backlog/*/; do printf '%-24s %s\n' "$(basename "$d")" "$(ls "$d"*.md | wc -l)"; done
```

It has been the largest dir through every prune round, and the earlier answer was to merge
entries into trackers — a move this design has since **retired** (§8). So the deferred split
is now the *remaining* lever for that directory, not one option among two.

Sharding is a directory move, and directory moves are what the rung-1 checks exist to make
safe: `bun run check` fails on any citation left pointing at an old path. Do it after the
tracker un-merge, not before — un-merging first tells you what the real sub-topics are, and
sharding a directory of merged trackers would just relocate the wrong unit.

## Trigger to revisit

Rung 5 (tracker un-merge + reference split), immediately after the un-merge lands and the
true per-entry sub-topics are visible. Not before.

## Reference

- `docs/reference/docs-system.md` §2 (the unit and sharding rule) and §8 (why merging is
  retired).
- `docs/backlog/infrastructure/docs-registers-findability.md` — the charter, and why a count
  threshold is not the trigger.
