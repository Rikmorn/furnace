# Foundations T4c — verbs, eyes, and the gate · T4 CLOSES

- **Sealed:** 2026-08-11 — the tranche that closes foundations T4. The agent has hands,
  eyes, and a tape measure; the donor entry that started it all is deleted.
- **Package(s):** editor + core (frame, registry, field messages) + cookbook
  (render-target demo rides the RTT options). 9 commits `27d7593c..45c03922` FF-merged
  to master; 122 files, +13251/−1640; suite 3057 → **3201 pass / 1 skip / 0 fail**
  (+144; wall clock band 54–67s — the SDK 3× hazard never returned).
- **Gate 1 — the agent builds a world — WALKED LIVE, PASSED, MEASURED (2026-08-11):**
  ten tool calls, zero errors, against the user's claimed Safari session on the real
  dungeon project. `generate` (cave, defaults) 28 ms · `edit_apply` (three-sphere dig
  batch = one undo entry) 13 ms · geometric ray verify 13 ms · `world.saveAs` +
  `world.bake` ~1.1 s each · two `viewport_capture`s 38–45 ms returning MCP image
  blocks (87/120 KB PNGs, 1024×556, ~750 vision tokens each) — **visually verified by
  the reviewing agent: grid overlay present, terrain lit, the `+y` pose looking down at
  the same pivot with the user's camera untouched.** First-ever measurements banked:
  a daemon under real MCP traffic (per-POST server construction invisible in the
  timings) and the 2D-canvas PNG encoder on Safari/wry (clean).
- **Gate 2 — the holistic user visual walk — PARTIAL, then WAIVED TO DAILY USE by user
  ruling (2026-08-11).** The user watched the session, switched to the built world,
  browsed the entity list — and could not FIND the agent's cave (see the findings
  below), then ruled: *"if you say it's ok i'll believe it, we'll have plenty of
  chances to see you in action."* The dig/paint/bake regression pass and the
  sampleCount-1 AA eyeball were NOT delivered — they transfer to daily use. **This
  seal does NOT record a passed visual gate**; the renders-clean scar rule stands.

**The tranche.** MSAA leaves the editor and the claim re-keys on world switch. The
off-screen pass gets lights (~15-line pass-through) and lines learn a second target
(`drawLinesToTexture` — R9-argued as a separate setup-loud command); the frame splits
into compose+submit and `field-capture.ts` photographs the viewport from the live
camera or six axis poses without touching the rig (pinned byte-identical, now also
photographed). `field-mutation.ts` gives the agent hands — a batch is one stroke
through `logApplyGroup`, refusals RETURNED with `because` + `ops[N]` locators,
pass-1/pass-2 told apart structurally; `generate` commits without a session.
`field-query.ts` is the tape measure — catalog-true prop contact/overlap, ray probes,
entities deliberately not contact-probed (a carver's footprint is air it removed).
`armed` becomes one member (a FOUR-state resolver the review found — session, stamp
arm, gesture, status precedence — two of them now compiler-bound); the tab shows an
agent chip. The door grows to **nine tools ≤10**, every row projecting its own zod
(NO_ARGUMENTS deleted), instructions rewritten at 1,970/2,048 B, the undo fence
daemon-side (`FENCED_ACTIONS` — the chrome-side fence would have missed exactly the
stale tabs that needed it). The cull statement is written: the door projects no
renderer/camera/material/shader vocabulary at all — T5's deletion set. *[Amended
2026-08-11, T5 opening: "deletion set" (here and in the closing paragraph) is
superseded — the user retired the subtraction rule as too extreme; T5 runs a
keep-by-default classification audit instead. Ruling and criteria:
`docs/backlog/engine-architecture/core-zero-consumer-module-exports.md`.]* *[Citation
re-pointed 2026-08-11, T5 Task 7: that entry is DELETED — T5's classification audit is its
resolution. The keep-by-default principle is durable at `docs/learnings/seals/README.md`
§Writing a seal; the audit's outcome lands in the T5 seal. Wording above unchanged.]*

**Review + rulings:** independent reviewer MINORS-only — all clauses, fences,
sabotages, and fourteen recomputed numbers exact; the one source minor (the wire
header naming retired members — the tranche's own defect class, in its own file) fixed
at review. Fenced rulings verified against the full diff: no undo verb (the
`action.run {id:"edit.undo"}` near-escape caught and daemon-fenced), no LogEntry/oplog
change, no attribution field, no canvas snapshot.

**The gate's findings — four filed, two recorded:** `edit.grab` refused an agent with
its LABEL ("Move", `because:"inert"` — the T4a-declared residue doing predicted harm;
`inert-refusals-answer-with-their-label`) · `view.frame` with no selection returned
`ok:true` and moved the camera to something unstated
(`view-frame-without-selection-frames-something-unstated`) · the entity list has no
legible order and the human has no position readout — the user could not FIND what the
agent built despite watching it land (`entity-list-has-no-legible-order`,
`where-am-i-position-legibility`; either alone would have sufficed). Recorded, not
filed: gate walks should start on a SCRATCH world (building into `huge` made the delta
invisible — a walk-design lesson); the walk script's dig-center derivation read the
wrong entity (client-side slip; the door validated and applied exactly what was asked).
Tree dirt left deliberately: `worlds/index.json` default → `gate-t4c` (the bake's
makeDefault; the user flips it or keeps it).

**Process lessons — the recurring defect class, named and countered:** every task
shipped at least one comment its own code disproved; eleven assertions passed while
their subject was deleted (found by DELETING THE LINE, not reading the assertion — the
archetype-catalog one was a live production hazard: every prop measuring as a 0.5 m
cube). Three sweep refinements adopted into the standing protocol: audit docblock
REASONS not counts · suspect your own NEW prose as hard as the prose you falsified ·
quote your grep globs (an unquoted `--include=*.ts` ate 47 stale references).

**T4 CLOSES.** Three tranches: T4a made the substrate honest (funnel, gate truth,
op-stream validation, Origin) · T4b opened the door reading (claim, backchannel,
session.state, three tools — and found Bun never firing `res.on("close")`) · T4c gave
it hands, eyes, and measures. The collaboration model shipped as designed 2026-08-08:
the UI is the human's interface, the MCP is the agent's, one claimed session, shared
undo, typed refusals, never a hang. NEXT: **T5 (new session)** — the prune (the
register grew deliberately all programme; the cull statement names the deletion set) +
guidance + the gate findings' first-polish candidates + `ToolDefinition.build`'s
judgment (finally testable) + the harness program-level decisions. After T5: undo +
attribution as the first post-T4 capability (one wire-format design pass), then F5.
