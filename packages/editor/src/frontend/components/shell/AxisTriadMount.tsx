// The corner orientation gizmo, over the canvas: which way is up, which way is north,
// at a glance — and, since F4.5b Task 6, six clickable tips that SNAP the view to an
// axis. A shell surface (it lives in the top-right of the viewport cell, like Toasts
// live at its bottom), not a panel one — the canvas is the whole window now, so there
// is no panel corner left to put it in.
//
// It reads the pose out of context rather than subscribing: the shell's provider owns
// `subscribeCameraPose`, and nothing below it may claim a seam that provider holds. The
// seam is multicast, so a second subscription here would not break anything visibly —
// it would be a duplicate pose mirror re-rendering on the same pointer-rate push, plus a
// leak if this overlay ever forgot its cleanup. The snap goes the other way — straight to
// the host through `fieldHostRef`, like every other chrome→host verb.
//
// `pointer-events-none` on the BOX is what keeps the overlay from eating orbit drags in
// the corner it sits in; the tips re-enable it for their own caps (see AxisTriad).
import { useCameraPose } from "../../hooks/useFieldHostState.tsx";
import { AxisTriad } from "../AxisTriad.tsx";
import { useEditor } from "../editor-context.ts";

export function AxisTriadMount() {
	const { yaw, pitch } = useCameraPose();
	const { fieldHostRef } = useEditor();
	return (
		<div className="pointer-events-none absolute top-2 right-2">
			<AxisTriad
				yaw={yaw}
				pitch={pitch}
				onSnap={(axis, sign) => fieldHostRef.current?.snapView(axis, sign)}
			/>
		</div>
	);
}
