---
summary: the docs file:line citation check anchors on a filename, so bare offsets, space-separated refs and the prose "lines 70–77" spelling all rot unflagged — and a fix has to decide what it does with dated ones
---

# Bare, space-separated and prose line refs escape the file:line check

Filed 2026-08-12 during the docs-system rung-1 triage, which fixed 103 flagged `file.ts:N`
citations and left this class untouched because the checker cannot see it.

## Context

`scanFileLineCitations` in `scripts/check-docs.ts` anchors on a filename: it matches
`name.ts` immediately followed by `:` and digits. **Three spellings dodge that anchor**, and
all three rot exactly as fast as the flagged form:

1. **Bare continuation offsets** — a file is cited once in full, then continued with
   `` `:240-241`, `:279` ``.
2. **Space-separated refs** — the name and the offset are both there, just not adjacent:
   `` `BrushShape` :97-110 ``.
3. **The prose spelling** — the offset written as English rather than punctuation. Live in
   the register today: `` `attachMouse`, lines 70–77 `` (`pointer-lock-and-relative-motion.md`),
   `` in `buildSnapshot()` (lines 36–37) `` (`gpu-render-and-compute-ms-are-null.md`),
   `` `internal.ts`, lines 43–47 as of 2026-08-11 `` (`ctxid-wraparound-aliases-handles.md`),
   and `` — line 50 `` (`session-confirm-claims-enter.md`). Surfaced at the `genre-contracts`
   un-merge (2026-08-18), which is also when form 3 was recognised as its own spelling rather
   than a variant of form 2.

**Do not hand-maintain a list of instances here.** This entry's subject is an instrument
going blind; a typed list is the same defect in prose, and the one filed at rung 1 proved it
— it named four files, two of which no longer exist, one of which no longer carries the form,
and it missed the register's largest concentration entirely. Derive it:

```sh
# forms 1 + 2 — bare and space-separated offsets, in the checker's own three registers
grep -rnE '`:[0-9]+(-[0-9]+)?`|`[A-Za-z_.()]+` +:[0-9]+' docs/backlog docs/reference docs/work
# form 3 — the prose spelling (en-dash and hyphen ranges both)
grep -rnEi '\blines? [0-9]+' docs/backlog docs/reference docs/work
```

Read every hit; a meaningful share are not citations (below). Two facts the re-derivation
settled: the heaviest single concentration is a markdown TABLE of bare offsets in
`gesture-anchor-clear-wants-a-name.md`, whose own prose says they "have since rotted outright
— grep by symbol, not by line"; and **the class is not backlog-only** —
`docs/reference/field-host-clusters.md` carries several, two of them stamped with the date
they were re-derived.

This is deliberately NOT fixed inline: a bare `:N` in prose collides with times, ratios,
section refs and version strings, so any regex that catches it is a false-positive posture
decision, not a mechanical widening. The re-derivation turned up two live in-register
collisions that are not hypothetical — **port numbers** (`` Vite `:5173` ``, `` Storybook
`:6006` `` in `editor-backend-architecture.md`) and **hyphenated compounds**, where
"870-line 11-context provider" reads as `line 11` to form 3's pattern.

Options worth weighing: require the citation to be inside backticks AND on a line that also
names a source file; restrict to `:N-M` ranges; or leave it to review and accept the
residual. **And a nuance that changes the target of the rule:** one of the form-3 examples
above writes *"lines 43–47 as of 2026-08-11"*. A dated line reference is arguably
values-rule-COMPLIANT — it is a snapshot with its date attached, which is exactly what the
values rule asks a rotting figure to carry. So the rule's real target is the **undated** line
ref, and a regex that catches dated ones is over-broad on its face. `field-host-clusters.md`
does the same thing in a reference doc, twice, with an explicit *(re-derived …)* parenthetical.
Whatever posture is chosen has to say what it does with those, and "flag them" is not
obviously right.

**The counter-example, and it is not a singleton.** Some bare `:N`s in the register are prose
*recording* a citation's rot, not making one — the register's own idiom for "we stopped citing
this by line". Three today: `void-cast-progress-is-indeterminate.md` (`` `:1364-1374` ``,
beside an explicit "cited by NAME rather than by line range on purpose"),
`rename-duplicate-teach-by-error-toast.md` (four abandoned offsets, plus the durable `grep -n`
instrument that replaced them), and `catalog-collision-schema.md` (quoting the original
citation inside a dated historical correction). A checker that flags these flags the entries
that already did the right thing. Any posture must exempt them — which is the strongest
argument for "inside backticks AND on a line that also names a source file", since none of
the three names a live source path on the offending line. **But that same criterion is not
sufficient** — verified against the live instances, it also misses real citations that wrap:
`segmented-hint-throws-without-tooltipprovider.md` names its source path on one line and
continues `` at `:136-139` `` on the next, which the same-line test would let through. So the
backticks-plus-filename option buys the counter-example exemption at the price of a
line-boundary blind spot, which is the four-instrument class this repo has hit repeatedly.
That tradeoff is the decision, and it should be made with both halves on the table.

## Trigger to revisit

When a bare `:N` ref is found to have rotted and misled someone, or when the checker next
gains a rule (batch the posture decision with that work). Not urgent: the flagged class was
the large one, and this one is bounded — re-derive it with the commands above rather than
trusting any figure written here.

## Reference

- `scripts/check-docs.ts` — `scanFileLineCitations` and `FILE_LINE_RE`.
- The docs-system canon under `docs/reference/` — the checks table and its scope rules —
  and the docs-authoring rules file, which carries the "never cite file plus line" rule
  this check backs.
