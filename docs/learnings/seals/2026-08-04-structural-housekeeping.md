# Structural housekeeping — the seal record, tests beside modules, two src splits

- **Sealed:** written **retroactively 2026-08-12**. The arc was verified and FF-merged to
  master on **2026-08-04**; no seal was written at the time. This file is dated to the merge,
  not to its writing — see §Why this seal is late.
- **Package(s):** core, dungeon, editor; `docs/learnings/` restructured.
- **Gate:** the arc's own gate at merge (`bun run check`, `bun run typecheck`, full root
  `bun test` green before FF). **No user walk was owed** — no render or interaction surface
  changed; every motion is file layout, test placement, and docs structure. Re-verified at
  seal time: `git show bddf320c` is on master and `master..HEAD` at seal contains no revert.
- **Suite:** not recorded at merge, and **not reconstructible** — see §What this seal cannot
  answer. The arc moved 246 core test files without changing their contents, so the count was
  expected flat; that expectation was never written down as a number.

**Counts, computed** (`BASE=323146f6`, `HEAD=bddf320c`):

| measure | value | command |
| --- | ---: | --- |
| commits | 20 | `git log --oneline $BASE..bddf320c \| wc -l` |
| diff | 314 files, +3,178/−1,278 | `git diff $BASE..bddf320c --stat \| tail -1` |
| seal files created | 27 | `git ls-tree -r --name-only bddf320c -- docs/learnings/seals \| grep -c '\.md$'` |
| `seal-log.md` at base | 115,728 B (113 KB) | `git cat-file -s $(git rev-parse $BASE:docs/learnings/seal-log.md)` |
| core tests beside modules | 172 in `src/` | `git ls-tree -r --name-only bddf320c -- packages/core/src \| grep -c 'test.ts'` |
| core `tests/` dir | 246 → 74 | same shape against `packages/core/tests` at each rev |
| field-host | 7,410 → 7,248 lines | `git show <rev>:packages/editor/src/viewport-host/field-host.ts \| wc -l` |

## The arc, in four motions

**1. The seal record became a directory.** `docs/learnings/seal-log.md` had reached 113 KB
with a single 42 KB line in it — a file every session appended to, loaded whole into context,
rotting in place. It was split into 27 per-seal files plus an index, and the general rule was
promoted into `AGENTS.md` the same day: **an append-only record is a directory of dated
entries plus an index carrying one line per entry and no content of its own.** That rule now
governs seals, learnings and the backlog, and the docs-system canon (2026-08-12) is built on
top of it.

**2. Tests moved beside their modules, and the publish boundary was PROVEN rather than
assumed.** 172 core test files now sit next to the source they test. The move raised a real
question — a test file inside `src/` could ship — and the answer was made mechanical rather
than trusted: declaration emit skips tests, and `no-bun-leakage.test.ts` was re-pointed to
read **the publish boundary** (the manifest's `files`/`exports`) instead of the `src/`
directory. That re-pointing is the load-bearing part: the guardrail's subject became the
thing that actually ships. Cross-module suites stayed in `tests/` (74 files) because they are
about no single module.

**3. The dungeon's flat `src/` became `world`, `field`, `agent`, `props`.** With a written
rule for what earns a `lib` or a `utils`, so the next file has somewhere to go by argument
rather than by habit. Two walk probes returned to `tests/` in the same pass — neither owned a
module in the directory it had landed in.

**4. The field-host closure was mapped, then cut against the map.** `field-host.ts` was 7,410
lines. The arc produced `docs/reference/field-host-clusters.md` — the closure mapped cluster
by cluster — and then extracted the first one (`field-segment.ts`, 323 lines) to test the map
against reality. The extraction found **two methodology gaps in the map**, which were written
back into it. That ordering is the lesson: the map was not trusted until something was cut
against it, and cutting is what falsified it.

## Did any file grow disproportionately? Yes — and that is the point.

`field-host-clusters.md` was born at 1,215 lines: a reference doc nearly as long as the
extraction it describes. That is proportionate for a decomposition map of a 7.4K-line closure
and it should SHRINK as clusters leave the host; if it is still 1,200 lines when the host is
under 2,000, the map has become a second copy of the code rather than a plan for removing it.

`field-segment.ts` (323 lines) is new surface, but it is relocated surface — `field-host.ts`
fell 248 lines in the same commit. The net +75 is the seam.

## Orphaned surface

**None recorded, and this is the seal's weakest claim.** No export lost its last consumer by
design — every motion was a MOVE, and moves preserve call sites (the gate would have failed
otherwise). But no orphan audit was run at the time, and one cannot be reconstructed from the
diff now: a name orphaned in 2026-08-04's tree may have acquired consumers since. Treated as
"no orphans expected, none verified" rather than "none".

## Why this seal is late, and what that cost

The arc was planned, executed against a plan, verified and merged as a slice — but no seal was
written, and nothing noticed for eight days. It surfaced on **2026-08-12**, when the
docs-system slice's archive sweep matched every scaffolding file against the seal record and
found three papers it could not place. The rule found it: *live scaffolding dirs hold unsealed
work only* turned an invisible process gap into files that would not classify.

What the delay cost is exactly the list above — the suite count is gone, the orphan question
is unanswerable, and the growth question is answered from the diff rather than from anyone's
memory of why. Everything the arc *shipped* landed tracked (`packages/dungeon/README.md`,
`packages/editor/README.md`, `docs/reference/field-host-clusters.md`), so no work was lost.
What was lost is the record only a seal makes, which is why the promotion gate now exists and
why this file is written despite being late: the seals directory is meant to be the complete
chronological record, and a hole in it is worse than a retroactive entry that says so.

There is precedent for writing seals after the fact — the T1a→T3c seals were written as a
consolidated backfill. Retroactive is a legitimate shape; silent is not.
