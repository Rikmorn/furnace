// The top strip (D-6/D-7): what is armed, and the handful of knobs that steer it, in the
// fixed 40 px top bar.
//
// THE CAPACITY RULE (D-6). The strip is ONE flex row. It never wraps and never changes
// height — the bar's height is half the canvas cell's inset budget, so a strip that grew
// would move the canvas, which is the one thing the overlay cockpit forbids (D-1). Two
// mechanisms hold that:
//   - `overflow-hidden`, so content that does not fit is clipped rather than wrapped;
//   - a CONTAINER QUERY on the strip itself, so below {@link STRIP_PARAMS_MIN} the whole
//     param group hides at once and the strip degrades to exactly `name + ⋯`.
// `StripOverflow` is what makes that degradation safe: it holds the effect's whole option
// list, of which the strip renders a prefix (see `tool-params.tsx` — ONE list, two
// renderings).
//
// THREE ARMED STATES, three shapes. The brush family gets params; the cell-select family
// gets its mode name and the one static fact that bounds it; the pointer gets a READOUT of
// what is selected, because direct manipulation's parameter is the selection itself.
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { ViewportGesture } from "../../../viewport-host/index.ts"; // type-only: erased
import { useCatalog } from "../../hooks/useCatalogs.tsx";
import {
	useFieldEntities,
	useFieldEntitySelection,
	useFieldTool,
} from "../../hooks/useFieldHostState.tsx";
import { entityName } from "../../lib/actions.ts";
import { useEditor } from "../editor-context.ts";
import { StripOverflow } from "./StripOverflow.tsx";
import type { ParamContext } from "./tool-params.tsx";
import { availableParams, Param, TOOL_OPTIONS } from "./tool-params.tsx";

/**
 * Below this container width the strip drops its params and shows `name + ⋯` (D-6's
 * degraded state).
 *
 * A COMPUTED figure, not a measurement — no browser was driven for it. It is the sum of
 * the declared widths in `tool-params.tsx` for the widest param set the strip can carry
 * (fill), at a two-class catalog, rounded UP so the params leave just BEFORE they clip:
 *
 *   name `w-28` 112 · gap 12 · radius ~173 (label + `w-20` + `w-11`) · gap 12
 *   · mask ~143 (label + `w-28`) · gap 12 · material ~77 (label + two `w-6` swatches)
 *   · gap 12 · hollow ~119 (box + label + `w-14`) · gap 12 · ⋯ `w-7` 28  =  ~712 px
 *
 * ~712 px is 44.5 rem, and the five text labels in it are ESTIMATES at the `text-xs`
 * step — worth about a rem of uncertainty between them — so the constant is the next
 * whole rem above the top of that band rather than above its midpoint. A reader checks
 * the fixed half by adding up the `w-*` classes in `tool-params.tsx`.
 *
 * TWO stated limits. A catalog with many classes widens the swatch row past this sum (it
 * is the one param whose width is project data, not a declared class). And the query has
 * NOT been observed firing in a browser — what IS verified is that it COMPILES: the
 * frontend bundle emits `@container strip (width<46rem){…{display:none}}`. Both limits
 * degrade the same safe way: the strip clips instead of wrapping, and the ⋯ still holds
 * every control.
 */
const STRIP_PARAMS_MIN = "@max-[46rem]/strip:hidden";

/** The host's flood budget (SELECTION_UI_BUDGET), restated: the chrome cannot value-import
 *  the host, so the two agree by review. It is what `SelectionInfo.truncated` reports
 *  hitting — and it bounds the two FLOOD gestures only. */
const FLOOD_BUDGET_LABEL = "budget 200k";

/** What the strip calls each cell-selection gesture, and the one static fact that bounds
 *  it. The two FLOOD modes are budgeted; a box span is snapped instead — `truncated` is
 *  "always false for regions" (field-host.ts), so a budget note on Box would name a limit
 *  that cannot fire, which is the dead-control defect in prose form. */
const SELECT_MODES: Record<
	"box" | "material" | "void",
	{ name: string; note: string }
> = {
	box: { name: "BOX", note: "snaps to 0.5 m" },
	material: { name: "WAND", note: FLOOD_BUDGET_LABEL },
	void: { name: "ROOM", note: FLOOD_BUDGET_LABEL },
};

export function ToolStrip() {
	const { gesture } = useFieldTool();
	if (gesture === "pointer") return <PointerStrip />;
	if (gesture === "box" || gesture === "material" || gesture === "void")
		return <CellSelectStrip mode={gesture} />;
	return <BrushStrip gesture={gesture} />;
}

