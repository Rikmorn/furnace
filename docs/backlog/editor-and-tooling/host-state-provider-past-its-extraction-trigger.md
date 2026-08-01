# `useFieldHostState` is past the extraction trigger it was given

**Context.** F4.5b Task 2 lifted all twelve host-seam subscriptions into
`packages/editor/src/frontend/hooks/useFieldHostState.tsx`. A reviewer offered a
zero-risk extraction of the five comparators (`statsEqual`, `sameEntities`,
`samePlaced`, `sameParams`, `toolsEqual`) plus the four default constants into a
co-located `field-host-mirrors.ts` — ~170 lines out, and it would make those
comparators directly unit-testable, where today they are only exercised
behaviourally through a mounted provider.

It was declined as mid-slice churn, **with a trigger**: *"Tasks 12 and 13 both add
contexts to this provider — if it passes ~700 lines, extract then."*

**The trigger has fired and was not acted on.** Measured: 891 lines at Task 12's tip
(`07d894da`), **984** after Task 13 added the flag-filter persistence pair (restore
effect, debounced write, `deserializeFilters`, `FILTER_KEYS`, `editFilters`). Task 13
did not extract, for the same reason Task 2 did not: its subject was the flags
surface, and a 170-line file move inside the commit that adds a palette makes the
diff unreadable and the behavioural change unreviewable.

**Do NOT split the subscriptions.** Centralizing them is the whole point of the file —
every seam is a single slot, so a second subscriber anywhere silently steals the
first's callback, and the one-file rule is what makes that checkable (the
`tests/chrome/field-panel.test.tsx` ownership case quantifies over all twelve). What
moves is the pure half: the comparators, the `DEFAULT_*` literals, and the filter
(de)serialization, all of which are value→value functions with no React in them.

**Trigger to revisit:** F4.5b Task 14 (the dissolution's clean-up task) or the first
task after it that touches this file for any reason. If the file crosses 1 000 lines
before then, do it there instead.

**Reference:** `packages/editor/src/frontend/hooks/useFieldHostState.tsx`;
the single-slot rule is stated in its header and machine-checked in
`packages/editor/tests/chrome/field-panel.test.tsx`.
