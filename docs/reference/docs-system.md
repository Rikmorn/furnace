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

**Projection.** `bun run sitrep` reads the work register, the backlog and the reference
docs' `verified:` stamps, and prints the owner's board.
Nothing about the board is committed; it is computed from the same store each time, so it
cannot disagree with it.

The layers are ordered by cost of being wrong. Prevention is cheapest and weakest;
detection is the one that actually holds, because it runs whether or not anyone remembered.

## 2. Genres and registers

Every tracked doc belongs to exactly one genre. The genre fixes its unit rule, its
metadata, and how it dies.

**The boundary test:** true now → reference · happened → learnings/research · to do →
backlog · doing → work. Every misfiling violates that one line.

### `docs/reference/` — how the project IS today

Present tense, no history. One subsystem per file; a file that accumulates several
subsystems splits into a directory of per-subsystem files plus a generated index.

- **Unit:** one subsystem.
- **Kinds:** three share the genre — **as-builts** (`*-architecture`), **contracts**
  (conventions, posture, tsdoc), **consumer patterns** (`docs/reference/ui-foundation.md`,
  `docs/reference/fixed-step-interpolation.md`). Naming stays loose and the register stays
  flat until roughly 20 top-level files — reference paths are the repo's most-cited strings
  and churn buys nothing below that — then revisit flat-vs-sharded. **No
  kind-subdirectories** (owner ruling, 2026-08-13): a doc's kind is read from its content,
  and a path that encodes it invites a re-file every time the reading changes.
- **Frontmatter:** optional `verified: <date>` — when the doc was last checked against
  source. `bun run sitrep`'s REFERENCE FRESHNESS block lists every reference doc, stamped
  ones oldest first and unstamped ones after; it sets no staleness threshold, because how
  old is too old is a judgement about the doc's subject rather than the tool's to make.
  Stamp only at an actual verification, never at an edit that didn't re-check — an
  unstamped doc is an honest "never checked", and a stamp bought by an edit is a lie the
  block would then repeat.
- **Lifecycle:** never deleted, continuously corrected. When the reference disagrees with
  the source, the source wins and the reference is fixed in the same change.

### `docs/backlog/` — deferred work, unscheduled

- **Unit:** one deferral, one file, at `docs/backlog/<topic>/<slug>.md`. Topic dirs are
  kebab-case; add as needed, don't pre-create empty ones. **Nothing merges** (§8).
- **Naming:** slugs are content-names (§5 naming contract); same guidance as work items,
  because both are live to-do registers where the slug is identity rather than history.
- **Frontmatter:** see §4. `summary:` is required and feeds the generated index.
- **Body:** Context → **Trigger to revisit** → **Reference**.
- **Lifecycle:** promoted to `docs/work/` (entry deleted in the same commit) or resolved
  (entry deleted). `resolved` is not a status — it is a deletion. Git remembers.

### `docs/learnings/` and `docs/learnings/seals/` — what happened

Post-mortems, "we tried this and walked away" notes, and the chronological seal record.

- **Unit:** one file per learning; one file per seal plus an index row. No tracked doc may
  be a constant write target — an append-only record is a *directory*, never a file.
- **Filename:** `YYYY-MM-DD-<slug>.md`, pattern-checked (§9). The
  slug is a content-name (§5). Slugs of dated records are **immutable**: an ordinal token in
  one is a historical join key to the seal record, not a defect. New files cite slices by
  their content-names. Learnings files carry no frontmatter — **the date is the status.**
- **Seal filename:** `YYYY-MM-DD-<slice-slug>.md` — the seal's date plus the slug the slice
  died under; pattern-checked by the same rule (§9). **Frontmatter, seals only:** `summary:`,
  one line, feeding the generated index row; `sealed:`, the true seal date — where the record
  states none it carries the date the seal was extracted under, and `docs/learnings/seals/README.md`
  names those seals in prose rather than the table marking them, because provenance is a fact
  about one seal, not a column; `seq:`, an integer giving the seal's position in the true slice
  sequence, which is the index's sort key. Filename order is not slice order, which is why
  `seq:` exists and neither date field is the sort key.
- **Seals index:** `docs/learnings/seals/README.md` is generated between its
  `<!-- seals-index -->` markers from that frontmatter (`bun run docs:index`) and checked for
  drift (§9); the prose outside the markers is hand-written. One row is `sealed | linked
  summary` — packages are not a column, because every seal states them in its own head fields
  and a second copy is a second thing to rot.
