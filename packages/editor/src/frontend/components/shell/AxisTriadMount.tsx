// The corner orientation gizmo, over the canvas: which way is up, which way is north,
// at a glance — and, since F4.5b Task 6, six clickable tips that SNAP the view to an
// axis. A shell surface (it lives in the top-right of the viewport cell, like Toasts
// live at its bottom), not a panel one — the canvas is the whole window now, so there
// is no panel corner left to put it in.
//
// It reads the pose out of context rather than subscribing: `subscribeCameraPose` is a
// single slot the shell's provider claims, and a second subscriber would silently steal
// it (the seam stores ONE callback). The snap goes the other way — straight to the host
// through `fieldHostRef`, like every other chrome→host verb.
//
// `pointer-events-none` on the BOX is what keeps the overlay from eating orbit drags in
// the corner it sits in; the tips re-enable it for their own caps (see AxisTriad).
import { useCallback } from "react";
import { useCameraPose } from "../../hooks/useFieldHostState.tsx";
import { AxisTriad } from "../AxisTriad.tsx";
import { useEditor } from "../editor-context.ts";

export function AxisTriadMount() {
	const { yaw, pitch } = useCameraPose();
	const { fieldHostRef } = useEditor();
	const snap = useCallback(
		(axis: "x" | "y" | "z", sign: 1 | -1) =>
			fieldHostRef.current?.snapView(axis, sign),
		[fieldHostRef],
	);
	return (
		<div className="pointer-events-none absolute top-2 right-2">
			<AxisTriad yaw={yaw} pitch={pitch} onSnap={snap} />
		</div>
	);
}
