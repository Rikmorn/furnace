# Keeping a growing body of markdown findable — the register needs a design, not a number

**Context.** `AGENTS.md` § "Deferred work — `docs/backlog/`" has carried a size bar since the
register was created: prune when the register, or one topic dir, gets too big. At foundations T5
(2026-08-11) the user ruled that the bar gets relaxed *and* that relaxing it is not the fix:

> "these will only grow bigger, i think we should relax the threshold, and if it's truly a
> problem (and i suspect it might be) then this is something we need to look at properly as
> again, these will only get bigger as the project goes on and managing endless md files is a
> chore i would rather do properly and thoughtfully instead of just dialing numbers and keeping
> the doc strategy a mess"

The numbers moved to ~150 / ~50 in the same commit that filed this entry, marked provisional in
`AGENTS.md` and pointing here. This entry holds the real question, and it is deliberately a
charter, not a proposal — it frames the problem and does not pre-solve it.

**The question.** How does a long-lived project keep a growing body of deferred-work markdown
**findable** — so an entry is *read* when its trigger fires, rather than re-derived from scratch
by someone who never found it? That is the failure the file-count bar was a proxy for, and it is
the one thing the bar does not measure. The entry this one succeeds said it plainly of
`engine-architecture/` at 74 files: *"the dir where an entry is most likely to be re-derived from
scratch because nobody found it."*

## The evidence

Computed at `ddb49283` (branch `foundations-t5`). Census series, the source of every date and
count below:

```sh
for rev in $(git log --pretty=format:'%H' --reverse -- docs/backlog); do
  printf "%s %s\n" "$(git show -s --format=%ad --date=short "$rev")" \
    "$(git ls-tree -r --name-only "$rev" -- docs/backlog \
       | grep '\.md$' | grep -v 'README\.md$' | wc -l | tr -d ' ')"
done
```

Per-dir at any revision — swap `<rev>` for `HEAD` to get the current shape:

```sh
git ls-tree -r --name-only <rev> -- docs/backlog \
  | grep '\.md$' | grep -v 'README\.md$' | sed 's|/[^/]*$||' | sort | uniq -c
```

**Size over time.** 36 entries at the register's first expansion (2026-05-22) → **101 at
`ddb49283`** (102 once this entry lands), with a peak of **192 on 2026-07-23**. It last stood at
or under 100 on **2026-06-05** (`8358c63b`, at exactly 100) and has been over that bar every day
since — 67 days. `engine-architecture/` crossed the ~20 per-dir bar on **2026-05-22**
(`c3737499`, at 25) and never came back: its minimum across the 81 days since is 25.
`editor-and-tooling/` crossed on 2026-07-13.

**Rate.** Between the two named prunes, +36 entries in 17 days (133 → 169). Over the earlier
run, +92 in 48 days (100 on 2026-06-05 → 192 on 2026-07-23). Both ≈ **+2 net entries/day**, and
flat — there is no evidence of acceleration, and none of self-limiting either. Per-dir, the
*actively developed* dir carries most of it: `editor-and-tooling/` went 15 → 40 in the 17 days
after its own prune (~1.5/day) while `engine-architecture/` added 0.65/day over the same window.

**Prunes.** Three consolidation rounds, not the two usually named; one further large drop was
work-driven, not a prune:

| when | commit | what it did |
| --- | --- | --- |
| 2026-07-23 | `6d619879`, `9cf20a11`, `176124d8` | three theme merges, −23 combined (9→1, 6→1, 11→1) |
| 2026-07-25 | `a531088c` | `editor-and-tooling/` 37 → 15; register 155 → 133 |
| 2026-08-03 | `fd95a8f5` | −27, work-driven (entries for a deleted chrome), not a prune |
| 2026-08-11 | `9e12a3a1` | register 169 → 101; `engine-architecture/` 85 → 33, `editor-and-tooling/` 40 → 21 |

The T5 round's churn — `git show --name-status --format="" 9e12a3a1 -- docs/backlog` — is **85
deleted, 17 created, 17 modified, 2 renamed**: 84 entries relocated into merged trackers and
exactly one closed with a disposition. Nothing was dropped. Note what the round before it bought:
`a531088c` took `editor-and-tooling/` from 37 to 15, and 17 days later that same dir stood at 40 —
past the count that had triggered the prune.

**Shape at `ddb49283`.** 101 entries, **10,425 lines**, mean 103 lines
(`find docs/backlog -mindepth 2 -name '*.md' -exec wc -l {} + | sort -rn`). The distribution is
bimodal, not smooth: **61 entries under 60 lines** and **19 at 200 lines or more**, the largest
702 (`editor-and-tooling/editor-test-harness-fragility.md`), with six between 296 and 702.

## Why a number alone cannot be the answer

Two independent reasons, both visible in the numbers above.