- **Lifecycle:** immutable, at two strengths. **The seal record is absolutely immutable** — a
  seal is a dated snapshot of a moment, never edited to match later truth; a later seal
  supersedes it. **Dated learnings records are content-immutable** — what a record *claims* is
  never rewritten — permitting exactly three touches: (1) **filename dating that preserves the
  slug**, (2) **additive metadata** (the seal frontmatter above), (3) **mechanical repair of a
  citation broken by a later file move** — restoring a record's original referent is a
  correction, not a rewrite. Nothing else.

### `docs/research/` — pre-decision material

What fed a decision, kept so the decision can be re-litigated with the same inputs.
**Content-immutable** — what a doc *claims* is never rewritten — and carrying no frontmatter.
The same three touches the learnings genre permits apply here: filename dating that preserves
the slug, additive metadata (the `Fed:` line below), and mechanical repair of a citation
broken by a later file move.

**One exception:** `2026-07-23-f3b-p-f3-1-stepped-floor-probe.md` is re-emitted whole by the
test that produced it and carries a generated-by mark saying so, because a probe deliverable
is only re-litigable while its figures track the live suite — the record's authority sits in
the emitting test rather than in the file, which is why no new generator writes into a content
register without that mark and a ruling.

- **Filename:** `YYYY-MM-DD-<slug>.md`, or a dated directory `YYYY-MM-DD-<slug>/` carrying a
  `README.md` when the research is multi-file. Pattern-checked (§9); content stays exempt
  from the register checks. **One exemption:** `docs/research/assets/` holds
  binary payloads (screenshots, captures) for the docs that cite them, sharded
  `assets/<date>-<slug>/`. It is not a research doc — the date belongs on the shard, and
  the exemption is narrower than moving payloads under the docs they serve, which would
  force a dated research *file* to become a directory and break its citations, seals
  included.
- **Fed line:** each doc ends `**Fed:** <the decision, spec or reference it fed>` — a doc
  that fed nothing says so, which is the honest answer and a finding in its own right.
  Checked (§9), **one Fed line per doc**: a dated directory is one doc, so its `README.md`
  carries the line and the files beside it carry none. The line is what makes a research doc
  re-findable from the decision rather than only from its own title.

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

```
<!-- derive: <deterministic command> -->value<!-- /derive -->
```

The command runs at repo root and must be **deterministic** — sorted, stable output, no
timestamps, no network. The recorded value and the command's output are compared after
trimming; a mismatch fails the check. Commands come from tracked docs, which is the same
trust domain as the repo's own scripts.

**Prefer tier 2. A derive marker is a maintenance obligation; earn it** — and the cost is
paid by whoever changes the *subject*, not by whoever owns the doc. This section carried a
live marker on the backlog entry count for one day and it fired three times in that day,
each time on a doc the change had nothing to do with. The register grows a couple of entries
a day; the count was never a number a reader of this doc needed. It was demoted to tier 2
at the rungs 1–4 review, which is the rule applying to itself: **count of live backlog
entries — `find docs/backlog -name '*.md' -not -name README.md | wc -l`.** A marker earns
tier 3 when the value is load-bearing for the reader AND changes only when the doc's own
subject changes.

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
  is waiting on. **The slug must name a live item in `docs/work/`, and that is checked** —
  the field means *someone standing on the board reads this*, so it says nothing once the
  item is gone. An entry whose consuming slice is not scheduled yet gets a prose trigger
  instead; `consumer:` is not a wishlist.

  The failure mode this closes is quiet and structural: a seal DELETES its work item, so
  the ritual that closes a slice is the one that dangles every pointer into it, at the
  moment nobody is looking at the backlog. §6's promotion gate carries the matching sweep.

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

### The naming contract

Ruled 2026-08-17. The tier vocabulary, settled:

| tier | form | named by | ordinals |
| --- | --- | --- | --- |
| **epic** | a directory in `docs/work/` | content | never |
| **slice** | a file, in an epic directory or standalone | content | never |
| **task** | a numbered segment of a slice's plan | its ordinal within that slice | the only tier where they are legal |

- **A slug names its content and stands alone.** It has to be readable on the board without
  the reader supplying the parent epic or the queue position. Order lives in `after:` and in
  the directory structure — never in the name, which is the one place it cannot be corrected
  when the order changes.
- **Retired synonyms.** rung, wave, tranche, cycle, phase, stage, and letter-digit codes
  (F5, T4b, W2, 2.2.1) were all historical spellings of "slice". None is minted going
  forward. History stays as written: a seal, a learning or a body paragraph describing what
  happened keeps the word it happened under, and a dated record's slug is immutable (§2).
- **The bundle corollary.** An item that cannot carry one honest content-name is a bundle —
  split it or narrow it. This is the `summary:` rule one tier up: rungs 1–4 measured that a
  merged tracker cannot have one honest summary because it is not one record (§8), and the
  same test applied at naming time catches the same shape a register earlier.
