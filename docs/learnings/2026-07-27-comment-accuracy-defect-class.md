# The dominant defect class was comment accuracy, not code (F4, both tranches)

F4's two executor tranches ran fresh-implementer-per-task with two-stage review. The
single most transferable outcome: **the code was substantially right throughout; the
prose describing WHY it was right kept being wrong.** Roughly twenty factually false
comments were caught against essentially correct code — several load-bearing:

- an architectural exemption justified by a claim measurement disproved (`/engine.js`
  "shares one core instance" — it inlines core at 8.7 MB; the REAL safety argument is
  that only plain data crosses the worker seam);
- a spike assertion that would have passed green with the mover never constructed
  (`no-lane` returns before `CharacterMover` is built — and that test was the P-F4-2
  premise evidence);
- a test comment pinning a re-analysis MISS as intended behaviour (Amendment 2's
  letter under-covered the XZ-neighbour columns; two independent probes proved it);
- four vacuous assertions, EACH carrying a confident comment claiming it was
  load-bearing (`.every()` over an array a helper had emptied; `toEqual([])` after a
  splice; a regex matching every button; a burst check reading a drained array).

The common cause, in an implementer's own words: *the comment described what was
intended, then the code changed — or a number was inherited from a review message —
without re-reading the prose against it.* Documentation work then reproduced the class
one level up: four of five doc errors in the tranche-B docs task sat inside passages
TRANSCRIBED from comments living one grep away.

**Rules adopted (durable):**

1. **When a line changes what a comment claims, the comment is part of the diff.**
   Reviewers treat a stale claim adjacent to a correct change as a defect, same
   severity as the code being wrong.
2. **A confident comment on an assertion is a smell worth one sabotage.** All four
   vacuous asserts advertised their own value; only breaking the code exposed them.
3. **Gates and mutating reviews must not overlap.** One full gate run reported a false
   failure because a reviewer was mid-sabotage in the same tree; gate runs happen on a
   quiet tree, always.
4. **Numbers in prose are measurements, not decoration** — every numeric claim in a
   report or comment either carries provenance or gets re-measured before it is
   repeated (one fabricated figure was self-disclosed and re-measured in F3b; F4's
   audit of 12 other numeric claims found them real).

Context: the F4 seal entry in `docs/learnings/seals/2026-07-27-epic3-f4-seeing.md` is the
tracked summary. The per-instance
detail lived in that arc's local (gitignored) session reports and is not citable — which
is the point of the rule: a tracked doc may only cite tracked facts.
