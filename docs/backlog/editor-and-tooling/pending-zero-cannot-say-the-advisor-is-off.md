# `pending: 0` cannot say the advisor is off — the flags answer's freshness anchor has two debts

Found at sculpting-worlds cycle 2's E0 (2026-08-12), which gave `session_query
{about:"flags"}` its freshness anchor: `pending`, relayed from the advisor's
`analyzerPendingCount`. The executor documented both debts in-code rather than
designing around them — each is a decision the owner should make, not inherit.

**Debt 1 — the two-state zero.** `analyzerPendingCount` answers `0` whenever no agent
profile is in hand (`field-analyzer.ts`, the `agentProfile === null` early return). So
`{total: 0, pending: 0}` has two readings — "the advisor settled and found nothing" and
"the advisor never ran" — and the answer cannot separate them. A project without
`catalog/agent.json` sits in the second state permanently; the dungeon project has one,
so cycle 2's run cannot hit this. Candidate shapes if taken: `pending: number | null`
(`null` = advisor off), or an explicit advisor-live fact on the answer. Either costs
door prose — 327 B of the 8,192 B budget remained after E0.

**Debt 2 — the wire is unpinned.** Sabotaging the host wiring
(`analyzerPending: advisor.pendingCount` → `() => 0`) leaves the entire editor suite
green: the seam cases stub the dep by design, and the host-level walk runs profileless,
where the real counter and the sabotage both answer 0. An honest pin needs a fixture —
profile installed, chunk dirtied — not an assertion; the host-level case says so
in-comment. (`field-analyzer.ts`'s own comment beside the counter warns the same class:
"write the case first … rather than trusting the green".)

## Trigger to revisit

Cycle 2's R session rules first: take the advisor-live fact now, or leave both debts
standing with this entry as the record. Otherwise: before a second door consumer
relies on `pending`, or the next tranche that touches `field-query.ts` or the advisor
seam.

## Reference

- `packages/editor/src/field-host/field-analyzer.ts` — `analyzerPendingCount`, the
  early return and the adjacent write-the-case-first comment.
- `packages/editor/src/field-host/field-query.ts` — the flags arm and its `pending`
  docblock.
- `docs/reference/editor-architecture.md` §28.2 — the caveat's reference-doc record
  (lands with the `cycle2-flags-arm` merge).