1. **No constant survives the rate.** At +2/day the register re-crosses any bar within weeks of
   the prune that satisfied it. A bar with enough headroom to survive one epic (Epic 3's F-slices
   ran about four weeks) works out at 101 + 2/day × ~28 days ≈ **160–175** — which is to say, it
   has to legitimise the exact state (169) that everyone agreed needed pruning. Set it lower and
   it fires every few weeks and gets ignored, which is what happened: the ~100 bar was in
   continuous violation for two months and no session acted on it until T5. The ~150 / ~50 pair
   now in `AGENTS.md` is the compromise between those two failures, and it is a compromise, not a
   finding.

2. **The remaining moves make things less findable, not more.** T5 stopped at 101 rather than 100
   because the only ways down were to merge a charter input — an entry a named future slice reads,
   which the prune bar forbids — or to re-merge trackers that already run **296 to 702 lines**
   into 700–1,000-line documents. Trading a threshold number for
   documents nobody can scan reintroduces the exact problem the threshold exists to prevent, from
   the other side. **The bar and the only remaining way to satisfy it point in opposite
   directions.** That is the signal that the instrument is wrong, not that the number is.

## Tensions a design has to resolve

Stated as constraints, not as candidate solutions. Any proposal has to answer all of these.

- **Consolidation vs findability.** Merging buys a shorter `ls` and costs a longer read. Both
  ends fail: 85 files in one dir (nobody finds the entry) and one 702-line tracker (nobody finds
  the section). There is no evidence about where between them the cost is minimised — that is
  measurable and has never been measured.
- **The three-register boundary has never been tested.** `docs/backlog/` (deferred work),
  `docs/reference/` (how the project IS today), `docs/learnings/` (what we tried, plus dated
  seals) have edges stated in `AGENTS.md` but no test that anything lands where the rule says.
  The pressure is real: a merged tracker that has accumulated rulings starts reading like
  reference, and a closed entry's disposition is history. If entries are being filed in the wrong
  register, no amount of tuning the backlog's own bar helps.
- **Charter inputs must stay separate files.** Some entries are read by a *named* future slice —
  T5 protected these explicitly, and the 2026-07-25 round protected six gate-UX / interaction-model
  set files from merging. Any scheme that consolidates by size rather than by readership breaks
  them. Conversely, nothing marks a charter input as one today; the protection is per-round
  judgement, re-made from scratch each time.
- **Entries are DELETED continuously, so append-only shapes are wrong here.** 335 deletions
  against 436 additions over the register's life — `git log --diff-filter=D --name-only -- docs/backlog`
  and its `=A` twin, README rows excluded; the two net to exactly the 101 at `ddb49283`. This is why
  `docs/backlog/README.md` carries a
  **per-dir count** index rather than a per-entry one: a per-entry index would be a constant write
  target that rots between sessions — the failure mode `AGENTS.md` names for append-only records —
  while `ls docs/backlog/<topic>/` cannot go stale. Any design that reaches for "add an index"
  has to answer this first.
- **Two readers, possibly two needs.** An agent greps; a human `ls`es and skims. The register is
  read far more often by agents than by people, and it is not established that the shape that
  serves one serves the other.

## Where to look before proposing anything

`.claude/rules/working-standards.md` carries a precedent-fidelity check for designs that adopt a
published approach (§ Planning) and a reference-implementations-before-reverse-engineering rule
(§ Debugging). Both assume a precedent search happens first. For this problem it never has —
every round so far has been improvised. It is a solved-ish problem in at least three literatures:

- large-codebase practice for deferred work that is deliberately *not* an issue tracker;
- ADR / decision-record practice, for how a growing record of "we decided X" stays navigable;
- personal-knowledge-management, which has spent two decades on exactly "a growing pile of
  markdown that has to stay findable".

Naming these is scope for the research pass, not an endorsement of anything in them.

**This wants its own brainstorm + research session** — not a task inside a polish tranche. It is
a design question about how the project keeps its own memory, it touches all three doc registers,
and every attempt so far to handle it inside another tranche has produced a consolidation round
instead of an answer — the last one bought 17 days.

**Trigger to revisit:** at the next prune — i.e. the first time the register crosses the
provisional ~150 / ~50 bar in `AGENTS.md` § Deferred work. Do this design pass **instead of** a
fourth consolidation round; a fourth round buys another few weeks and answers nothing. Secondary
trigger, if it fires first: the first session that catches itself re-deriving something the
register already held.

**Reference:** `AGENTS.md` § "Deferred work — `docs/backlog/`" (the provisional bar and its
pointer here) · `docs/backlog/README.md` (§ Pruning's three moves, § Two file shapes' no-re-merge
rule, and the per-dir index rationale) · prune commits `a531088c` and `9e12a3a1` · the entry this
one succeeds, resolved by the T5 prune and recoverable with
`git show 9e12a3a1^:docs/backlog/engine-architecture/backlog-topic-dirs-over-the-prune-threshold.md`
— it is where the "re-derived because nobody found it" framing and the ~150 escalation number
were first written down.
