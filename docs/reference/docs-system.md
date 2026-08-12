# The docs & knowledge system

How this repo's written knowledge is stored, checked, and retired. Canonical — if a
practice here disagrees with a habit, this file wins and the habit is the bug.

The write-time summary lives in the docs-authoring rules file loaded into every agent
session; it is deliberately short and points here. This file carries the rationale, the
schemas, and the lifecycle.

**The one-sentence architecture:** docs shrink to judgement and history, tools answer the
present, checks patrol the boundary, and projections give each reader their own view of the
same store.

## 1. The layers

**Store.** Plain markdown in git. One record per file. No database, no second index of
extracted facts — a second store is a second thing to rot.

**Prevention.** The docs-authoring rules file under `.claude/rules/`, loaded into every
agent session. It is the only layer that costs context on every turn, so it holds
imperatives and no rationale. Anything that needs a "because" belongs here instead.

**Canon.** This file. Read on demand, by a human or an agent that needs the why.

**Detection.** `scripts/check-docs.ts`, wired into `bun run check` — not into the test
suite, so it adds nothing to the long gate. It re-derives what can be re-derived and fails
on what it can prove wrong. §9 is the table of what it enforces.

**Projection.** `bun run sitrep` reads the work register and prints the owner's board.
Nothing about the board is committed; it is computed from the same store each time, so it
cannot disagree with it.

The layers are ordered by cost of being wrong. Prevention is cheapest and weakest;
detection is the one that actually holds, because it runs whether or not anyone remembered.

## 2. Genres and registers

Every tracked doc belongs to exactly one genre. The genre fixes its unit rule, its
metadata, and how it dies.

### `docs/reference/` — how the project IS today

Present tense, no history. One subsystem per file; a file that accumulates several
subsystems splits into a directory of per-subsystem files plus a generated index.

- **Unit:** one subsystem.
- **Frontmatter:** none required. Optional `verified: <date>` freshness stamp.
- **Lifecycle:** never deleted, continuously corrected. When the reference disagrees with
  the source, the source wins and the reference is fixed in the same change.

### `docs/backlog/` — deferred work, unscheduled

- **Unit:** one deferral, one file, at `docs/backlog/<topic>/<slug>.md`. Topic dirs are
  kebab-case; add as needed, don't pre-create empty ones. **Nothing merges** (§8).
- **Frontmatter:** see §4. `summary:` is required and feeds the generated index.
- **Body:** Context → **Trigger to revisit** → **Reference**.
- **Lifecycle:** promoted to `docs/work/` (entry deleted in the same commit) or resolved
  (entry deleted). `resolved` is not a status — it is a deletion. Git remembers.

### `docs/learnings/` and `docs/learnings/seals/` — what happened

Post-mortems, "we tried this and walked away" notes, and the chronological seal record.

- **Unit:** one file per learning; one file per seal plus an index line. No tracked doc may
  be a constant write target — an append-only record is a *directory*, never a file.
- **Frontmatter:** none. **The date is the status.**
- **Lifecycle:** immutable. A seal is a dated snapshot of a moment and is never edited to
  match later truth; a later seal supersedes it.

### `docs/research/` — pre-decision material

What fed a decision, kept so the decision can be re-litigated with the same inputs.
Immutable, dated, no metadata.

### `docs/work/` — scheduled and live (§5)

### `docs/superpowers/` — scaffolding, gitignored (§6)

Specs, plans, execution reports, prompts. Not in git, not citable from tracked docs, ever.

## 3. The values rule

**Docs state facts, not derivable values.** A value that a tool can compute belongs in the
tool query, not in prose, because prose starts rotting the moment it is committed. Three
tiers:

**Tier 1 — dated snapshots.** A measurement taken at a moment: a seal's suite count, a
charter's corpus size, a benchmark. These are immutable facts *about that moment* and are
exempt from all staleness logic. Keep the number; put the deriving command beside it so a
reader can take the same measurement today and compare.

**Tier 2 — present-tense derivable values: command-only by default.** State the fact and
how to derive it, not the number. "The backlog is grouped in seven topic dirs
(`ls docs/backlog/`)" survives; "the backlog holds 118 entries" is wrong within a week.
This tier is judgement and review, not machinery — bare-number detection would drown in
false positives.

**Tier 3 — derive markers, the narrow escape hatch.** Where a reader genuinely needs the
value inline, wrap it so the check can re-derive it:

Live backlog entries, re-derived by `bun run check` on every run:
<!-- derive: find docs/backlog -name '*.md' -not -name README.md | wc -l | tr -d ' ' -->121<!-- /derive -->

The command runs at repo root and must be **deterministic** — sorted, stable output, no
timestamps, no network. The recorded value and the command's output are compared after
trimming; a mismatch fails the check. Commands come from tracked docs, which is the same
trust domain as the repo's own scripts.

Prefer tier 2. A derive marker is a maintenance obligation; earn it.

## 4. Statuses and supersession

Backlog frontmatter, validated by zod:

```yaml
---
summary: one line, extracted into the generated index
status: open | deferred | superseded        # open = default, omit it
superseded-by: <slug>                        # on the OLD entry
supersedes: <slug>                           # on the NEW entry
consumer: <slice-slug>                       # charter inputs only
---
```

- **`open`** is the default and is omitted rather than written. Most entries are open.
- **`deferred`** means overtaken by events but not contradicted — kept, not scheduled.
  Never applied in bulk; only when the entry's own body says it was overtaken.
- **`superseded`** requires `superseded-by`. **Both edges are written in one commit** — the
  old entry gets `superseded-by`, the new one gets `supersedes`. A one-directional link is
  a check failure waiting to happen and a dead end for the next reader.
- **`consumer: <slice-slug>`** marks an entry that a named future slice reads as an input.
  It is mechanical protection: a consolidation pass may not touch an entry that something
  is waiting on.

There is no `resolved` status. Resolved means the file is deleted.

## 5. The work register

**Backlog = unscheduled. `docs/work/` = scheduled and live. Seals = done.** The register
closes the gap where the queue lived in an agent's memory files and was invisible to the
owner.

**Shape:** epic = directory, slice = file.

```
docs/work/
  <epic-slug>/
    README.md          # the epic record: goal, exit condition, status
    <slice-slug>.md    # a slice of that epic
  <slice-slug>.md      # a standalone slice
```

Structural containment IS the parent edge. There is no `kind:` field and no `parent:`
field, so neither can dangle or disagree with the tree.

**Slice frontmatter:**

- `status: queued | next | in-flight | blocked-on-owner` — **at most one item holds
  `next`**, checked.
- `summary:` — one line, what the slice is.
- `injected: true` — present only when the slice was scheduled ahead of an in-flight
  epic's remaining slices. The point is to price the injection by making it visible; epics
  used to absorb injected work silently.
- `after: <slug>` — optional, and only for a *ruled* sequence. Queued items without it are
  an unordered pool, which is the honest default. The target must exist, checked.

**Epic README frontmatter:** `status: queued | in-flight` and `summary:`; the exit
condition goes in the body.

**Lifecycle:** backlog entry promoted → work item created, entry deleted. Slice sealed →
file deleted; the seal is the tombstone. Epic closed → directory deleted with its last
slice. The register holds only the present and near future — roughly 5–15 files. If it is
growing, that is the signal, not the storage.

**Sessions are not work items.** A session is execution mechanics; a slice may note its
session protocol in its body, but the board never shows sessions.

## 6. Scaffolding lifecycle

**The join is by slug, never by path.** Scaffolding files are named for the work-item slug
they serve: `specs/<date>-<slug>-design.md`, `plans/<date>-<slug>.md`,
`report/<date>-<slug>-*.md`. Finding a slice's papers is a glob on its slug. Tracked docs
never cite a scaffolding path — the whole tree is gitignored, so a citation is dead for
every other clone and stale for this one.

**The promotion gate.** A seal does not close until:

1. **Durable facts are promoted.** Walk the scaffolding files named by the slice's slug and
   ask of each fact: does anything tracked depend on this? If yes, it moves into
   reference / backlog / learnings before the seal closes.
2. **The work item is deleted.** The seal is the tombstone; a closed epic's directory goes
   with its last slice.
3. **The scaffolding is archived** — the slug's files move to the archive dir under
   `docs/superpowers/`.

Live scaffolding dirs therefore hold **unsealed work only**, which makes the working set
self-limiting instead of a pile that outgrows the tracked corpus. The archive is local,
unbounded, and never cited.

## 7. Prose-pin taxonomy

A prose pin is a byte or word budget asserted by a test against prose that an agent pays
for on every call. Two kinds, and a pin must say which it is:

