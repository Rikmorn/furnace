# Cockpit UX gate findings — remaining item: fog/headlamp are world/player data, not view-flags

> Narrowed at the W4 sweep (2026-07-13). Of the 3.1 + 3.2.2 gate findings: the 3.2.3
> hardening resolved the knob/blocking/envelope/cancel set (history in the seal-log);
> ③ preview-takes-over-the-viewport has its own entry
> (`editor-seams-and-preview-deferrals.md` § *Generation preview should be its own dockview panel*); ⑤a/⑤b (gizmos, resource live-preview) are
> tracked in `editor-interaction-model-redesign.md` + `editor-M5B-viewport-interaction.md`.

**④ (open).** The 3.1 gate moved the fog toggle INTO the viewport as a show-flag on
the UE/Unity render-debug precedent. But in this game fog is a property of the WORLD
(atmosphere) and the headlamp is the PLAYER's torch — surfacing them as editor
view-flags conflates "debug visualization" with "scene/player data you're authoring."
User at the gate: the component hierarchy is "a bit all over the place." The redesign
should decide which toggles are genuine render show-flags (grid, axes, wireframe) vs
which are world/player scene data that merely happen to be viewable (fog,
headlamp/torch).

**Trigger to revisit:** the interaction-model redesign / the post-W4 field-charter
editor pass (couples to `editor-interaction-model-redesign.md` and the W3 gate set in
`world-panel-w3-gate-ux-findings.md`).