- **Enforcement is guidance**, under the D8 posture — guidance over machinery, ruled
  2026-08-04 (`.claude/rules/working-standards.md` §Design) — **not a check.** A violation
  announces itself on every `sitrep`, is reversible by a rename, and the joins that would
  make a rename dangerous (`consumer:`, `after:`) are already checked, so a rename that
  misses an edge fails `bun run check` anyway. A denylist would buy that with permanent
  exemption-list curation. **Reopening trigger:** a position-code slug landing in a live
  register after this contract reopens the check decision.

**Sessions are not work items**, and are not a tier. A session is execution mechanics; a
slice may note its session protocol in its body, but the board never shows sessions.

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

A pin states its **kind**, its **basis**, and its **binding response**, in the test that
enforces it. A binding pin triggers re-derivation or re-review — **never a silent bump**.
Bumping the number to make the test pass converts the only signal into noise.

**Ratified 2026-08-12; pending on both live pins.** The taxonomy is settled and the two live
pins are classified, but neither yet carries the annotation, and one reads as the wrong kind
today (`WORD_BUDGET`, for a pin that is a drift alarm). Each annotation rides the slice that
next opens its pin, rather than a sweep:

| pin | kind | binding response | annotation rides |
| --- | --- | --- | --- |
| MCP door prose bytes (`packages/editor/tests/mcp.test.ts`) | budget — the door's context economics | re-derive against current economics, or cut prose | `door-set` (the re-derivation at door growth IS that slice) |
| agent world-building skill words (`packages/editor/tests/skill-references.test.ts`) | drift alarm — ratified size × slack | re-review and re-ratify | `vocabulary-expansion` (its work fires the alarm anyway) |

**The general rule this exposed.** A reference doc never states future conformance in the
present tense. This section originally read "Every pin states its kind…" while no pin did —
a convention described as an existing state on the day it was invented, in the document that
defines the rule against exactly that. Write "ratified; pending at `<slice>`" until the
slice lands. It is the values rule's sibling for claims rather than numbers: a dated
commitment is honest, an undated "is" that means "will be" is rot at birth.

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
`docs/reference/`, `docs/work/`. The dated shelves — `docs/learnings/`,
`docs/learnings/seals/`, `docs/research/` — are read for their **filenames**, research
additionally for its `Fed:` line, and seals additionally for their **frontmatter**, which
generates the seals index; their prose is never scanned.

| check | catches | polarity |
| --- | --- | --- |
| path-liveness — every `docs/…` or `packages/…` path cited in a scanned register exists | the dead-citation class | fail |
| file-plus-line-number ban | citations guaranteed to rot | fail |
| derive markers re-run and diffed | typed-count drift | fail |
| frontmatter schema per genre (zod) | contract violations | fail |
| generated-index diff — `docs/backlog/README.md` re-derived from every entry's `summary:` | index rot | fail |
| seals-index diff — the marked region of `docs/learnings/seals/README.md` re-derived from every seal's `summary:`/`sealed:`/`seq:` | a seal index hand-edited, or a seal added without its row | fail |
| work-register consistency — at most one `next`, `after:` targets exist, an `in-flight` epic still owns a slice | a board that lies | fail |
| `consumer:` names a live `docs/work/` item | pointers into a sealed slice | fail |
| shelf filenames are dated — `YYYY-MM-DD-<slug>.md`, or a dated directory for multi-file research | a record with no date, and so no status | fail |
| every research doc carries a `**Fed:**` line naming something | research findable only from its own title | fail |

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
- **Shelf exemptions, all three narrow.** `README.md` is an index, not a dated record.
  `docs/research/assets/` is out of scope entirely — binary payloads, dated per shard (§2).
  Inside a dated research directory only the `README.md` is the doc, so the files beside it
  need neither a date of their own nor a Fed line.
- **Cite the symbol, not the coordinate.** `markUnreachable` in `field-analyzer.ts`, never
  the file with a line number appended. Line numbers rot silently while the claim around
  them stays true, which is the worst failure shape: the reader trusts the sentence and
  lands somewhere unrelated.

**Also not checked:** `after:` cycles — only that the target exists. A small addition when
it earns it.

**What is not checked, and why.** Semantic claim rot — a sentence that is well-formed,
cites live paths, and is simply no longer true — is not mechanically detectable, and is an
open problem in the industry, not a gap in this design. The mitigation ladder is: shrink
the unfalsifiable surface (§3 tiers 2 and 3), then freshness stamps (§2, surfaced by
`bun run sitrep`), then agent
re-verification sweeps. The checks buy the mechanical classes so review attention can go to
the class that needs judgement.
