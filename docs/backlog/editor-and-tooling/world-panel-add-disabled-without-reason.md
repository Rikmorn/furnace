# World panel: Add region disables itself without saying why

The World panel's Add-region form
(`packages/editor/src/frontend/components/world-panel/AddRegionForm.tsx`) disables the Add
button whenever the selected parent/child algorithm pair has no legal connector — i.e. when
`legalKinds(parent, child)` returns `[]`. That gate is correct (W3 plan refinement 2: a grid
child cannot hang off a cave parent, because the collar must ride the connector's a-end while
derivation only places b-ends), but it is **mute**: the button greys out and nothing on screen
says the pair is illegal or what would be legal instead.

This is reachable on first run. The form's default algorithm is `hall`, so on a draft whose
only region is a cave anchor, the panel opens with Add already disabled — the first thing a
new user meets is a dead button with no explanation. The W3 review closed the *stale-parent*
path into this state (an unknown `parentId` now falls back to the first region), but the
legality gate itself remains unexplained.

Fix: surface the reason where the gate fires — either a line under the form
(`no connector can join cave → hall — attach grids to grids, or hang a cave off either`) or by
disabling the illegal *algorithm* options against the chosen parent rather than the submit
button. The `ReasonTip` wrapper added in the W3 review (a `<span title>` around a disabled
control, since shadcn `Button` sets `disabled:pointer-events-none`) is the cheap version. The
better version is a real affordance, which is UI surface W3 did not spec.

**Trigger to revisit:** the 3.4 / 3.5 World-panel polish pass — or the first time someone
opens the panel, adds a cave, and reports that Add is broken.

**Reference:** `packages/editor/src/frontend/components/world-panel/AddRegionForm.tsx`;
`legalKinds` in `packages/editor/src/frontend/lib/world-draft.ts`.
