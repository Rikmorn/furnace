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
import { cn } from "../../lib/cn.ts";
import { useEditor } from "../editor-context.ts";
import { StripOverflow } from "./StripOverflow.tsx";
import type { BrushEffect, ParamContext } from "./tool-params.tsx";
import { availableParams, Param, TOOL_OPTIONS } from "./tool-params.tsx";

/**
 * Below its own threshold a branch drops its params and shows `name + ⋯` (D-6's degraded
 * state). PER BRANCH, not one worst case: a single fill-sized threshold blanked dig — two
 * params — at a width where both still fitted comfortably, which is a strip degrading for
 * a reason that is not about it.
 *
 * COMPUTED figures, not measurements — no browser was driven for them. Each is the sum of
 * the declared widths in `tool-params.tsx` for that effect's strip set, plus the fixed
 * frame (name `w-28` 112 + ⋯ `w-7` 28 + 2 gaps 24 = 164), rounded UP past the ~1 rem of
 * uncertainty the five estimated `text-xs` labels carry between them:
 *
 *   dig     164 + radius ~173 + gap 12 + mask ~143                       = ~492 px → 32rem
 *   paint   164 + …          + gap 12 + material ~77                     = ~581 px → 38rem
 *   smooth  164 + radius + strength ~147 + mode ~132 + 2 gaps            = ~640 px → 41rem
 *   fill    164 + radius + mask + material + hollow ~119 + 3 gaps        = ~712 px → 46rem
 *
 * A reader checks the fixed half by adding up the `w-*` classes in `tool-params.tsx`.
 *
 * TWO stated limits. A catalog with many classes widens the swatch row past these sums (it
 * is the one param whose width is project data, not a declared class). And the queries have
 * NOT been observed firing in a browser — what IS verified is that they COMPILE: the
 * frontend bundle emits an `@container strip (width<Nrem){…{display:none}}` rule for each.
 * Both limits degrade the same safe way: the strip clips instead of wrapping, and the ⋯
 * still holds every control.
 *
 * The two NON-brush branches have no entry, deliberately. Their whole content is one short
 * span (a selection name, a budget note) which cannot overflow a strip sized for a
 * four-param fill set — so there is nothing to degrade, and consequently nothing for a ⋯
 * to hold. That is D-6 satisfied rather than skipped: the rule is "content stays reachable
 * under width pressure", and content that never hides is never unreachable.
 */
const STRIP_PARAMS_MIN: Record<BrushEffect, string> = {
	dig: "@max-[32rem]/strip:hidden",
	fill: "@max-[46rem]/strip:hidden",
	paint: "@max-[38rem]/strip:hidden",
	smooth: "@max-[41rem]/strip:hidden",
};

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
	hideParamsBelow,
	overflow,
}: {
	name: string;
	/** A muted qualifier beside the name (the armed effect under `segment`). */
	suffix?: string;
	params: ReactNode;
	/** The container-query class that hides the param group under width pressure, or
	 *  nothing for a branch whose content cannot overflow (see {@link STRIP_PARAMS_MIN}). */
	hideParamsBelow?: string;
	/** The ⋯, or nothing when the armed thing HAS no options — a popover that opens onto
	 *  an empty box is a dead control, and neither the pointer nor a cell-select gesture
	 *  has a single knob to put in one. */
	overflow?: ReactNode;
}) {
	return (
		// `role="group"`, NOT `role="toolbar"`: the APG toolbar pattern commits to a single
		// tab stop with arrow-key navigation between controls, which is right for the rail
		// (a mode selector) and wrong here — these are labelled form controls where Tab
		// between them is what a user expects and what the platform already does. Declaring
		// `toolbar` would tell a screen reader to expect arrows that nothing implements.
		// biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control set; a <fieldset>/<legend> would force a boxed look into a 40 px bar
		<div
			role="group"
			aria-label="tool options"
			className="@container/strip flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
		>
			<span className="flex w-28 shrink-0 items-center gap-1.5 overflow-hidden">
				<span className="font-semibold text-xs tracking-wide">{name}</span>
				{suffix !== undefined && (
					<span className="truncate text-2xs text-muted-foreground">
						{suffix}
					</span>
				)}
			</span>
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for the param row; a <fieldset>/<legend> would force a boxed look into a 40 px bar */}
			<div
				role="group"
				aria-label="tool params"
				className={cn(
					"flex min-w-0 items-center gap-3 text-muted-foreground text-xs",
					hideParamsBelow,
				)}
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
			hideParamsBelow={STRIP_PARAMS_MIN[effect]}
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
