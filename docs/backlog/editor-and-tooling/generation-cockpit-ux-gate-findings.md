# Generation cockpit UX gaps — found at the 3.1 visual gate (2026-07-06)

Deliberately NOT fixed in-slice (user call at the gate: "the editor is crappy and has
tons of gaps and bad ux, we've known this — note it, full editor pass later"). The 3.1
gate only required the loop to be judgeable; these were the judged-and-deferred findings.

**Resolved by Slice 3.2.3 ("cockpit hardening"):** unclamped knobs (rooms/loop now
clamp setup-loud at commit — rooms to the measured envelope's range, loop to
`[0, 0.6]`), the UI blocking for the duration of each
placement attempt (the search now runs on a generation worker), the unmeasured
MAX_ROOMS=12 guess (superseded by the measured `COCKPIT_ENVELOPE` table, one row per
room count), and cancel landing only between attempts (now instant, mid-attempt —
`terminate()` + lazy respawn). See `docs/reference/dungeon-architecture.md` §4
(`LayoutBudget.deadlineMs`, the D4 bake-strips-the-deadline invariant, `COCKPIT_ENVELOPE`)
and `docs/reference/editor-architecture.md` §13.6 (the generation worker host). The
envelope covers only the current single-sector config — whatever UI later exposes
bigger configs (multi-sector wings included) needs its own measurement pass first.

- Fixed AT the gate (for the record, pattern to keep): fog toggle moved from the
  Generation panel to a viewport overlay — view flags belong to the viewport
  (UE/Unity show-flags); this is the seed of 3.2's viewport view-flags block.

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
