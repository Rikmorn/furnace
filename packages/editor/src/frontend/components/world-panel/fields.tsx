// Leaf helpers shared by the World panel's three pieces (WorldPanel.tsx, RegionRow.tsx,
// AddRegionForm.tsx): the label scaffolding every knob repeats and the number-input
// parser. SELECT_CLASS, ReasonTip, and errorMessage moved to field/form-bits.tsx (also
// reused by the Field panel: FieldPanel.tsx, field/BrushInspector.tsx) and are
// re-exported here so this module's own two remaining World-panel consumers keep
// compiling. Nothing here holds state or knows about the draft.
import type { ReactNode } from "react";

export { errorMessage, ReasonTip, SELECT_CLASS } from "../field/form-bits.tsx";

/** One labelled knob. The WRAPPING label associates its text with whatever control is
 *  passed as children — no id/htmlFor plumbing, and getByLabelText finds it. */
export function Field(props: { label: string; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the label wraps its control as children (shadcn Input/Checkbox or passed children); Biome cannot trace the native control across the component boundary — getByLabelText still resolves it
		<label className="flex flex-col gap-1">
			<span className="text-muted-foreground">{props.label}</span>
			{props.children}
		</label>
	);
}

/**
 * Read a `<input type="number">` value as a number.
 *
 * What this ACTUALLY does today (the fallback is nearly dead code, deliberately kept
 * honest here): a number input reports `""` for anything it cannot parse — including a
 * lone `"-"` mid-typing — and `Number("")` is `0`, which is finite. So an emptied field
 * resolves to **0**, not to `fallback`; the fallback branch only fires for a value the
 * control never produces. Clearing a knob therefore SNAPS it to 0 (a 0-cell axis then
 * fails loud at stamp time — a UX wart, not a correctness hole). Buffering the raw string
 * until it parses is the real fix; it needs a shared field component, so it is deferred:
 * `docs/backlog/editor-and-tooling/world-panel-number-field-ux.md`.
 */
export const num = (v: string, fallback: number): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
};
