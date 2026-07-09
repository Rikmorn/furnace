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
- **MAX_ROOMS=12 is an unmeasured guess — now MEASURED (2026-07-09, the `--envelope`
  probe; 20 single-shot seeds/cell, `COCKPIT_CONFIG` loop=0.35 × `COCKPIT_BUDGET`,
  sequential cells on an unloaded machine):**

  | rooms | single-shot | succ p50 | give-up p50 | give-up p95 | 12-attempt proj |
  |------:|------------:|---------:|------------:|------------:|----------------:|
  |     6 |  40% (8/20) |   0.22 s |       2.2 s |      20.3 s |           99.8% |
  |     8 |  30% (6/20) |   0.42 s |      17.2 s |     105.4 s |           98.6% |
  |    10 |  10% (2/20) |   0.71 s |       2.1 s |      46.0 s |           71.8% |
  |    12 |   5% (1/20) |   0.85 s |       2.9 s |      86.1 s |           46.0% |

  Read-out for the 3.2.3 brainstorm (numbers reported, judgment deliberately deferred):
  the reliability cliff is between 8 and 10 — at the CURRENT 12-attempt loop, rooms≤8
  projects ≥98.6% but rooms=10 drops to ~72% and rooms=12 to ~46% (a coin-flip Generate
  button). Successes are FAST at every size (p50 ≤ 0.85 s, and at rooms=8 succ_p95 is
  0.56 s) while failures grind the iteration budget (give-up p95 20→105 s) — the
  succeed-fast-or-grind asymmetry suggests a per-attempt WALL-CLOCK deadline (fail-fast
  to the next derived seed) and/or attempt-count scaling with rooms (e.g. 24 attempts @
  rooms=10 projects ~92%) as design options beside a hard MAX_ROOMS=8 clamp. n=20/cell —
  rates carry ±~10 pp noise; the cliff and the cost asymmetry are unambiguous.
- **Cancel lands only between attempts** — it cannot interrupt a running attempt
  (same stepper limitation; the worker resolves this too).
- Fixed AT the gate (for the record, pattern to keep): fog toggle moved from the
  Generation panel to a viewport overlay — view flags belong to the viewport
  (UE/Unity show-flags); this is the seed of 3.2's viewport view-flags block.

**Trigger to revisit:** the 3.2 chrome rework / the full editor UX pass (whichever
lands first). The envelope probe is a prerequisite for whatever UI exposes bigger
configs (multi-sector wings included).

**Reference:** Slice 3.1 spec `§0.4` (worker staging) + `§7 Pr-1` (budget numbers);
`packages/editor/src/frontend/components/GenerationPanel.tsx` (knobs, MIN/MAX consts);
`packages/dungeon/scripts/measure-b2c.ts` (`--envelope [rooms] [loop]` — the probe, landed 2026-07-09; cells must run sequentially, timing is wall-clock);
sibling entry `editor-interaction-model-redesign.md` (the 3.2 interaction-model input).

---

## Found at the 3.2.2 editor gate (2026-07-09)

Second live pass, once the chrome was usable enough to actually drive. The four
implementation bugs found alongside these (menu cross-switch wedge, scroll dead-stop,
history duplication, camelCase labels) were fixed in-slice; these are the deferred ones.

- **③ Generation preview takes over the viewport.** The preview swaps in over the scene
  viewport rather than living beside it. Split into its own entry —
  `generation-preview-own-panel.md` (needs a WebGPU-canvas-lifecycle spike; user-approved
  deferral, "handle it after this").
- **④ Fog (and the preview headlamp) may belong to the world/player, not editor view-flags.**
  The 3.1 gate MOVED the fog toggle INTO the viewport as a show-flag (recorded above) on the
  UE/Unity *render-debug* precedent. But in this game fog is a property of the WORLD
  (atmosphere) and the headlamp is the PLAYER's torch — surfacing them as editor view-flags
  conflates "debug visualization" with "scene/player data you're authoring." User at the gate:
  the component hierarchy is "a bit all over the place." Deferred, but the redesign should
  decide which toggles are genuine render show-flags (grid, axes, wireframe) vs which are
  world/player scene data that merely happen to be viewable (fog, headlamp/torch). Couples to
  `editor-interaction-model-redesign.md`.
- **⑤a No rotate/scale gizmo (translate only); ⑤b material/geometry edits don't live-preview.**
  Both already tracked and re-confirmed here: ⑤a under `editor-interaction-model-redesign.md`
  item 6 (no domain-aware gizmos) + `editor-M5B-viewport-interaction.md` (rotate/scale gizmo
  triggers, gizmo-controller extraction); ⑤b under `editor-interaction-model-redesign.md`
  item 1 + `editor-M5B-viewport-interaction.md` §6 (the `rebuildResource` live-preview cascade
  — material/geometry are RESOURCES; `ResourcesInspector.onPreview` is a no-op and
  `rebuildEntity` resolves from a lookup frozen at load, so resource edits never reflect live).

**Trigger to revisit:** ③ right after 3.2.2 seals; ④ during the interaction-model redesign;
⑤a/⑤b when resource live-preview + domain-aware gizmos are prioritized (the redesign pass).
