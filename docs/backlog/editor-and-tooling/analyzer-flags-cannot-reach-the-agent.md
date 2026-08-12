# The analyzer's flags cannot reach the agent — `session_query` has no `{about:"flags"}` arm

Justified by measurement at the first agent world-building cycle (2026-08-11, the RED
baseline build): the walkability analyzer **named the exact wedge the human then hit** —
four candidates, one per elbow of the spiral descent — and the finding reached nobody,
because those flags render in the chrome for a human and the door has no arm an agent
could ask. The agent that built the world verified its junctions by ray probes (correctly)
while the analyzer's richer verdict sat unreadable beside it.

Filed at the cycle-1 review close (2026-08-12) — the review brief and plan both sized
this separately as **capability, not guidance** (a skill cannot teach reading a surface
that does not exist), but the brief's "all filed" claim was ahead of the filing; this
entry closes that gap.

## Shape

A sixth `about` arm on `session_query` (the wire union grew 3 → 5 at T5; this is the
next), relaying the flag set the chrome's flag panel reads — kind, position, and the
`unreachable`/pit semantics `measure-analyze.ts` computes. Two costs to argue at design:

- **Description bytes.** The door's row prose stands at 7,502 / 8,192 B — 690 B headroom,
  the binding constraint T5 named. A sixth arm grows `session_query`'s description; the
  arm costs no tool slot but is not free.
- **Freshness.** Flags are computed at bake/analyze time; an arm must say what the answer
  is stale AGAINST (the last bake), or an agent will treat a pre-edit analysis as current.

## Trigger to revisit

**Cycle 2 of the sculpting-worlds skill** — the plan's own words: "it changes what cycle 2
can do." If cycle 2's build wants walkability verification beyond ray probes, this is the
arm it reaches for; take it then, or record why ray probes sufficed.

## Reference

- `docs/learnings/2026-08-11-agent-world-building-cycle-1.md` — the measurement.
- `packages/editor/src/field-host/field-query.ts` (the five arms as-built);
  `packages/dungeon/src/world/measure-analyze.ts` (what the flags hold);
  `docs/reference/editor-architecture.md` §28 (the T5 arm growth + byte budgets).
