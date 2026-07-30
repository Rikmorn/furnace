// The corner orientation gizmo, over the canvas: which way is up, which way is north,
// at a glance. A shell surface (it lives in the top-right of the viewport cell, like
// Toasts live at its bottom), not a panel one — the canvas is the whole window now, so
// there is no panel corner left to put it in.
//
// It reads the pose out of context rather than subscribing: `subscribeCameraPose` is a
// single slot the shell's provider claims, and a second subscriber would silently steal
// it (the seam stores ONE callback).
//
// DISPLAY-ONLY, deliberately. Click-to-snap ("look down +X") needs orbit SETTERS the host
// does not expose — `orbitState` is written only by the fly/look input paths — so this
// slice ships the readout the triad already was, and the snap rides F4.5b with the rest
// of the pointer work. `pointer-events-none` is what keeps a decorative overlay from
// eating orbit drags in the corner it sits in.
import { useCameraPose } from "../../hooks/useFieldHostState.tsx";
import { AxisTriad } from "../AxisTriad.tsx";

export function AxisTriadMount() {
	const { yaw, pitch } = useCameraPose();
	return (
		<div className="pointer-events-none absolute top-2 right-2">
			<AxisTriad yaw={yaw} pitch={pitch} />
		</div>
	);
}
