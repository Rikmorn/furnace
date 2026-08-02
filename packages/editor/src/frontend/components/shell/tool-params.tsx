// The brush's option set: which params each effect HAS, and how each one renders.
//
// It lives in its own module because two surfaces render from it — the top strip
// (`ToolStrip`) and the ⋯ popover (`StripOverflow`) — and the whole capacity rule (D-6)
// rests on those two being ONE list rather than two that agree. The strip renders a
// prefix; the popover renders the whole thing.
//
// The controls are the ones `BrushInspector` and the panel's swatch strip had, with the
// same accessible names, resized for a 40 px bar. The hollow toggle is the house checkbox
// (D-24). The three SELECTS here stay native, and that is now a measured exemption rather
// than a deferral: F4.5c Task 12 drove a Radix `ui/select.tsx` from this harness with a
// live session standing and Esc reached the cancel ladder anyway — the app-level key gate
// recognises an `HTMLSelectElement` and cannot recognise a `<button>`. The evidence and the
// allowlist that encodes it are in `field/form-bits.tsx` and
// `scripts/one-control-library.grit`.
//
// The hollow THICKNESS field is the exception, and it is a correction rather than a
// carry-over: the first cut of this file hand-copied it into a raw `<input type="number">`
// and lost the house focus ring with it. It is `<Input>` again — the shadcn primitive
// `BrushInspector` used — so the raw-control count this move adds is zero, not one.
import type { MaterialTable } from "@furnace/core/field"; // type-only: erased
import { type ReactNode, useId, useRef, useState } from "react";
import type {
	FieldMaskChoice,
	FieldTool,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { cn } from "../../lib/cn.ts";
import { SELECT_CLASS } from "../field/form-bits.tsx";
import { MaterialSwatches } from "../field/MaterialSwatches.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Input } from "../ui/input.tsx";

// Mirror FieldHost's radius clamp range (RADIUS_MIN/MAX) — the chrome cannot import the
// host's value constants (type-only barrel).
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 4;
const RADIUS_STEP = 0.05;

// Fill-only shell-band floor/step (metres) — mirrors the host's HOLLOW_MIN_M clamp and
// the 0.5 m kit lattice. The input does not re-clamp typed values (the host is the
// enforcement point); min/step keep the native steppers on valid values.
const HOLLOW_MIN_M = 0.5;
const HOLLOW_STEP_M = 0.5;
const HOLLOW_DEFAULT_M = 0.5;

const LABEL_CLASS = "flex items-center gap-1.5 whitespace-nowrap";
const STRIP_SELECT_CLASS = "h-7 text-xs";

/** Hand focus back to the document after a `<select>` settles on a value.
 *
 *  A native select KEEPS focus after a choice, and the app-level key gate refuses every
 *  `typed` action while a select has focus (that refusal is correct and load-bearing —
 *  without it Esc on an open dropdown discards the session behind it). The consequence
 *  used to be mild: the mask select lived in a palette the user closed. It is not mild in
 *  a strip that is always on screen and sits between the user and the canvas — every bare
 *  tool key would be dead until they clicked elsewhere, with nothing saying why.
 *
 *  Blurring rather than re-focusing the canvas: the canvas is the host's, this module
 *  cannot reach it, and `document.body` is where the window listener wants the target
 *  anyway. */
const releaseAfterChange = (e: { currentTarget: HTMLSelectElement }): void =>
	e.currentTarget.blur();

export type BrushEffect = FieldTool["effect"];

export type ParamId =
	| "radius"
	| "mask"
	| "material"
	| "hollow"
	| "strength"
	| "iterations"
	| "mode";

/**
 * Per effect: the WHOLE option list in priority order, and how many of them the strip
 * carries (D-6's ≤4 cap). The ⋯ renders `all`; the strip renders its first `onStrip`.
 *
 * ONE table, deliberately — this is the single-source-of-truth point the whole capacity
 * rule leans on. A second list beside the popover is exactly how "the ⋯ holds everything
 * the strip shows plus the rest" would quietly stop being true.
 *
 * The per-effect membership is the DEAD-CONTROL FIX: `FieldTool`'s own doc says
 * `materialId` is "ignored by dig and smooth", so the swatches appear under paint and fill
 * and nowhere else. The panel this replaces showed them permanently, under every tool.
 */
export const TOOL_OPTIONS: Record<
	BrushEffect,
	{ all: readonly ParamId[]; onStrip: number }
> = {
	// Dig writes air: no class, no shell band. Its full set and its strip set are the same
	// two, so its ⋯ is a reachability guarantee rather than a drawer.
	dig: { all: ["radius", "mask"], onStrip: 2 },
	fill: { all: ["radius", "mask", "material", "hollow"], onStrip: 4 },
	paint: { all: ["radius", "mask", "material"], onStrip: 3 },
	// The only effect whose list is longer than its strip: iterations and the mask are the
	// two a user sets once and leaves, so they live behind the ⋯.
	smooth: {
		all: ["radius", "strength", "mode", "iterations", "mask"],
		onStrip: 3,
	},
};

/** Everything a param renderer reads or writes. Assembled once by the strip and handed to
 *  both renderings, so the popover's controls drive the same funnels the strip's do. */
export type ParamContext = {
	tool: FieldTool;
	radius: number;
	setTool: (next: FieldTool) => void;
	setRadius: (r: number) => void;
	classes: MaterialTable["classes"];
	smoothLimits: { maxStrength: number; maxIterations: number };
};

/** The params an effect can actually SHOW right now — `TOOL_OPTIONS[effect].all` minus the
 *  ones the project cannot fill. Filtering happens before the strip slices, so a material
 *  param a one-class catalog cannot fill never eats one of the strip's four slots and
 *  leaves a real control stranded behind the ⋯. */
export function availableParams(
	effect: BrushEffect,
	classes: MaterialTable["classes"],
): readonly ParamId[] {
	return TOOL_OPTIONS[effect].all.filter((id) =>
		id === "material" ? classes.length > 1 : true,
	);
}

/** One param, wherever it is rendered. */
export function Param({ id, ctx }: { id: ParamId; ctx: ParamContext }) {
	return PARAM_RENDERER[id](ctx);
}

/** Encode a mask choice as the `<select>` value (`class:<id>` for classes). */
const maskValue = (m: FieldMaskChoice): string =>
	m.kind === "class" ? `class:${m.classId}` : m.kind;

/** Decode a `<select>` value back to a mask choice. Values come from our own option set,
 *  so anything unrecognised (impossible) falls back to none. */
const parseMask = (v: string): FieldMaskChoice => {
	if (v.startsWith("class:"))
		return { kind: "class", classId: Number(v.slice("class:".length)) };
	if (v === "organic-only" || v === "kit-only" || v === "selection")
		return { kind: v };
	return { kind: "none" };
};

const parseSmoothMode = (v: string): FieldTool["smooth"]["mode"] =>
	v === "erode" || v === "fill" ? v : "both";

/**
 * The fill brush's shell-band thickness, with a BUFFERED parse (D-25).
 *
 * THE DEFECT THIS CLOSES, and it was live at every keystroke: the field parsed straight
 * through with `Number.isFinite` as its only guard — and `Number("") === 0`, which is
 * finite. So selecting the text and pressing ⌫ (the ordinary way to retype a number)
 * pushed `hollow: 0` at the host, the very shape the inspector's own `NumberField` was
 * given a text buffer to prevent. It survived here because this control was hand-copied
 * out of `BrushInspector` rather than reused.
 *
 * The buffer holds the user's TEXT; nothing reaches `setTool` until it parses to a finite
 * number, and a blur on an empty or unparseable entry reverts to the live value rather
 * than committing anything. The sub-floor clamp stays on blur for its original reason (a
 * mid-typing clamp fights entering "0.75").
 */
function HollowThickness({
	thickness,
	ctx,
}: {
	thickness: number;
	ctx: ParamContext;
}) {
	const settled = String(thickness);
	const [text, setText] = useState(settled);
	const focused = useRef(false);
	// Re-seed from the tool only while the user is not typing — the host clamps and pushes
	// back, and that echo must not land in the middle of an edit.
	if (!focused.current && text !== settled) setText(settled);

	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the label wraps its control as children (the shadcn Input); Biome cannot trace the native control across the component boundary — getByLabelText still resolves it
		<label className={LABEL_CLASS}>
			thickness
			<Input
				type="number"
				min={HOLLOW_MIN_M}
				step={HOLLOW_STEP_M}
				value={text}
				onFocus={() => {
					focused.current = true;
				}}
				onChange={(e) => {
					setText(e.target.value);
					const n = Number(e.target.value);
					// Blank is MID-EDIT, not zero. `Number("")` is 0 and 0 is finite, so the
					// emptiness has to be tested BEFORE the parse or the guard cannot see it.
					if (e.target.value.trim() === "" || !Number.isFinite(n)) return;
					ctx.setTool({ ...ctx.tool, hollow: n });
				}}
				onBlur={() => {
					focused.current = false;
					const n = Number(text);
					if (text.trim() === "" || !Number.isFinite(n)) {
						setText(settled);
						return;
					}
					// Display honesty (F2b rider): the HOST clamps hollow to ≥ HOLLOW_MIN_M on
					// setTool, so a settled sub-floor value here would display 0.2 while strokes
					// carve 0.5. Clamp on BLUR, not per keystroke — a mid-typing clamp would
					// fight entering "0.75".
					if (n < HOLLOW_MIN_M)
						ctx.setTool({ ...ctx.tool, hollow: HOLLOW_MIN_M });
				}}
				aria-label="hollow thickness"
				className="h-7 w-14 px-1.5 font-mono text-xs"
			/>
			{/* D-25: units always. The radius param one place over prints its ` m`, and a
			    bare number beside it reads as a different kind of quantity. */}
			m
		</label>
	);
}