/** The strip's shell: name, the degrading param group, and whatever holds the rest. ONE
 *  component so the three branches cannot drift on the geometry the capacity rule depends
 *  on. */
function StripFrame({
	name,
	suffix,
	params,
	overflow,
}: {
	name: string;
	/** A muted qualifier beside the name (the armed effect under `segment`). */
	suffix?: string;
	params: ReactNode;
	/** The ⋯, or nothing when the armed thing HAS no options — a popover that opens onto
	 *  an empty box is a dead control, and neither the pointer nor a cell-select gesture
	 *  has a single knob to put in one. */
	overflow?: ReactNode;
}) {
	return (
		// `role="toolbar"` is the ARIA pattern for a strip of controls; HTML has no element
		// for it, and biome does not flag it (no suppression needed here, unlike the
		// `role="group"` below).
		<div
			role="toolbar"
			aria-label="tool options"
			className="@container/strip flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
		>
			<span className="flex w-28 shrink-0 items-center gap-1.5 overflow-hidden">
				<span className="font-semibold text-xs tracking-wide">{name}</span>
				{suffix !== undefined && (
					<span className="truncate text-[10px] text-muted-foreground">
						{suffix}
					</span>
				)}
			</span>
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for the param row; a <fieldset>/<legend> would force a boxed look into a 40 px bar */}
			<div
				role="group"
				aria-label="tool params"
				className={`${STRIP_PARAMS_MIN} flex min-w-0 items-center gap-3 text-muted-foreground text-xs`}
			>
				{params}
			</div>
			{overflow}
		</div>
	);
}

/** Under the pointer the strip has no knobs — direct manipulation's parameter IS the
 *  selection. So it reports what is selected instead, and `—` is the empty answer.
 *
 *  That em dash is a READOUT, not a disabled control: every pointer verb (`G` grab, `F`
 *  frame, `⌫` delete, `⌘J` duplicate) acts on this and refuses when it is empty, and this
 *  line is the only place on screen that says which object they mean. It is named through
 *  the registry's own `entityName`, so the strip, the palette rows and the menu labels
 *  cannot come to call one object three things. */
function PointerStrip() {
	const { selectedEntityId } = useFieldEntitySelection();
	const { entities } = useFieldEntities();
	const selected =
		selectedEntityId === null
			? null
			: (entities.find((e) => e.entityId === selectedEntityId) ?? null);
	return (
		<StripFrame
			name="SELECT"
			params={
				<span className="flex items-center gap-1.5">
					<span>selection</span>
					<span className="font-mono text-foreground">
						{selected === null ? "—" : entityName(selected)}
					</span>
				</span>
			}
		/>
	);
}

function CellSelectStrip({ mode }: { mode: "box" | "material" | "void" }) {
	const { name, note } = SELECT_MODES[mode];
	return <StripFrame name={name} params={<span>{note}</span>} />;
}

function BrushStrip({ gesture }: { gesture: ViewportGesture | null }) {
	const { tool, radius, setTool, setRadius } = useFieldTool();
	const { table } = useCatalog();
	const smoothLimits = useSmoothLimits();
	const effect = tool.effect;

	const ctx: ParamContext = {
		tool,
		radius,
		setTool,
		setRadius,
		classes: table.classes,
		smoothLimits,
	};
	const available = availableParams(effect, table.classes);
	const onStrip = available.slice(0, TOOL_OPTIONS[effect].onStrip);

	return (
		<StripFrame
			// Under `segment` the NAME says what LMB does and the suffix says what it
			// commits with: a segment click builds a brush op from the armed effect and
			// material (host `segmentClick` → `commitToolOp` → the same `toolOp` a stroke
			// uses), which is also why its params are the effect's own rather than a fixed
			// segment set.
			name={gesture === "segment" ? "SEGMENT" : effect.toUpperCase()}
			suffix={gesture === "segment" ? effect : undefined}
			params={onStrip.map((id) => <Param key={id} id={id} ctx={ctx} />)}
			overflow={<StripOverflow effect={effect} params={available} ctx={ctx} />}
		/>
	);
}

/** Core's smooth ceilings, read off the host at engine-ready. NOT a subscribe seam — a
 *  plain getter over two constants — so reading it here claims no single-slot callback
 *  (the rule `useFieldHostState` exists to hold). */
function useSmoothLimits(): { maxStrength: number; maxIterations: number } {
	const { state, fieldHostRef } = useEditor();
	const [limits, setLimits] = useState({ maxStrength: 1, maxIterations: 1 });
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		setLimits(host.getSmoothLimits());
	}, [state.status, fieldHostRef]);
	return limits;
}
