# Seals — the chronological slice/epic seal record

This directory holds the repo's chronological slice/epic seal record: one file per seal,
plus this index. It replaces `docs/learnings/seal-log.md` (gone), a single append-only file that
was originally extracted VERBATIM from `AGENTS.md`'s per-package bullets on 2026-07-06
(post-Slice-3.1 hygiene) — those bullets had grown to ~50 KB of history loaded into every
agent session, so `AGENTS.md` kept only CURRENT-STATE summaries + pointers and the full
record moved to `seal-log.md`. By 2026-08-03 that single file had itself grown to 115 KB,
the same failure mode one level up: a single doc that is a constant write target bloats no
matter where it lives. It was split into 26 per-seal files (the index below has grown
since), and `seal-log.md`
was deleted. As-built architecture is distilled separately in `docs/reference/`
(`dungeon-architecture.md`, `editor-architecture.md`, `core-modules.md`) — this directory
is history, not current state.

## Writing a seal

What a seal must answer, on top of the four head fields in [Head conventions](#head-conventions)
below. Mechanics (filename, index row) are in [Adding a seal](#adding-a-seal).

- **Sealed date, packages touched, and the counts** — the counts are COMPUTED from the
  artifact, never typed, with the deriving command stated beside the number (`bun test` for
  the suite line, a quoted `git diff --stat` range for the diff). A number nobody can
  re-derive rots in place, and the seal is the last place anyone re-derives it.
- **Any surface the slice ORPHANED** — name every export whose last consumer went away in
  this slice. This is recorded to feed a later classification audit, **never to trigger
  automatic deletion**. `@furnace/core` is a capability library for consumers we do not
  know, so an orphaned name is a candidate for JUDGEMENT, not for the bin.
- **"Did any file grow disproportionately this slice? Name it."** — answer it in the prose.
  This is guidance, not a gate: nothing ratchets on the answer (D8, 2026-08-04 — guidance
  over machinery for file size). The value is that the growth is *named* while whoever grew
  it still remembers why.
- **The promotion gate.** A seal does not close until: (1) durable facts from the
  slice's spec/plans/reports are promoted into reference/backlog/learnings — walk the
  scaffolding files named by the slice's slug and ask of each fact "does anything
  tracked depend on this?"; (2) the slice's `docs/work/` file is deleted (the seal is
  the tombstone; a closed epic's directory goes with its last slice); (3) the slice's
  scaffolding files (`specs/`, `plans/`, `report/`, `prompts/` matching the slug) move
  to the archive directory. Live scaffolding dirs hold unsealed work only; (4) every
  backlog entry pointing INTO the sealed slice is resolved — `grep -rl "^consumer: <slug>"
  docs/backlog/` and, per hit, promote or delete it if the slice consumed it, otherwise
  re-point it at the successor work item or clear it to a prose trigger. Clause 2 is what
  makes clause 4 necessary: deleting the work item is exactly what dangles the pointers
  into it, so the ritual that closes a slice is the ritual that breaks them. `bun run
  check` fails on a dangling `consumer:`, so this one cannot be forgotten quietly.

Then one index line, and nothing else in the index — the row points at the file, the
content lives in the file.

## Index

Every seal in this directory, ordered by **true slice sequence, oldest first** — the order the
original append-only log accumulated them in. The count is deliberately not written here: it
changes with every seal, and this file's own § "Writing a seal" says counts are computed from
the artifact and never typed. Derive it —

```sh
ls docs/learnings/seals/*.md | grep -v README | wc -l
```

— and cross-foot it against the rows below, which must agree.

**Filename order is NOT slice order.** Three files carry the 2026-07-06 extraction date
rather than their real seal date, because their source prose stated no date of its own:
`2026-07-06-epic2-2.0-player-physics.md`, `2026-07-06-epic2-2.1-field-baked-region.md`, and
`2026-07-06-epic2-2.2.3b-colliding-fixtures-and-props.md`. Slices 2.0 and 2.1 actually
landed before 2.1.1 (2026-06-18) — sorting by filename would place them roughly three
weeks too late, after slices that shipped after them. 2.2.3b carries no date evidence
either; it is placed here between 2.2.3a and 2.2.4 by slice-number adjacency (2.2.3a →
2.2.3b → 2.2.4), not by a date in its prose — this is an inference, not a measurement.
Dates marked `*` below are extraction-filed, not real seal dates.

| Sealed | Seal | Package(s) |
|---|---|---|
| 2026-07-06 * | [Pre-3.2 package record — the AGENTS.md-era bullets, frozen at extraction](2026-07-06-pre-3.2-package-record.md) — *not a slice seal, see note below* | core, dungeon, editor |
| 2026-07-06 * | [Epic 2 · Slice 2.0 — "Player Physics"](2026-07-06-epic2-2.0-player-physics.md) | core, dungeon |
| 2026-07-06 * | [Epic 2 · Slice 2.1 — "Field→Baked Region"](2026-07-06-epic2-2.1-field-baked-region.md) | core, dungeon |
| 2026-06-18 | [Epic 2 · Slice 2.1.1 — "Traversal Foundation"](2026-06-18-epic2-2.1.1-traversal-foundation.md) | core, dungeon |
| 2026-06-22 | [Epic 2 · Slice 2.2.1 — "World collision via field-derived voxels"](2026-06-22-epic2-2.2.1-world-collision-voxels.md) | core, dungeon |
| 2026-06-24 | [Epic 2 · Slice 2.2.2 — "Theme-Generator Architecture"](2026-06-24-epic2-2.2.2-theme-generator-architecture.md) | dungeon |
| 2026-06-26 | [Epic 2 · Slice 2.2.3a — "Decorative scatter"](2026-06-26-epic2-2.2.3a-decorative-scatter.md) | dungeon |
| 2026-07-06 * | [Epic 2 · Slice 2.2.3b — "Colliding fixtures + interactive props"](2026-07-06-epic2-2.2.3b-colliding-fixtures-and-props.md) | dungeon |
| 2026-06-29 | [Epic 2 · Slice 2.2.4 — "Seams — the connection primitive"](2026-06-29-epic2-2.2.4-seams-connection-primitive.md) | dungeon |
| 2026-07-02 | [Epic 2 · Slice 2.2.5a — "World Graph & Collision-Aware Placement"](2026-07-02-epic2-2.2.5a-world-graph-and-placement.md) | dungeon |
| 2026-07-03 | [Epic 2 · Slice 2.2.5b Phase A — "Connector enclosure"](2026-07-03-epic2-2.2.5b-phase-a-connector-enclosure.md) | dungeon |
| 2026-07-04 | [Epic 2 · Slice 2.2.5b Phase B1 — "Built interfaces"](2026-07-04-epic2-2.2.5b-phase-b1-built-interfaces.md) — also carries the Epic 2 closure + the Epic 3 charter | dungeon |
| 2026-07-06 | [Epic 3 · Slice 3.0 — "Foundations"](2026-07-06-epic3-3.0-foundations.md) | dungeon |
| 2026-07-06 | [Epic 3 · Slice 3.1 — "The Loop"](2026-07-06-epic3-3.1-the-loop.md) | dungeon, editor |
| 2026-07-08 | [Epic 3 · Slice 3.2.1 — Consolidated bake artifact](2026-07-08-epic3-3.2.1-consolidated-bake-artifact.md) | dungeon, editor |
| 2026-07-09 | [Epic 3 · Slice 3.2 — Editor foundation pass](2026-07-09-epic3-3.2-editor-foundation.md) | editor |
| 2026-07-10 | [Epic 3 · Slice 3.2.3 — Cockpit hardening](2026-07-10-epic3-3.2.3-cockpit-hardening.md) | dungeon, editor |
| 2026-07-11 → 2026-07-13 | [Epic 3 · recharter + Slice 3.3 W1 — World model, field-only](2026-07-11-epic3-recharter-w1-world-model.md) — also carries W2 (substrate + grid-built halls) and W3 (maze + World-panel assembly, the phase gate) | dungeon, editor |
| 2026-07-13 | [Epic 3 · Slice 3.3 W4 — clean-cut sweep + PHASE SEAL](2026-07-13-epic3-3.3-w4-clean-cut-sweep.md) | dungeon, editor |
| 2026-07-15 | [Epic 3 · One Field (the 3.4+ recharter) — charter + F0 + F1 "the medium"](2026-07-15-epic3-f0-f1-the-medium.md) | core, dungeon, editor |
| 2026-07-16 | [Epic 3 · One Field F2a — "the material field"](2026-07-16-epic3-f2a-material-field.md) | dungeon (others not recorded) |
| 2026-07-21 | [Epic 3 · One Field F2b — "the palette"](2026-07-21-epic3-f2b-the-palette.md) | cookbook, core, editor (dungeon stated byte-untouched) |
| 2026-07-23 | [Epic 3 · One Field F3a — smart objects](2026-07-23-epic3-f3a-smart-objects.md) | core, editor |
| 2026-07-25 | [Epic 3 · One Field F3b — the cave & the entities](2026-07-25-epic3-f3b-cave-and-entities.md) | core, dungeon, editor |
| 2026-07-27 | [Epic 3 · One Field F4 — seeing](2026-07-27-epic3-f4-seeing.md) | core, dungeon, editor |
| 2026-08-03 | [Epic 3 · F4.5 — the overlay cockpit](2026-08-03-epic3-f4.5-overlay-cockpit.md) | editor (core, dungeon stated byte-untouched except two comment-only changes) |
| 2026-08-04 | [Structural housekeeping — the seal record, tests beside modules, two src splits](2026-08-04-structural-housekeeping.md) — *written retroactively 2026-08-12; the arc merged unsealed and the docs-system archive sweep found it* | core, dungeon, editor |
| 2026-08-07 | [Foundations program · T1a→T3c — consolidated backfill](2026-08-07-foundations-t1a-t3c-backfill.md) — *backfill seal: eight tranches in one record, per-tranche seals resume from T3d* | core, editor, dungeon |
| 2026-08-08 | [Foundations T3d — the facade, finished · T3 CLOSES](2026-08-08-foundations-t3d-facade-finish.md) — *carries the objectives-audit rulings* | editor |
| 2026-08-09 | [Foundations T4a — the honest substrate](2026-08-09-foundations-t4a-honest-substrate.md) — *user visual gate deferred to T4 close by ruling* | editor, core |
| 2026-08-09 | [Foundations T4b — claim, backchannel, mount](2026-08-09-foundations-t4b-claim-backchannel-mount.md) — *the agent door opens, reads only; clause 5 walked live; MSAA-removal ruling* | editor |
| 2026-08-11 | [Foundations T4c — verbs, eyes, and the gate · T4 CLOSES](2026-08-11-foundations-t4c-verbs-eyes-gate.md) — *gate 1 walked+measured; gate 2 waived to daily use by ruling — NOT a passed visual gate* | editor, core, cookbook |
| 2026-08-11 | [Foundations T5 — polish, guidance, and the register · THE PROGRAMME CLOSES](2026-08-11-foundations-t5-polish-guidance-register.md) — *live Chromium walk; Safari waived to daily use; audit 150/10/1 keep-by-default; register 169→101, one closure; four ratifications at close* | core, editor |
| 2026-08-12 | [Sculpting worlds · cycle 1 — aim and judgement, not discipline](2026-08-12-sculpting-worlds-cycle-1.md) — *RED baseline owner-walked; skill 948 words + registry-checked guardrail; review 20/0/2, no fifth false fact; the skill itself unused until cycle 2* | dungeon, editor |
| 2026-08-12 | [Sculpting worlds · cycle 2 — the skill held, and material is what makes a place](2026-08-12-sculpting-worlds-cycle-2.md) — *first real use, 3 sessions; 58/80 calls, 5 places, owner-walked blind; material beats a 2.4× width contrast; low-clearance 0-on-walkable-ground in all 12 worlds; §Composing 1 keep / 2 rewrite / 1 strike; register 109→118* | dungeon, editor |

**On the first row:** `2026-07-06-pre-3.2-package-record.md` is not a slice seal — it is the
frozen `AGENTS.md`-era package description, carried over verbatim at the 2026-07-06
extraction. It is where the **Epic 1 ("Presence & Mood") record** lives — Epic 1 was
written inline with no clean `then landed` cut point, so it never got a file of its own.
It is placed first because its content (Epic 1, plus the pre-extraction package bullets)
predates every dated slice in this table; its own "Sealed" field is the extraction date,
not a real seal date.

## Head conventions

Each seal file opens with a title, then four metadata fields in this order:

- **Sealed** — the date the slice/epic actually sealed (or a range, for multi-part entries).
- **Package(s)** — every package the slice touched, **listed alphabetically**.
- **Gate** — how the slice was gated (visual/live, headless, user-gated browser, etc).
- **Suite** — the test-suite count at seal time, if the entry's prose states one.

Two idioms show up in these fields and mean different things — do not merge them:

- **`not recorded`** — the entry's own prose says nothing on that point. We don't know.
- **`stated byte-untouched`** — the entry's own prose explicitly states zero change to that
  package. We know it's zero.

**Metadata comes only from that entry's own prose.** Never infer a field's value from a
neighbouring entry, even when two seals clearly belong to the same arc — this defect
occurred once during the split and was caught in review.

**Prose is verbatim and is never edited** — not for typos, not for staleness, not to fix a
broken cross-reference. If a seal's prose points at something that no longer exists, that
is a historical fact about what was true when it sealed, not a bug to fix here.

## Adding a seal

1. Create `docs/learnings/seals/<YYYY-MM-DD>-<epic>-<slice>-<slug>.md` with the four head
   fields above, then the seal prose.
2. Add **one row** to the table in this README.

Never append prose to this README — it stays one line per seal, plus the conventions and
procedure above. If it starts accumulating history, it is repeating `seal-log.md`'s mistake
one level up.
