// Leaf form helpers shared across the Field panel's pieces (FieldPanel.tsx,
// FieldToolbar.tsx, BrushInspector.tsx, StampInspector.tsx): the select
// styling, the disabled-control tooltip wrapper, and the error-to-string
// helper. Relocated from world-panel/fields.tsx ahead of that module's
// deletion. MIGRATION (until Task 4 of the F4.5a plan): world-panel/fields.tsx
// re-exports these names in the interim, for the two World-panel files that
// still import them. Nothing here holds state or knows about the draft.
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
