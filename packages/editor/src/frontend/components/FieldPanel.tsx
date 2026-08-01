// The Field panel: EMPTY. Every organ of the dig-loop control stack has left, and
// this file is the register of where each one went — kept for one more task so the
// `controls` palette id retires in the same commit as its component (Task 14).
//
// What the viewport SHOWS — shading, the layer gates, the slice plane, AA — went to
// the top bar's View popover, where it is one click from anywhere instead of hidden
// behind a palette the user may have closed. The persistence concern — which world
// this is, Save / Open / Bake — is the SHELL's (the world chip, the drawer, ⌘S): a
// control stack that owns the save verb cannot be dissolved into palettes, and
// closing the palette holding it would take ⌘S with it. What the world already
// CONTAINS — the committed entity list and the drift report — is a palette of its
// own (shell/EntitiesPalette). Since F4.5b Task 8 the ARMING and the BRUSH are the
// shell's own chrome: the tool families are the left rail (shell/ToolRail), and the
// armed tool's params — radius, mask, material, smooth, hollow — are the top strip
// (shell/ToolStrip), which shows them PER EFFECT instead of showing every control
// under every tool. `ToolPalette` and `BrushInspector` were deleted rather than
// moved; the swatch strip is the one piece that travelled intact. Task 10 took the
// PROPERTIES concern the same way: `StampInspector` was deleted, not moved, and the
// session card (shell/SessionCard) is its successor — a palette of its own whose
// open state the editor drives, with a REST state the inspector never had.
//
// Task 13 took the last two. The advisor's findings are shell/FlagsPalette, with the
// filters persisted and the viewport as their primary selection surface (D-F4.5-15);
// the selection footer's count and its Clear / Reselect verbs are the status bar's
// `sel N cells` chip, beside the other live readouts rather than at the bottom of a
// palette that has to be open to be read.
//
// Renders `null` rather than a placeholder: an empty box with a title bar is a
// palette advertising that it has something to say. The id, its default geometry,
// its burger checkbox and this file all retire together in Task 14 — doing it here
// would mean deleting a component and a palette id in a commit whose subject is the
// flags surface.
export function FieldPanel() {
	return null;
}
