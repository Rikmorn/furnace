// The Field panel's tool strip: the four brush effects, the five click
// gestures, and one stamp button per registry generator. Pure presentation —
// the panel owns the active choice and every host call. A gesture button
// highlights while its gesture is armed; generator buttons are ACTIONS, not
// toggles — each press opens (or replaces) a stamp session, whose UI is the
// stamp form (Task 15), not a palette state.
//
// The five gestures sit in ONE group because they share one slot in the host
// (ViewportGesture — arming any disarms the rest); splitting the selections
// from `segment` would imply they can be armed independently. The
// brush effects stay highlighted under `segment`, which is not a lie: a segment
// click commits a brush op with the active effect and material.
//
// `Select` (the pointer) leads the group because it is what a host opens ARMED
// with, and a default with no button would be a mode the user can neither see
// nor get back to.
import type {
	FieldTool,
	ViewportGesture,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { Button } from "../ui/button.tsx";

type ToolEffect = FieldTool["effect"];

const BRUSH_TOOLS: { effect: ToolEffect; label: string; title: string }[] = [
	{ effect: "dig", label: "Dig", title: "carve air (momentary: hold Ctrl)" },
	{ effect: "fill", label: "Fill", title: "solidify + write the material" },
	{
		effect: "paint",
		label: "Paint",
		title: "retint solid cells (organic classes only)",
	},
	{
		effect: "smooth",
		label: "Smooth",
		title: "relax the surface (momentary: hold Shift)",
	},
];

const GESTURE_TOOLS: {
	gesture: ViewportGesture;
	label: string;
	title: string;
}[] = [
	{
		gesture: "pointer",
		label: "Select",
		// Select is the DEFAULT arming, so this is also where the camera bindings
		// change — and this tooltip is where someone looks when the wheel stops
		// sizing their brush. The gizmo is the orbit-mode indicator (it appears on
		// nearly the same condition the selection-pivot orbit does), so it is worth
		// naming as one rather than leaving the mode invisible.
		title:
			"click a stamp, a prop or a marker to select it — click bare rock to deselect · with this armed the wheel travels the camera instead of sizing the brush, and right-drag orbits the selection (the gizmo arms say when) rather than looking around",
	},
	{
		gesture: "box",
		label: "Box Select",
		title: "two clicks span a snapped region",
	},
	{
		gesture: "material",
		label: "Wand",
		title: "flood-select the clicked material",
	},
	{ gesture: "void", label: "Room", title: "flood-select an air pocket" },
	{
		gesture: "segment",
		label: "Segment",
		// The 60 m is FieldHost's MAX_SEGMENT_M, restated: the chrome cannot
		// value-import anything under `viewport-host/`, so the two agree by review.
		title:
			"two clicks sweep the brush between them — one op (dig: a tunnel, fill: a rampart) · max 60 m; Esc drops the first point",
	},
];

export function ToolPalette(props: {
	/** The active brush effect — highlighted while LMB still brushes (no gesture,
	 *  or the segment gesture, which commits with this effect). */
	effect: ToolEffect;
	/** The armed click gesture (null = LMB brushes a stroke). */
	gesture: ViewportGesture | null;
	/** Registry generators for the stamp buttons (host `listGenerators`). */
	generators: { id: string; name: string }[];
	onBrush: (effect: ToolEffect) => void;
	onGesture: (gesture: ViewportGesture) => void;
	onGenerator: (id: string) => void;
}) {
	const brushActive = props.gesture === null || props.gesture === "segment";
	return (
		<div className="flex flex-wrap items-center gap-2">
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
			<div
				className="flex flex-wrap items-center gap-1"
				role="group"
				aria-label="brush tool"
			>
				{BRUSH_TOOLS.map((t) => (
					<Button
						key={t.effect}
						type="button"
						size="sm"
						variant={
							brushActive && props.effect === t.effect ? "default" : "secondary"
						}
						aria-pressed={brushActive && props.effect === t.effect}
						title={t.title}
						onClick={() => props.onBrush(t.effect)}
					>
						{t.label}
					</Button>
				))}
			</div>
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
			<div
				className="flex flex-wrap items-center gap-1"
				role="group"
				aria-label="click gesture"
			>
				{GESTURE_TOOLS.map((t) => (
					<Button
						key={t.gesture}
						type="button"
						size="sm"
						variant={props.gesture === t.gesture ? "default" : "secondary"}
						aria-pressed={props.gesture === t.gesture}
						title={t.title}
						onClick={() => props.onGesture(t.gesture)}
					>
						{t.label}
					</Button>
				))}
			</div>
			{props.generators.length > 0 && (
				// biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids
				<div
					className="flex flex-wrap items-center gap-1"
					role="group"
					aria-label="stamp generator"
				>
					{props.generators.map((g) => (
						<Button
							key={g.id}
							type="button"
							size="sm"
							variant="outline"
							title={`stamp ${g.name} into the current selection`}
							onClick={() => props.onGenerator(g.id)}
						>
							{g.name}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
