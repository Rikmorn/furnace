# Generation cockpit UX gaps — found at the 3.1 visual gate (2026-07-06)

Deliberately NOT fixed in-slice (user call at the gate: "the editor is crappy and has
tons of gaps and bad ux, we've known this — note it, full editor pass later"). The 3.1
gate only required the loop to be judgeable; these are the judged-and-deferred findings.

**Context.**
- **Knobs are unclamped.** The rooms input shows a 2–12 envelope but accepts typed
  out-of-range values (e.g. 15): the run then burns 12 attempts × ~20–30 s give-up each
  — minutes of blocked UI to a guaranteed failure. Out-of-envelope config should be
  refused at the UI boundary (setup-loud), not discovered through fail-slow search.
  (Was an executor-skipped "optional" item; the gate proved it non-optional.)
- **The UI blocks for the duration of each placement attempt.** Accepted by design at
  in-envelope configs (spec §0.4: stepper now, Web Worker staged if the gate shows
  stalls hurt — in-envelope, the user judged blocking "as expected"). Out-of-envelope
  configs turn it into minutes; a worker + mid-attempt cancel is the real fix.
- **MAX_ROOMS=12 is an unmeasured guess.** The cockpit envelope was only ever measured
  at 6 rooms (P1). An `--envelope` probe (single-shot rate + give-up cost at 8/10/12
  rooms under `COCKPIT_BUDGET`, ~15 min) should set the cap from data.
- **Cancel lands only between attempts** — it cannot interrupt a running attempt
  (same stepper limitation; the worker resolves this too).
- Fixed AT the gate (for the record, pattern to keep): fog toggle moved from the
  Generation panel to a viewport overlay — view flags belong to the viewport
  (UE/Unity show-flags); this is the seed of 3.2's viewport view-flags block.
- **Baked-wing artifact consolidates to a single doc (DECIDED direction, user call
  at the gate, deferred to 3.2+).** Today's bake emits ~27 files (one doc per node
  AND per connector — the per-connector docs also deviate from the 3.1 spec's single
  `connectors.scene.json`) and floods the editor's flat scene list. Target shape:
  ONE `wing.scene.json` carrying every region's entities (ids are already
  region-prefixed → 3.2 per-region selection works within the doc) + `manifest.json`
  (runtime index: provenance/colliders/dressing) + `.fmesh` binary sidecars
  (~7 files). The camera-less fragment-open fix already renders such a combined doc
  whole in the viewport. Do this BEFORE 3.2 curation verbs bind to the artifact
  shape; also add clean-previous-bake semantics (stale docs from a larger earlier
  bake currently linger unreferenced).

**Trigger to revisit:** the 3.2 chrome rework / the full editor UX pass (whichever
lands first). The envelope probe is a prerequisite for whatever UI exposes bigger
configs (multi-sector wings included).

**Reference:** Slice 3.1 spec `§0.4` (worker staging) + `§7 Pr-1` (budget numbers);
`packages/editor/src/frontend/components/GenerationPanel.tsx` (knobs, MIN/MAX consts);
`packages/dungeon/scripts/measure-b2c.ts` (`--retry-tight` — the probe to extend);
sibling entry `editor-interaction-model-redesign.md` (the 3.2 interaction-model input).