/**
 * The fill brush's shell-band switch: on turns the solid fill into a band of
 * {@link HOLLOW_DEFAULT_M}, off returns it to solid.
 *
 * A COMPONENT rather than an inline renderer, and that is `useId`'s doing. The house
 * checkbox (D-24) is a `<button>`, so the row's `<label>` reaches it by `htmlFor` rather
 * than by wrapping it — and the id must be per-MOUNT, because the ⋯ renders the whole
 * option list including the ones the strip is already showing, so a param can be on screen
 * twice and a module-scope constant would put both controls on one id. (Fill's list happens
 * to fit its strip today, so hollow is not one of the doubled ones — a fact about
 * {@link TOOL_OPTIONS} rather than a property to build on.)
 *
 * It cannot be a hook inside {@link PARAM_RENDERER}: those entries are plain functions
 * called conditionally per param, so a hook in one would change hook ORDER as the armed
 * effect changes.
 */
function HollowToggle({ ctx }: { ctx: ParamContext }) {
	const id = useId();
	return (
		<label className={LABEL_CLASS} htmlFor={id}>
			<Checkbox
				id={id}
				checked={ctx.tool.hollow !== null}
				onCheckedChange={(c) =>
					ctx.setTool({
						...ctx.tool,
						hollow: c === true ? HOLLOW_DEFAULT_M : null,
					})
				}
				aria-label="hollow fill"
			/>
			hollow
		</label>
	);
}

