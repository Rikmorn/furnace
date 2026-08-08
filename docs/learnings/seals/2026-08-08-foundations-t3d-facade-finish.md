# Foundations T3d — the facade, finished · T3 CLOSES

- **Sealed:** 2026-08-08 — the first per-tranche seal since the consolidated backfill;
  the seal that closes foundations T3.
- **Package(s):** editor (one comment-only touch each in `shared/field-limits.ts` and
  `daemon/worlds.ts`; core and dungeon byte-untouched)
- **Gate:** standing review (independent re-derivation, both sabotage probes reproduced
  exactly, restores proven) + the T3-close objectives audit + user Safari regression
  walk PASSED 2026-08-08 ("everything seems fine, including lighting" — the one thing no
  test could check)
- **Suite:** 2912 pass / 1 skip / 0 fail — identical to the master baseline at every
  commit, with **zero test files touched**

**The tranche.** Six behaviour-frozen tasks took `createFieldHost` from 6,337 lines /
2,854 code / 232 closure bindings to **3,999 / 915 / 56 (9 `let`)** — eleven new modules
beside the existing seven (`field-targeting` / `field-picking` / `field-drift` ·
`field-analyzer` · `field-materials` + `field-render` · `field-tool` +
`field-camera-rig` · `field-selection` + `field-entities` · `field-world`), the
`FieldHost` type block comment-stripped byte-identical to master throughout (65
members), every pin unmodified, no exceptions needed. Four rows are DECLARED
FACADE-RESIDENT with the argument at source (`catalogs`, `stepHistory`, `input`,
`lifecycle` — the last structurally forced: its `ctx`/`disposed` back substrate thunks
seven modules read through). Two plan premises were REFUTED by measurement and the
better answer shipped: selection/entities landed as TWO modules (one directed call at
one site across all 47 names — not the machine's shape), and `stepHistory` stayed a
facade verb (six of seven statements call five distinct modules). The mutation register
ends at **11 gone, 59 standing — all 59 crossing a module boundary, ZERO
cluster-to-cluster in the closure**: an extraction tranche CONVERTS edges into
boundaries rather than deleting them, which is the third answer the exit clause did not
offer and the honest one. As-built: `editor-architecture.md` §24; the arithmetic:
`field-host-clusters.md` §2.6–§2.11 + §5.7.

**T3's exit, final:** facade HOLDS on the mechanism with the accounting stated · edges —
the third thing, disclosed · registry HOLDS (two tables) · suite HOLDS · the user gate
PASSED. **T3 closes** — five tranches (T3a primitives → T3b1 five clusters + the layer
chain → T3b2 the action system → T3c the machine → T3d the facade), the editor's
interactive core rebuilt from a closure into an architecture, with zero behaviour
changes across the last two.

**The close ran the objectives audit the user commissioned** (report:
2026-08-08-t3-objectives-audit; durable outputs tracked). Its verdict: the programme met
everything it measured; the gaps were RECORDS of drops, not dropped work. Three rulings
landed at §24.7 — the ViewStore state-placement rule RETIRED by ratification
(deps-records won on evidence), the provider-collapse promise recorded as a MISS
(`useFieldHostState.tsx` 878 → 1,093 while its real goal, cadence isolation, succeeded),
`furnace.*` vendor-key typing re-filed for T4. Eleven backlog filings closed the
dropped-records debt; the huge-world assumption register was promoted to
`engine-architecture.md` §16; the T4 donor entry was re-anchored with the programme's
actual T4 inputs including the session-claim policy, which had no tracked home.

**Coverage, stated so nobody mistakes green for proven:** the tranche's sabotage probes
found and RECORDED what the suite does not pin — the frame's draws (a `renderScene` that
draws nothing is fully green), the materials cache, the camera pose lane (pinned, but
only through 20 tests in six unrelated files), the blur restore path (genuinely
unpinned — verified identical on master), `setMaterialTable`'s post-swap re-mesh,
`exportArtifact`'s `playerYaw`. Each is written into the module header it belongs to;
the render-failure swallow entry re-armed rather than closed.

**Process lessons, earned twice each:** generated numbers were right everywhere and
hand-typed numbers were wrong repeatedly — the review still caught the headline
measurement stale in four tracked docs (the artifact grew ~98 comment lines after its
own measurement); never write a number not computed from the artifact, and never cite a
scratchpad script as a tracked gate. Never write "unpinned" without deleting the line
and running the suite (Task 4's false claim → 20 reds). And the audit's structural
lesson: a commitment graduates from planning scaffolding to a tracked doc the moment
something downstream inherits it — the close spent its afternoon paying exactly that
debt. AGENTS.md untouched. NEXT: T4 MCP (inputs tracked in the donor entry + the parked
digest), then T5's now-larger prune.
