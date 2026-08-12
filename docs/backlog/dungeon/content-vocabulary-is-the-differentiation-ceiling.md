# The content vocabulary is the differentiation ceiling — four materials and two prop archetypes cannot make ten places read as ten

Named at the first agent world-building cycle (2026-08-11): the owner's walk of the RED
baseline build found the world's *structure* varied (halls, caves, a spiral descent,
junctions) while its *dressing* could not keep up — the catalog's four material classes
and two prop archetypes ran out of ways to make one place read differently from the next.
The sculpting-worlds skill's "uniqueness by scarcity does not scale" bullet teaches
composition around this ceiling; this entry is the ceiling itself.

Filed at the cycle-1 review close (2026-08-12) — the review brief sized it separately
("the question of whether the content vocabulary needs expanding at all") but no entry
existed; this closes that gap.

## The open question

Whether the fix is MORE vocabulary (materials, archetypes, scatter variants) or better
USE of what exists (palette shifts per region, prop density gradients, kit/organic
contrast) — cycle 1 cannot answer that with n=1. Note the adjacent hazard already filed:
`engine-architecture/scatter-variants-not-bound-to-archetype.md` means naive variant
growth breaks at world load today.

## ANSWERED at cycle 2 — the ceiling was hit, and the discriminating variable is MATERIAL

The deliberate test ran 2026-08-12: five places (cloister, refectory, scriptorium, crypt,
spring cave) built into one world against four material classes, then walked blind by the
owner. **The ceiling held, and the walk isolated which variable does the work.**

The owner's verdict, verbatim: *"yes and no, i could tell they were supposed to be
different, but it was too simplistic for me to really differentiate … The spring cave
looked different from the crypt for instance and recognisably even if the cloister and
refectory kinda look like rooms … the tool doesn't let us be that expressive."*

Mapped onto what was built (extents and materials from the E1 report, walk verdict from
the owner):

| Pair | Material | Form | Read as distinct? |
| --- | --- | --- | --- |
| spring cave vs crypt | moss-stone vs dirt — **different** | irregular cavern vs pier grid | **YES, "recognisably"** |
| cloister vs refectory | masonry vs masonry — **same** | 5 m colonnade vs 12 m pier hall | **NO — "kinda look like rooms"** |

The cloister/refectory pair carried a **2.4× width contrast** (5 m vs 12 m) and a height
difference (3.5 m vs 3 m) and still read as one kind of place. So dimensional contrast did
**no identification work**; material plus form did all of it. Four classes across five
places forced three of them (cloister, refectory, scriptorium) onto masonry, and exactly
the sharing places blurred. *(The scriptorium was not commented on either way — two of the
three masonry places are the evidence, not three.)*

**So: MORE vocabulary, and the ratio is now measured** — a place that must read as distinct
wants a material class of its own. Five places, four classes, one class serving three is
the shape that failed. That is n=1 for the mechanism but it is a clean n=1: the pair that
differed in material was the pair that read.

**One honest qualification, because the owner's own attribution and this entry's evidence
diverge.** The owner books the whole ceiling to the tools ("a limitation on the tools and
what we can do"), and for material that is right. It is NOT the whole story for the failing
pair: cloister and refectory were the **same generator (`hall`), the same material and the
same feature (piers)**, differing only in dimensions. The agent spent its scarcest axis
identically on both and varied the axis that turns out not to matter. Vocabulary expansion
is the fix this entry tracks; the composition half is a `sculpting-worlds` lesson and landed
there at cycle 2's close as *"Material is what makes a place a place"*. Cycle 3 should not
read this entry as "buy more materials and the problem goes away".

## Trigger to revisit

The vocabulary-expansion decision itself — which is now evidenced and no longer waiting on
a probe. Take it when a slice needs more than four places to read as different, or when the
`sculpting-worlds` cycle after next hits the same wall with the composition lesson already
loaded (which is the control this entry still lacks: nobody has yet built five places
knowing that material is the variable). The naive-growth hazard in
`scatter-variants-not-bound-to-archetype.md` still gates HOW the expansion lands.

## Reference

- `docs/learnings/2026-08-11-agent-world-building-cycle-1.md` — the cycle-1 walk that named
  the ceiling.
- `docs/learnings/2026-08-12-agent-world-building-cycle-2.md` — the cycle-2 run and walk that
  measured it, with the five places' extents and materials.
- `packages/editor/.claude/skills/sculpting-worlds/SKILL.md` §Composing — the composition
  half of the finding.
- `packages/dungeon/catalog/materials.json` + `entities.json` (the vocabulary as-built;
  the dungeon README's catalog section states the counts with deriving commands).
