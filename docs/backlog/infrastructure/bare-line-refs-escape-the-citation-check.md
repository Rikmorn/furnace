---
summary: the docs file:line citation check cannot see bare `:N` continuation refs, so a whole class of line citations rots unflagged
---

# Bare `:N` continuation refs escape the file:line check

Filed 2026-08-12 during the docs-system rung-1 triage, which fixed 103 flagged `file.ts:N`
citations and left this class untouched because the checker cannot see it.

## Context

`scanFileLineCitations` in `scripts/check-docs.ts` anchors on a filename: it matches
`name.ts` immediately followed by `:` and digits. Entries routinely cite a file once in full
and then continue with bare offsets — `` `:240-241`, `:279` `` — or space-separate them from
the name — `` `BrushShape` :97-110 ``. Those rot exactly as fast as the flagged form and the
check is blind to all of them.

Known instances at filing: `editor-chrome-authoring-gaps.md`,
`chrome-focus-and-dismissal-follow-ons.md`,
`field-op-vocabulary-has-no-architectural-altitude.md`,
`oplog-entry-assembly-duplicated-three-ways.md` (an HTML comment recording a line-number
re-derivation that no longer has line numbers under it).

This is deliberately NOT fixed inline: a bare `:N` in prose collides with times, ratios,
section refs and version strings, so any regex that catches it is a false-positive posture
decision, not a mechanical widening. Options worth weighing: require the citation to be
inside backticks AND on a line that also names a source file; restrict to `:N-M` ranges;
or leave it to review and accept the residual.

## Trigger to revisit

When a bare `:N` ref is found to have rotted and misled someone, or when the checker next
gains a rule (batch the posture decision with that work). Not urgent: the flagged class was
the large one, and this class is now bounded and listed above.

## Reference

- `scripts/check-docs.ts` — `scanFileLineCitations` and `FILE_LINE_RE`.
- The docs-system canon under `docs/reference/` — the checks table and its scope rules —
  and the docs-authoring rules file, which carries the "never cite file plus line" rule
  this check backs.