- **Budget** — derived from consumer economics (a context window, a tool-description
  limit). Exceeding it is a real failure. The binding response is to re-derive the budget
  against current consumer economics, or cut prose.
- **Drift alarm** — a ratified size times some slack. It does not encode a limit; it
  detects unnoticed growth. The binding response is re-review and re-ratification.

Every pin states its **kind**, its **basis**, and its **binding response**, in the test
that enforces it. A binding pin triggers re-derivation or re-review — **never a silent
bump**. Bumping the number to make the test pass converts the only signal into noise.

The two live pins and their ratified dispositions: the MCP door's prose byte budget is a
**budget**, re-derived when the door grows; the agent world-building skill's word pin is a
**drift alarm**, re-reviewed and re-ratified when it fires.

## 8. Pruning

A prune is **keep-by-default** and has exactly three moves. Deletion is not one of them.

- **Promote** — the trigger fired. Take the work; delete the entry in the commit that
  resolves it, or in the commit that creates its work item.
- **Consolidate** — *generated views only*. Same-theme entries are surfaced together by
  the generated index, not by merging files.
- **Close with a disposition** — only for an entry that **directly contradicts current
  direction**, and only after its live residual is re-filed as a narrower entry. Where a
  disposition is unclear, KEEP.

"No consumer", "nobody has looked at it in a year" and "the file count is high" are **not**
grounds for deletion. The same reasoning governs the engine's own surface — see
`docs/learnings/seals/README.md` §Writing a seal: an orphaned name is a candidate for
JUDGEMENT, not for the bin. Entries carrying `consumer:` are untouchable by a prune.

**The merged-tracker shape is retired.** Consolidating entries into multi-entry tracker
files was tried and measured as a failure at both ends: it traded 85-file directories for
296–702-line documents, and the merge itself propagated stale content verbatim. Everything
that scaled past a hundred records — Rust RFCs, PEPs, KEPs, Oxide RFDs, MADR — lands on one
record per file with merged views generated. The existing merged trackers are scheduled to
be un-merged, and no new merge is made.

**Size bars are provisional and are not the real question.** A file count is a proxy for
findability, and a poor one: the register grows at roughly +2 net entries per day, so any
fixed count is re-crossed within weeks of the prune that satisfied it. The holding numbers
live in `AGENTS.md` § "Deferred work"; don't re-dial them there.

## 9. Checks

`scripts/check-docs.ts`, run by `bun run check`. Scanned registers: `docs/backlog/`,
`docs/reference/`, `docs/work/`.

| check | catches | polarity |
| --- | --- | --- |
| path-liveness — every `docs/…` or `packages/…` path cited in a scanned register exists | the dead-citation class | fail |
| file-plus-line-number ban | citations guaranteed to rot | fail |
| derive markers re-run and diffed | typed-count drift | fail |
| frontmatter schema per genre (zod) | contract violations | fail |
| generated-index diff | index rot | fail |
| work-register consistency — at most one `next`, `after:` targets exist, epic status agrees with its children | a board that lies | fail |

**Scope rules.**

- **Seals, dated learnings and research are exempt** from path-liveness. They cite the past
  truthfully; a path that was live when the seal was written is not an error.
- **Deliberate dead paths** in live registers are written `` `the/old/path.ts` (gone) ``.
  The marker records that something was deleted, which is a fact worth keeping. Unmarked
  dead paths fail.
- **`git show <sha>:<path>` forms are exempt** — they are commit-pinned and checked against
  history, not the working tree.
- **Template placeholders are exempt** by construction: the path pattern excludes angle
  brackets, so `docs/backlog/<topic>/<slug>.md` never matches.
- **Cite the symbol, not the coordinate.** `markUnreachable` in `field-analyzer.ts`, never
  the file with a line number appended. Line numbers rot silently while the claim around
  them stays true, which is the worst failure shape: the reader trusts the sentence and
  lands somewhere unrelated.

**What is not checked, and why.** Semantic claim rot — a sentence that is well-formed,
cites live paths, and is simply no longer true — is not mechanically detectable, and is an
open problem in the industry, not a gap in this design. The mitigation ladder is: shrink
the unfalsifiable surface (§3 tiers 2 and 3), then freshness stamps, then agent
re-verification sweeps. The checks buy the mechanical classes so review attention can go to
the class that needs judgement.
