// The View popover (D-F4.5-16): everything about what the viewport SHOWS, in the top
// bar, one click from anywhere — shading, the layer gates, the X-ray, the slice plane and
// the viewport's antialiasing. It replaces the panel's layers row, which put display
// state inside a palette that closing took away with it.
//
// Pure presentation over `useView`: the provider owns the values, the persistence and
// every host push, so this file decides only what the controls look like and which verb
// each one calls.
//
// Two labelled groups, because they are two kinds of control wearing the same widget.
// The seven under "layers" are free display gates over state that already exists —
// `flags` included: the advisor analyses whether or not its markers are drawn, so hiding
// them costs nothing and starts nothing. The three under "view" each COST something:
// ticking void runs a whole-world cast job that can refuse (chunk budget) and that the
// next edit throws away, the slice re-meshes every chunk through a new clip plane, and AA
// disposes and rebuilds the GPU context. Blender draws the same line — outliner
// visibility columns are one thing, the X-ray overlay toggle is another — and the group
// label is what makes it visible here, since one more identical checkbox in a flat row
// would read as one more free gate.
import type {
	FieldHostShading,
	FieldLayers,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { useViewActions, useViewState } from "../../hooks/useView.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";

const VOID_CAST_TITLE =
	"X-ray: meshes the air as a solid, so a cave network reads from outside. Built when you tick it; the next edit clears it — re-tick to refresh";

const SLICE_TITLE =
	"cut the world at a height: everything at or above the plane reads as air, for display AND for what the brush targets";

const AA_TITLE =
	"multisampling on the viewport pass. Turning it off rebuilds the GPU context — the world and your edits survive, the picture blinks";

// The exclusion above, made machine-checked: putting `voidCast` in the group stops
// compiling rather than quietly shipping an expensive toggle dressed as a free one (and
// rendering it twice).
type VisibilityLayer = Exclude<keyof FieldLayers, "voidCast">;

// Keyed by layer, so the group is EXHAUSTIVE: a new FieldLayers field has no title here
// and stops compiling. The array this replaced could not say that — an extra key failed,
// a MISSING one did not, which is how `flags` shipped in F4 with no toggle at all. The
// key doubles as the visible label (every one of them already did), so there is one
// string per layer and nothing to keep in sync.
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

/** Render order, which is declaration order above (string keys enumerate in insertion
 *  order). */
// Boundary cast: `Object.keys` is typed `string[]` because a VALUE can structurally carry
// keys its type never declared — but the argument here is an object literal checked
// against `Record<VisibilityLayer, string>`, which cannot. The invariant the cast
// re-states is that literal's own excess-property check, which the return type of
// Object.keys has no way to carry.
const LAYERS = Object.keys(LAYER_TITLES) as VisibilityLayer[];

// Slice slider range (world metres): −8 reaches below any v0 dig, +24 clears the tallest
// kit hall; 0.25 m steps match the field's cell size.
const SLICE_MIN_Y = -8;
const SLICE_MAX_Y = 24;
const SLICE_STEP = 0.25;

const LABEL_CLASS = "flex items-center gap-1.5 text-muted-foreground";
const GROUP_CLASS = "flex flex-col gap-1.5";
const GROUP_LABEL_CLASS =
	"font-medium text-[11px] text-muted-foreground uppercase tracking-wide";

/** The two shading modes, in the order they are offered: the state of seeing first, the
 *  debug flag second — and the debug one SAYS so, because a full-chroma normal render is
 *  the most attention-grabbing thing on the screen and reads as a feature otherwise
 *  (critique P0). */
const SHADING_MODES: {
	mode: FieldHostShading;
	label: string;
	title: string;
}[] = [
	{
		mode: "studio",
		label: "Studio",
		title:
			"lit from the camera with a hemisphere fill — form and material colour",
	},
	{
		mode: "normals",
		label: "Normals (debug)",
		title:
			"unlit normal-colour: shows surface orientation, hides every material difference",
	},
];

export function ViewPopover() {
	const { shading, layers, slice, sampleCount } = useViewState();
	const view = useViewActions();
	const setLayer = (layer: keyof FieldLayers, on: boolean): void =>
		view.setLayers({ ...layers, [layer]: on });

	return (
		<Popover>
			<PopoverTrigger
				aria-label="view options"
				className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-muted-foreground text-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
			>
				<span aria-hidden="true">⬒</span>
				view
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64 space-y-3 p-3 text-xs">
				<div className={GROUP_CLASS} role="radiogroup" aria-label="shading">
					<span className={GROUP_LABEL_CLASS}>shading</span>
					{SHADING_MODES.map(({ mode, label, title }) => (
						<label key={mode} className={LABEL_CLASS} title={title}>
							<input
								type="radio"
								name="shading"
								checked={shading === mode}
								onChange={() => view.setShading(mode)}
							/>
							{label}
						</label>
					))}
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control set; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
				<div className={GROUP_CLASS} role="group" aria-label="layer visibility">
					<span className={GROUP_LABEL_CLASS}>layers</span>
					{LAYERS.map((layer) => (
						<label
							key={layer}
							title={LAYER_TITLES[layer]}
							className={LABEL_CLASS}
						>
							<input
								type="checkbox"
								checked={layers[layer]}
								onChange={(e) => setLayer(layer, e.target.checked)}
							/>
							{layer}
						</label>
					))}
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control set; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
				<div className={GROUP_CLASS} role="group" aria-label="view modes">
					<span className={GROUP_LABEL_CLASS}>view</span>
					<label className={LABEL_CLASS} title={VOID_CAST_TITLE}>
						<input
							type="checkbox"
							checked={layers.voidCast}
							onChange={(e) => setLayer("voidCast", e.target.checked)}
							aria-label="void cast"
						/>
						void
					</label>
					<label className={LABEL_CLASS} title={SLICE_TITLE}>
						<input
							type="checkbox"
							checked={slice.enabled}
							onChange={(e) =>
								view.setSlice({ ...slice, enabled: e.target.checked })
							}
							aria-label="slice view"
						/>
						slice
					</label>
					{/* The slider stays MOUNTED while the plane is off, disabled and showing the
					    depth a re-tick would return to — a control that vanishes takes the
					    answer to "where was it?" with it. */}
					<label className={`${LABEL_CLASS} pl-5`}>
						y
						<input
							type="range"
							min={SLICE_MIN_Y}
							max={SLICE_MAX_Y}
							step={SLICE_STEP}
							value={slice.y}
							disabled={!slice.enabled}
							onChange={(e) =>
								view.setSlice({ enabled: true, y: Number(e.target.value) })
							}
							aria-label="slice y"
							className="min-w-0 flex-1"
						/>
						<span className="w-14 shrink-0 tabular-nums">
							{slice.y.toFixed(2)} m
						</span>
					</label>
					<label className={LABEL_CLASS} title={AA_TITLE}>
						<input
							type="checkbox"
							checked={sampleCount === 4}
							onChange={(e) => view.setSampleCount(e.target.checked ? 4 : 1)}
							aria-label="antialiasing"
						/>
						antialiasing
					</label>
				</div>
			</PopoverContent>
		</Popover>
	);
}
