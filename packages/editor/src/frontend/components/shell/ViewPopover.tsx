// The View popover (D-F4.5-16): everything about what the viewport SHOWS, in the top
// bar, one click from anywhere — shading, the layer gates, the X-ray, the slice plane and
// the viewport's antialiasing. It replaces the panel's layers row, which put display
// state inside a palette that closing took away with it.
//
// Pure presentation over `useView`: the provider owns the values, the persistence and
// every host push, so this file decides only what the controls look like and which verb
// each one calls.
//
// Three labelled groups plus a lone switch, because they are different kinds of control
// wearing the same widget. The seven under "layers" are free display gates over state
// that already exists — `flags` included: the advisor analyses whether or not its markers
// are drawn, so hiding them costs nothing and starts nothing. The two under "overlays"
// each COST something: ticking void runs a whole-world cast job that can refuse (chunk
// budget) and that the next edit throws away, and the slice re-meshes every chunk through
// a new clip plane. Blender draws the same line — outliner visibility columns are one
// thing, the X-ray overlay toggle is another — and the group label is what makes it
// visible here, since one more identical checkbox in a flat row would read as one more
// free gate.
//
// Antialiasing stands ALONE at the bottom, under no group, because it is the one control
// here that is not about the scene at all: it changes how the picture is drawn, and it
// pays for it with a GPU context rebuild. (It also has nowhere honest to sit — an
// "overlay" it is not.)
//
// Every control here documents itself through a real TOOLTIP rather than a `title`
// (D-25): the sentences below are what each toggle costs and what it does to the picture,
// they are the whole reason a checkbox called "void" is comprehensible, and a `title`
// hands them to a mouse and to nobody else. The trigger wraps the <label>, so the tooltip
// opens both on a hover anywhere across the row and on the nested control taking FOCUS.
//
// The controls are the house library's (D-24), so each row spells an explicit `htmlFor`.
// That is BELT AND BRACES, not a requirement, and the claim that used to stand here — "a
// <label> reaches a button by NAMING it, never by wrapping it" — is false. `button` is a
// labelable element in the HTML spec, so a <label> wrapping one is already associated with
// it; measured at the F4.5c Task 12 quality round, where stripping every `htmlFor` here left
// the row-text click working and the whole chrome directory green. The attribute stays
// because it survives the control moving OUT of the label, which the implicit association
// does not — but nobody should believe the rows depend on it.
//
// What the rows DO depend on is the row text staying clickable at all, which is most of each
// row's hit target and which no query in this file would notice losing (they all resolve
// through `aria-label`, straight at the control). That is pinned in `shell.test.tsx`,
// "clicking a row's TEXT toggles it".
//
// Every group's aria-label is its visible label, verbatim. They diverged once ("layers"
// over `aria-label="layer visibility"`) and a divergence is a screen reader and a screen
// disagreeing about what a thing is called. And none of them is called "view": inside a
// popover already named View, a group by that name says nothing.
import { useId } from "react";
import type {
	FieldHostShading,
	FieldLayers,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { useViewActions, useViewState } from "../../hooks/useView.tsx";
import { useViewportFocusReturn } from "../../hooks/useViewportFocusReturn.ts";
import { ActionTip } from "../tips.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { Segmented, type SegmentedOption } from "../ui/segmented.tsx";

const VOID_CAST_HINT =
	"X-ray: meshes the air as a solid, so a cave network reads from outside. Built when you tick it; the next edit clears it — re-tick to refresh";

const SLICE_HINT =
	"cut the world at a height: everything at or above the plane reads as air, for display AND for what the brush targets";

const AA_HINT =
	"multisampling on the viewport pass. Changing it rebuilds the GPU context: the world, your edits and the camera survive, the picture blinks — but a stamp you have not committed is discarded";

// The exclusion above, made machine-checked: putting `voidCast` in the group stops
// compiling rather than quietly shipping an expensive toggle dressed as a free one (and
// rendering it twice).
type VisibilityLayer = Exclude<keyof FieldLayers, "voidCast">;

// Keyed by layer, so the group is EXHAUSTIVE: a new FieldLayers field has no hint here
// and stops compiling. The array this replaced could not say that — an extra key failed,
// a MISSING one did not, which is how `flags` shipped in F4 with no toggle at all. The
// key doubles as the visible label (every one of them already did), so there is one
// string per layer and nothing to keep in sync.
const LAYER_HINTS: Record<VisibilityLayer, string> = {
	field: "the per-class surface meshes",
	kit: "the instanced kit pieces",
	props: "placed prop proxies (scatter placements)",
	// Everything the editor draws as a PREVIEW rides this one gate: the brush ghost, the
	// stamp hologram and its placement proxies, the segment anchor and capsule, and the
	// armed-but-unanchored cursor affordance. Deliberately NOT rendered `disabled` in any
	// state — the panel's old layers row did that, computing `ghostSuppressed` as
	// "a selection gesture is armed and no session stands", and F4.5b falsified the
	// predicate rather than merely unplumbing it: Task 9 gave every armed-but-unanchored
	// gesture an affordance drawn under exactly this gate, and a session draws its
	// hologram here too. So there is no longer a reachable state in which this box is
	// live over an empty layer, and a disabled tick would be the lie the affordance was
	// meant to prevent.
	ghost: "brush ghost, stamp hologram, segment preview, cursor affordance",
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
const LAYERS = Object.keys(LAYER_HINTS) as VisibilityLayer[];

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
 *  (critique P0).
 *
 *  A SEGMENTED control rather than the stacked radios this row shipped as (D-24/D-25): two
 *  members is exactly the cardinality the segmented vocabulary exists for, and the radios
 *  were the shell's last raw `<input type="radio">`.
 *
 *  The mode travels as the option's `value` and comes back NARROWED — `Segmented<T>` is
 *  generic, so `onChange` hands over a `FieldHostShading` directly. No cast, and no lookup
 *  either: this row carried a `find` plus an `if (picked === undefined) return` until the
 *  Task 12 quality round pointed out that neither could ever fire, because the options are
 *  built from `SHADING_MODES` right here. A type parameter buys what the runtime guard was
 *  pretending to. (`SegmentedField` keeps ITS lookup for a real reason — a schema `member`
 *  is `unknown` and genuinely distinct from the transport `value`.) */
const SHADING_MODES: {
	mode: FieldHostShading;
	label: string;
	hint: string;
}[] = [
	{
		mode: "studio",
		label: "Studio",
		hint: "lit from the camera with a hemisphere fill — form and material colour",
	},
	{
		mode: "normals",
		label: "Normals (debug)",
		hint: "unlit normal-colour: shows surface orientation, hides every material difference",
	},
];

const SHADING_OPTIONS: SegmentedOption<FieldHostShading>[] = SHADING_MODES.map(
	({ mode, label, hint }) => ({ value: mode, label, hint }),
);

export function ViewPopover({
	open,
	onOpenChange,
}: {
	/** Controlled by the top bar, because the burger's "View options…" item opens this
	 *  same popover — one surface, two doors. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { shading, layers, slice, sampleCount } = useViewState();
	const view = useViewActions();
	// "Open it, change something, close it, keep flying" is this popover's normal loop —
	// it is the surface that made the dead-keys class worth fixing at all.
	const focusReturn = useViewportFocusReturn();
	const setLayer = (layer: keyof FieldLayers, on: boolean): void =>
		view.setLayers({ ...layers, [layer]: on });
	// `useId` rather than hardcoded strings: a literal id is a claim on the whole document,
	// and this popover shares one with the inspector's field rows and every other palette.
	// The hook makes the claim local to the mount, so nobody has to go checking.
	const uid = useId();
	const boxId = (name: string): string => `${uid}-${name}`;

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger
				aria-label="view options"
				className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-muted-foreground text-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
			>
				<span aria-hidden="true">⬒</span>
				view
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-64 space-y-3 p-3 text-xs"
				{...focusReturn.overlay}
			>
				<div className={GROUP_CLASS}>
					<span className={GROUP_LABEL_CLASS}>shading</span>
					<Segmented
						label="shading"
						value={shading}
						options={SHADING_OPTIONS}
						onChange={view.setShading}
						className="w-fit"
					/>
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control set; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
				<div className={GROUP_CLASS} role="group" aria-label="layers">
					<span className={GROUP_LABEL_CLASS}>layers</span>
					{LAYERS.map((layer) => (
						<ActionTip key={layer} hint={LAYER_HINTS[layer]}>
							<label className={LABEL_CLASS} htmlFor={boxId(layer)}>
								<Checkbox
									id={boxId(layer)}
									checked={layers[layer]}
									onCheckedChange={(c) => setLayer(layer, c === true)}
									aria-label={layer}
								/>
								{layer}
							</label>
						</ActionTip>
					))}
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control set; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
				<div className={GROUP_CLASS} role="group" aria-label="overlays">
					<span className={GROUP_LABEL_CLASS}>overlays</span>
					<ActionTip hint={VOID_CAST_HINT}>
						<label className={LABEL_CLASS} htmlFor={boxId("voidCast")}>
							<Checkbox
								id={boxId("voidCast")}
								checked={layers.voidCast}
								onCheckedChange={(c) => setLayer("voidCast", c === true)}
								aria-label="void cast"
							/>
							void
						</label>
					</ActionTip>
					<ActionTip hint={SLICE_HINT}>
						<label className={LABEL_CLASS} htmlFor={boxId("slice")}>
							<Checkbox
								id={boxId("slice")}
								checked={slice.enabled}
								onCheckedChange={(c) =>
									view.setSlice({ ...slice, enabled: c === true })
								}
								aria-label="slice view"
							/>
							slice
						</label>
					</ActionTip>
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
				</div>
				<ActionTip hint={AA_HINT}>
					<label
						className={`${LABEL_CLASS} border-border border-t pt-3`}
						htmlFor={boxId("antialiasing")}
					>
						<Checkbox
							id={boxId("antialiasing")}
							checked={sampleCount === 4}
							onCheckedChange={(c) => view.setSampleCount(c === true ? 4 : 1)}
							aria-label="antialiasing"
						/>
						antialiasing
					</label>
				</ActionTip>
			</PopoverContent>
		</Popover>
	);
}