/** A `Record` rather than a switch, so a param added to {@link TOOL_OPTIONS} without a
 *  renderer is a type error rather than a blank space on the strip. */
const PARAM_RENDERER: Record<ParamId, (ctx: ParamContext) => ReactNode> = {
	radius: (ctx) => (
		<label className={LABEL_CLASS}>
			radius
			<input
				type="range"
				min={RADIUS_MIN}
				max={RADIUS_MAX}
				step={RADIUS_STEP}
				value={ctx.radius}
				onChange={(e) => ctx.setRadius(Number(e.target.value))}
				// The accessible name contains the visible "radius" text (the label-in-name
				// rule) — voice-control users say what they see.
				aria-label="brush radius"
				className="w-20"
			/>
			<span className="w-11 text-right font-mono text-foreground tabular-nums">
				{ctx.radius.toFixed(2)} m
			</span>
		</label>
	),
	mask: (ctx) => (
		<label className={LABEL_CLASS}>
			mask
			<select
				value={maskValue(ctx.tool.mask)}
				onChange={(e) => {
					ctx.setTool({ ...ctx.tool, mask: parseMask(e.target.value) });
					releaseAfterChange(e);
				}}
				aria-label="brush mask"
				className={cn(SELECT_CLASS, STRIP_SELECT_CLASS, "w-28")}
			>
				<option value="none">None</option>
				<option value="organic-only">Organic only</option>
				<option value="kit-only">Kit only</option>
				<option value="selection">Inside selection</option>
				{ctx.classes.map((c) => (
					<option key={c.id} value={`class:${c.id}`}>
						Only {c.name}
					</option>
				))}
			</select>
		</label>
	),
	material: (ctx) => (
		<span className={LABEL_CLASS}>
			mat
			<MaterialSwatches
				classes={ctx.classes}
				activeId={ctx.tool.materialId}
				disableKit={ctx.tool.effect === "paint"}
				onSelect={(id) => ctx.setTool({ ...ctx.tool, materialId: id })}
			/>
		</span>
	),
	hollow: (ctx) => (
		<span className={LABEL_CLASS}>
			<HollowToggle ctx={ctx} />
			{ctx.tool.hollow !== null && (
				<HollowThickness thickness={ctx.tool.hollow} ctx={ctx} />
			)}
		</span>
	),
	strength: (ctx) => (
		<label className={LABEL_CLASS}>
			strength
			<input
				type="range"
				min={1}
				max={ctx.smoothLimits.maxStrength}
				step={1}
				value={ctx.tool.smooth.strength}
				onChange={(e) =>
					ctx.setTool({
						...ctx.tool,
						smooth: { ...ctx.tool.smooth, strength: Number(e.target.value) },
					})
				}
				aria-label="smooth strength"
				className="w-16"
			/>
			<span className="w-6 text-right font-mono text-foreground tabular-nums">
				{ctx.tool.smooth.strength}
			</span>
		</label>
	),
	iterations: (ctx) => (
		<label className={LABEL_CLASS}>
			iters
			<select
				value={ctx.tool.smooth.iterations}
				onChange={(e) => {
					ctx.setTool({
						...ctx.tool,
						smooth: { ...ctx.tool.smooth, iterations: Number(e.target.value) },
					});
					releaseAfterChange(e);
				}}
				aria-label="smooth iterations"
				className={cn(SELECT_CLASS, STRIP_SELECT_CLASS, "w-16")}
			>
				{Array.from({ length: ctx.smoothLimits.maxIterations }, (_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static 1..N option list, never reordered — the index is the stable identity
					<option key={i + 1} value={i + 1}>
						{i + 1}
					</option>
				))}
			</select>
		</label>
	),
	mode: (ctx) => (
		<label className={LABEL_CLASS}>
			mode
			<select
				value={ctx.tool.smooth.mode}
				onChange={(e) => {
					ctx.setTool({
						...ctx.tool,
						smooth: {
							...ctx.tool.smooth,
							mode: parseSmoothMode(e.target.value),
						},
					});
					releaseAfterChange(e);
				}}
				aria-label="smooth mode"
				className={cn(SELECT_CLASS, STRIP_SELECT_CLASS, "w-24")}
			>
				<option value="both">Both</option>
				<option value="erode">Erode only</option>
				<option value="fill">Fill only</option>
			</select>
		</label>
	),
};
