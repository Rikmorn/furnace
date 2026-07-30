// Leaf form helpers shared across the Field panel's pieces (FieldPanel.tsx,
// BrushInspector.tsx, StampInspector.tsx) and the world drawer: the select
// styling and the disabled-control tooltip wrapper. Nothing here holds state.
//
// These panels use the NATIVE <select>, not the package's ui/select.tsx (Radix) — a
// deliberate deviation from the primitive four other files use. The selects here are
// dense, list-driven knob rows where the platform's own keyboard and mobile-wheel
// behaviour is exactly what we want, and a native control stays drivable from the chrome
// harness with fireEvent.change. Radix's portaled listbox buys nothing at this size and
// costs the harness a mock.
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export const SELECT_CLASS =
	"h-8 rounded-md border border-input bg-transparent px-2";

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
