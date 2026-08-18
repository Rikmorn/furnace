---
summary: source comments and package READMEs cite backlog entries by path, nothing in `check` or `test` opens a file under `packages/`, and several such citations point at entries deleted months ago
---

# Nothing checks the backlog citations that live in `packages/`

`packages/` source comments and package READMEs routinely point a reader at a deferred-work
entry by path — *"see `docs/backlog/<topic>/<slug>.md`"*. When that entry is later resolved,
consolidated or renamed, the citation is left naming a file that no longer exists, and
**nothing in the repo notices**.

## Context

Dangling today. Derive it — and scope it to TRACKED files, or build output under
`packages/*/dist/` inflates the answer with stale bundled source maps:

```sh
git ls-files packages | xargs grep -hoE "docs/backlog/[a-z0-9-]+/[A-Za-z0-9._-]+\.md" \
  | sort -u | while read -r p; do [ -f "$p" ] || echo "DANGLING $p"; done
```

At the time of filing it names four entries under `engine-architecture/` — the retired
`material-ownedbuffers-dead-after-unlit-retirement.md`, `pipeline-cache-cross-context-leak.md`,
`rigidmesh-teleport-reset.md` and `typed-uniform-setters.md` — cited from
`packages/core/src/material/types.ts`, `packages/core/src/material/pipeline.ts`,
`packages/core/src/post/pipeline-cache.ts`, `packages/core/src/resources/manager.ts`,
`packages/cookbook/src/demos/physics/help.ts` and `packages/cookbook/src/demos/shader/help.ts`
— plus one under `editor-and-tooling/` cited from **`packages/editor/README.md`**. All
predate the `genre-contracts` slice; all are present at `master`.

**Two instruments are needed, not one.** The command above sees full paths only. The same
README line that carries the dangling full path also names two SIBLINGS by bare basename
(`field-f3a-gate-ux-findings.md`, `field-f3b-gate-ux-findings.md`), and both were deleted in
the same commit as the first. Bare basenames need the other instrument — extract every `*.md`
token from tracked files and subtract the basenames that exist:

```sh
git ls-files | xargs grep -ohE '[A-Za-z0-9][A-Za-z0-9._-]*\.md' | sort -u \
  > /tmp/cited && git ls-files | xargs -n1 basename | sort -u > /tmp/exist \
  && comm -23 /tmp/cited /tmp/exist
```

That one over-reports its *citer* attribution (its listing step matches by substring), so
verify each name with an anchored grep before acting on it.

**Why nothing catches this.** `scripts/check-docs.ts` scans `LIVE_REGISTERS`, which is `docs/backlog`, `docs/reference` and
`docs/work`. `scanDeadPaths` therefore never opens a file under `packages/`, whatever form
the citation takes; and the test suite has no reason to read a comment. Probed during the
`genre-contracts` slice with a planted full-path citation to a deleted tracker, placed in
both a `packages/` source file and a `packages/` test file: **both passed `bun run check`
AND `bun run test`.** The same probe found a full-path citation from `docs/reference/` fails
RED, and a bare basename in that same directory passes GREEN — so the guarded surface is
"full paths inside three `docs/` directories", and everything else is hand-swept.

**This class has been filed and closed once before, and how it came back is the argument for
mechanising it.** `backlog-refs-in-source-comments-dangle-after-prune.md` (gone) tracked
exactly this from the 2026-07-25 prune, and was retired at the F4.5 seal (2026-08-03) on a
sweep the seal describes as closing *every* site. The sweep's own command was scoped to one
topic directory (`docs/backlog/editor-and-tooling/`), so citations into every other topic
directory were structurally outside its reach — and one of the entries still dangling from a
package README was deleted by that same seal's arc. A manual sweep closed the sites it could
see and nothing kept them closed.

**A proposal, not a conclusion.** A one-line CI check of the shape above would catch the whole class. **That is a
recommendation carried out of the slice that found the dangling paths, and it has not been
verified as a check.** Before it becomes scheduled work, at least these need answering:

- **Where does it live** — a new `scanDeadPaths` scope inside `scripts/check-docs.ts`
  (making `packages/` a fourth scanned root), or a separate script? The canon's checks table
  and its scope rules are written around the three `docs/` registers; widening the scan is a
  scope decision about what `bun run check` is for, not a regex change.
- **What is its false-positive rate** — the register is full of legitimately dead paths
  written as `` `old/path.ts` (gone) ``, and the same convention would have to apply inside
  source comments, where a `(gone)` marker in a TSDoc block reads oddly.
- **Does it want the bare-basename instrument too**, given that the two forms coexist on one
  README line today. That instrument's citer attribution is known-loose and needs an anchored
  match first.
- **What it does to the deletion workflow** — resolving a backlog entry would start failing
  the gate until every `packages/` citer is repaired in the same commit. That is the point,
  but it is a cost worth naming before adopting.

## Trigger to revisit

The next time a backlog entry is deleted or renamed (every close does this — the check is
what would make the repair non-optional), OR when `scripts/check-docs.ts` next gains a rule,
whichever comes first. Sooner if a reader follows one of the dangling citations and is
misled.

## Reference

- `scripts/check-docs.ts` — `LIVE_REGISTERS` and `scanDeadPaths`.
- The docs-system canon under `docs/reference/` — the checks table and its scope rules.
- `docs/backlog/infrastructure/bare-line-refs-escape-the-citation-check.md` — the sibling
  blind spot in the same checker, and the same posture question.
- `docs/backlog/infrastructure/docs-registers-findability.md` — the design charter this
  feeds, including its *Citation integrity* section.
- `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md` — the seal that retired the
  predecessor entry, and whose sweep command is the reason it came back.
