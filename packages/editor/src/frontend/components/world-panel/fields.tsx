// Leaf helpers shared by the World panel's three pieces (WorldPanel.tsx, RegionRow.tsx,
// AddRegionForm.tsx): the label scaffolding every knob repeats, the number-input parser,
// and the error-to-string helper. SELECT_CLASS + ReasonTip are also reused by the Field
// panel (FieldPanel.tsx, field/BrushInspector.tsx). Nothing here holds state or knows
// about the draft.
//
// These panels use the NATIVE <select>, not the package's ui/select.tsx (Radix) — a
// deliberate deviation from the primitive four other files use. The World panel's selects
// are dense, list-driven knob rows (walls, region ids, connector kinds) where the
// platform's own keyboard and mobile-wheel behaviour is exactly what we want, and a native
// control stays drivable from the chrome harness with fireEvent.change. Radix's portaled
// listbox buys nothing at this size and costs the harness a mock.
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export const SELECT_CLASS =
	"h-8 rounded-md border border-input bg-transparent px-2";

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

/** An unknown thrown value as a display string. */
export const errorMessage = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

/** Wrap a DISABLED control so its explanation is still reachable: shadcn's Button sets
 *  `disabled:pointer-events-none` (ui/button.tsx), so a `title` on the button itself
 *  never fires a tooltip and isn't reliably exposed to AT either. The span still takes
 *  pointer events, so the reason survives the disable. */
export function ReasonTip(props: {
	reason: string | undefined;
	children: ReactNode;
}) {
	return (
		<span title={props.reason} className={cn(props.reason && "cursor-help")}>
			{props.children}
		</span>
	);
}
