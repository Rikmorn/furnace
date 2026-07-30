// Layer visibility + the two view modes (F2b Task 15, F3b Task 12, F4 Task 11):
// seven checkboxes drive host.setLayers (display-only gates — hiding a layer
// never affects targeting, ops, or bakes); beside them the void-cast toggle (the
// X-ray, also a setLayers flag) and the slice enable + Y slider (host.setSlice
// — display + targeting, never the field). Pure presentation — the panel owns
// the state and every host call.
//
// Two labelled groups, because they are two kinds of control wearing the same
// widget. The seven under "layers" are free display gates over state that
// already exists — `flags` included: the advisor analyses whether or not its
// markers are drawn, so hiding them costs nothing and starts nothing. The void
// toggle rides in FieldLayers but belongs under "view": ticking it RUNS a
// whole-world job that can refuse (chunk budget), and the next edit throws the
// result away. Blender draws the same line — outliner visibility columns are one
// thing, the X-ray overlay toggle is another — and the group label is what makes
// it visible here, since one more identical checkbox in a flat row would read as
// one more free gate.
import type { FieldLayers } from "../../../viewport-host/index.ts"; // type-only: erased

const VOID_CAST_TITLE =
	"X-ray: meshes the air as a solid, so a cave network reads from outside. Built when you tick it; the next edit clears it — re-tick to refresh";

// The exclusion above, made machine-checked: putting `voidCast` in the group
// stops compiling rather than quietly shipping an expensive toggle dressed as a
// free one (and rendering it twice).
type VisibilityLayer = Exclude<keyof FieldLayers, "voidCast">;

// Keyed by layer, so the group is EXHAUSTIVE: a new FieldLayers field has no
// title here and stops compiling. The array this replaced could not say that —
// an extra key failed, a MISSING one did not, which is how `flags` shipped in F4
// with no toggle at all. The key doubles as the visible label (every one of them
// already did), so there is one string per layer and nothing to keep in sync.
const LAYER_TITLES: Record<VisibilityLayer, string> = {
	field: "the per-class surface meshes",
	kit: "the instanced kit pieces",
	props: "placed prop proxies (scatter placements)",
	ghost: "brush ghost + stamp hologram",
	selection: "selection overlay + entity highlight",
	grid: "the reference grid",
	flags:
		"the walkability advisor's severity markers — hiding them does not stop the analyzer",
};

/** Render order, which is declaration order above (string keys enumerate in
 *  insertion order). */
// Boundary cast: `Object.keys` is typed `string[]` because a VALUE can
// structurally carry keys its type never declared — but the argument here is an
// object literal checked against `Record<VisibilityLayer, string>`, which cannot.
// The invariant the cast re-states is that literal's own excess-property check,
// which the return type of Object.keys has no way to carry.
const LAYERS = Object.keys(LAYER_TITLES) as VisibilityLayer[];

// Slice slider range (world metres): −8 reaches below any v0 dig, +24 clears
// the tallest kit hall; 0.25 m steps match the field's cell size.
const SLICE_MIN_Y = -8;
const SLICE_MAX_Y = 24;
const SLICE_STEP = 0.25;

const LABEL_CLASS = "flex items-center gap-1 text-muted-foreground";

const GHOST_SUPPRESSED_TITLE =
	"brush ghost is hidden while a selection tool is active";

const HEADLAMP_TITLE =
	"light the field from the camera instead of flat shading";

export function LayersRow(props: {
	layers: FieldLayers;
	slice: { enabled: boolean; y: number };
	ghostSuppressed: boolean;
	/** The host's headlamp shading mode. MIGRATION (until Task 9 of the F4.5a plan): it
	 *  rode the world toolbar until the world verbs left it, and lands here — beside the
	 *  other view toggles — for the one task between that and the View popover it
	 *  belongs in. */
	headlamp: boolean;
	onLayers: (next: FieldLayers) => void;
	onSlice: (next: { enabled: boolean; y: number }) => void;
	onShading: (on: boolean) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
			<span
				className="flex flex-wrap items-center gap-2 text-muted-foreground"
				role="group"
				aria-label="layer visibility"
			>
				layers
				{LAYERS.map((layer) => {
					// The ghost layer gates three host paths: the brush/kit-fill ghost
					// (hidden while ANY gesture is armed) AND the stamp hologram (stays
					// live during a stamp session, no gesture gate) AND the segment
					// brush's capsule preview (live once a point is anchored). So the
					// checkbox is inert when a SELECTION gesture is armed and no stamp
					// session is active — which is exactly `ghostSuppressed`. Show it
					// disabled then, instead of letting it read as dead.
					//
					// Not exact, and deliberately so: an armed-but-UNANCHORED segment
					// gesture also has nothing for the flag to show, and this reads as
					// enabled there. Tracking that would mean plumbing the host's anchor
					// state into the panel to grey a checkbox for the moment between two
					// clicks. Presentational only; the host owns the real suppression.
					const suppressed = layer === "ghost" && props.ghostSuppressed;
					return (
						<label
							key={layer}
							title={suppressed ? GHOST_SUPPRESSED_TITLE : LAYER_TITLES[layer]}
							className={LABEL_CLASS}
						>
							<input
								type="checkbox"
								checked={props.layers[layer]}
								disabled={suppressed}
								onChange={(e) =>
									props.onLayers({ ...props.layers, [layer]: e.target.checked })
								}
							/>
							{layer}
						</label>
					);
				})}
			</span>
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
			<span
				className="flex flex-wrap items-center gap-2 text-muted-foreground"
				role="group"
				aria-label="view modes"
			>
				view
				<label className={LABEL_CLASS} title={VOID_CAST_TITLE}>
					<input
						type="checkbox"
						checked={props.layers.voidCast}
						onChange={(e) =>
							props.onLayers({ ...props.layers, voidCast: e.target.checked })
						}
						aria-label="void cast"
					/>
					void
				</label>
				<label className={LABEL_CLASS}>
					<input
						type="checkbox"
						checked={props.slice.enabled}
						onChange={(e) =>
							props.onSlice({ ...props.slice, enabled: e.target.checked })
						}
						aria-label="slice view"
					/>
					slice
				</label>
				<label className={LABEL_CLASS}>
					y
					<input
						type="range"
						min={SLICE_MIN_Y}
						max={SLICE_MAX_Y}
						step={SLICE_STEP}
						value={props.slice.y}
						disabled={!props.slice.enabled}
						onChange={(e) =>
							props.onSlice({ enabled: true, y: Number(e.target.value) })
						}
						aria-label="slice y"
					/>
					<span className="w-14 tabular-nums">
						{props.slice.y.toFixed(2)} m
					</span>
				</label>
				<label className={LABEL_CLASS} title={HEADLAMP_TITLE}>
					<input
						type="checkbox"
						checked={props.headlamp}
						onChange={(e) => props.onShading(e.target.checked)}
						aria-label="headlamp"
					/>
					headlamp
				</label>
			</span>
		</div>
	);
}
