// Leaf form helpers, shared across whatever still renders a dense knob row: the session
// card (shell/SessionCard.tsx), the top strip's overflow and the world drawer — the select
// styling and the disabled-control tooltip wrapper. Nothing here holds state.
//
// The `field/` address is now historical rather than descriptive: the panel's own pieces
// that used to be the callers (BrushInspector, StampInspector) were both deleted, and the
// surviving consumers are shell surfaces. Left where it is for Task 14's dissolution pass
// to move with everything else, rather than churning imports twice.
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
	/** Layout classes for the wrapper. It sits BETWEEN the caller's flex container and the
	 *  control, so without a way to spell `flex-1` here a wrapped button silently stops
	 *  participating in the row it was written into. */
	className?: string;
	children: ReactNode;
}) {
	return (
		<span
			title={props.reason}
			className={cn(props.reason && "cursor-help", props.className)}
		>
			{props.children}
		</span>
	);
}
