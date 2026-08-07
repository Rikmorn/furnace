// The brush's option set: which params each effect HAS, and how each one renders.
//
// It lives in its own module because two surfaces render from it — the top strip
// (`ToolStrip`) and the ⋯ popover (`StripOverflow`) — and the whole capacity rule (D-6)
// rests on those two being ONE list rather than two that agree. The strip renders a
// prefix; the popover renders the whole thing.
//
// The controls are the ones `BrushInspector` and the panel's swatch strip had, with the
// same accessible names, resized for a 40 px bar. The hollow toggle is the house checkbox
// (D-24). The three SELECTS here stay native, and that is a measured exemption rather than
// a deferral: swap one for a Radix `ui/select.tsx` and Esc on it reaches `host.escape()` —
// the cancel ladder — because the app-level key gate recognises an `HTMLSelectElement` and
// cannot recognise the `<button>` a Radix trigger is. Re-measured at the Task 12 review by
// migrating `smooth mode`: `escape` called once, where the native control leaves it at zero.
//
// NOT with a live session standing, which an earlier version of this note claimed: a live
// session swaps this whole strip for the session strip, so these three are detached before
// any session exists to discard. The standing that matters here is the ordinary one — a
// selection Esc would clear. The reason is written up in `field/form-bits.tsx`, the
// allowlist that encodes it is `scripts/one-control-library.grit`, and the per-site
// assertion is `tests/chrome/native-select-key-gate.test.tsx`.
//
// The hollow THICKNESS field is the exception, and it is a correction rather than a
// carry-over: the first cut of this file hand-copied it into a raw `<input type="number">`
// and lost the house focus ring with it. It is `<Input>` again — the shadcn primitive
// `BrushInspector` used — so the raw-control count this move adds is zero, not one.
import type { MaterialTable } from "@furnace/core/field"; // type-only: erased
import { type ReactNode, useId, useRef, useState } from "react";
import type { FieldMaskChoice, FieldTool } from "../../../field-host/index.ts"; // type-only: erased
import {
	deriveToolOptions,
	type ParamId,
} from "../../../shared/action-table.ts";
// The three host CLAMPS this file states as its controls' own bounds, read off the neutral
// floor rather than mirrored by review (T3b2 Task 5 moved them; `field-limits.ts`' header
// carries the bar they met). `LATTICE` is the fourth and was already there — the hollow
// STEP is the kit lattice, which is the module that computes with it saying so.
import type { BrushEffect } from "../../../shared/field-brush.ts";
import { LATTICE } from "../../../shared/field-brush.ts";
import {
	HOLLOW_MIN_M,
	RADIUS_MAX,
	RADIUS_MIN,
} from "../../../shared/field-limits.ts";
// The dead-control answer, from the tool that owns the control. A VALUE import of the floor,
// which is what the floor is for — the chrome may not reach under `field-host/` for it, and
// that constraint is what decided where the registry lives (its header carries the argument).
import { toolCanActivate } from "../../../shared/tool-registry.ts";
import { cn } from "../../lib/cn.ts";
import { SELECT_CLASS } from "../field/form-bits.tsx";
import { MaterialSwatches } from "../field/MaterialSwatches.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Input } from "../ui/input.tsx";

/** The radius slider's granularity. NOT a host limit — the host clamps the ENDS and
 *  quantises nothing between them, so this is the strip's own choice about how fine a drag
 *  can be and belongs here rather than on the floor. */
const RADIUS_STEP = 0.05;

/** What the hollow toggle turns the band ON at. It equals {@link HOLLOW_MIN_M} today and is
 *  written separately on purpose: one is the floor the host would clamp to, the other is the
 *  thickness a user gets before touching the field, and a shared spelling would make moving
 *  the floor silently move the default. */
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

/** The seven knobs, re-exported from the table that decides which effect has which.
 *
 *  DECLARED THERE, NOT HERE, since T3b2 Task 5. This file used to spell the union and
 *  `shared/action-table.ts` spelled it again — it had to, because the floor may not import
 *  the chrome, so the two were held equal by a typecheck pin instead. Moving the HOME down
 *  is what removed the second spelling rather than guarding it: the table says which params
 *  exist and which effect reaches them, and this file says how each one draws. */
export type { ParamId };

/**
 * Per effect: the WHOLE option list in priority order, and how many of them the strip
 * carries (D-6's ≤4 cap). The ⋯ renders `all`; the strip renders its first `onStrip`.
 *
 * DERIVED, once, at module scope, from `EFFECT_ROWS`. What that buys is not this table's
 * correctness but the FOUR others keyed on the same discriminator: an effect added to the
 * rows reaches its param list, its strip breakpoint, its status line and its rail member
 * together or not at all.
 *
 * ONE table, deliberately — this is the single-source-of-truth point the whole capacity
 * rule leans on. A second list beside the popover is exactly how "the ⋯ holds everything
 * the strip shows plus the rest" would quietly stop being true.
 *
 * The per-effect membership is HALF the DEAD-CONTROL FIX: `FieldTool`'s own doc says
 * `materialId` is "ignored by dig and smooth", so the swatches appear under paint and fill
 * and nowhere else. The panel this replaces showed them permanently, under every tool.
 *
 * The other half is the PROJECT's half — a param an effect has but this catalog cannot fill
 * — and it is no longer here. It moved to `shared/tool-registry.ts` in foundations T3c,
 * where the tool that owns the control answers for it; {@link availableParams} below is what
 * asks. The split is deliberate and is the same one the registry's own header states: this
 * table says which controls EXIST under which effect, the registry says which of them are
 * LIVE right now.
 */
export const TOOL_OPTIONS = deriveToolOptions();

/** Everything a param renderer reads or writes. Assembled once by the strip and handed to
 *  both renderings, so the popover's controls drive the same funnels the strip's do. */
export type ParamContext = {
	tool: FieldTool;
	radius: number;
	/** A PATCH — name only the field the control owns. Spreading `ctx.tool` back in
	 *  is the bug this shape exists to make unspellable: under a held ⇧/⌃ `ctx.tool`
	 *  is the DERIVED brush, so a whole-tool echo also asserted an `effect` the user
	 *  never picked and the host adopted it as the base. See `FieldHost.setTool`. */
	setTool: (patch: Partial<FieldTool>) => void;
	setRadius: (r: number) => void;
	classes: MaterialTable["classes"];
	smoothLimits: { maxStrength: number; maxIterations: number };
};

/** The params an effect can actually SHOW right now — `TOOL_OPTIONS[effect].all` minus the
 *  ones the project cannot fill. Filtering happens before the strip slices, so a material
 *  param a one-class catalog cannot fill never eats one of the strip's four slots and
 *  leaves a real control stranded behind the ⋯.
 *
 *  THE RULE IS NOT HERE ANY MORE. This file used to spell it (`id === "material" ?
 *  classes.length > 1 : true`) and was therefore the only place in the editor that knew a
 *  control could be dead for a reason the effect table cannot see. Foundations T3c moved it
 *  behind {@link toolCanActivate}, so the tool that owns the control is what answers for it
 *  and a second surface asking the same question gets the same answer by construction rather
 *  than by copying this line. `"brush"` is the id at every call because these ARE the brush's
 *  controls — under `segment` too, whose click commits a brush op from the armed effect. */
export function availableParams(
	effect: BrushEffect,
	classes: MaterialTable["classes"],
): readonly ParamId[] {
	return TOOL_OPTIONS[effect].all.filter((control) =>
		toolCanActivate("brush", { control, classes }),
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
				// The kit lattice IS the step: a shell band is snapped the way the rest of the
				// kit is, so the native steppers walk it rather than a second number that
				// happened to match it.
				step={LATTICE}
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
					ctx.setTool({ hollow: n });
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
					//
					// The BUFFER is corrected HERE rather than left to the re-seed above, and that
					// is load-bearing rather than belt-and-braces: the re-seed only runs on a
					// RENDER, and this corrective set asks for the floor — which, since
					// HOLLOW_DEFAULT_M equals it, is very often a value the host ALREADY holds. A
					// value-guarded seam is entitled to publish nothing for that, so no render
					// arrives and the buffer would sit on the sub-floor text over a 0.5 m band.
					// Waiting for an echo the seam may withhold is not a contract; knowing what we
					// asked for is.
					const committed = Math.max(HOLLOW_MIN_M, n);
					// UNCONDITIONALLY, and above the guard: "0.50" and "0.5000" parse to a value
					// needing no clamp at all, so the guard below returns and the buffer would keep
					// the text as typed rather than the number the tool carries. React bails on an
					// identical string, so normalising every settled entry costs nothing.
					setText(String(committed));
					if (committed === n) return;
					ctx.setTool({ hollow: committed });
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
 * It cannot be a hook inside {@link PARAM_RENDERER}, and the reason is CONSTRUCTION rather
 * than a symptom. {@link Param} calls `PARAM_RENDERER[id](ctx)` directly — a plain function
 * call, not an element — so a hook written in one of those entries runs as part of `Param`'s
 * own render and belongs to `Param`'s fiber. That is a rules-of-hooks violation by shape,
 * and it is invisible to the linter, which sees a `Record` of ordinary functions.
 *
 * It does not currently BITE, and the earlier version of this note claimed it does: "a hook
 * in one would change hook ORDER as the armed effect changes" was measured false at F4.5c
 * Task 12 — a live `useId()` inlined into the `hollow` entry runs `tool-strip.test.tsx` 17/0
 * with no hook-order error. Both render sites key the fiber by param id
 * (`ToolStrip.tsx`, `StripOverflow.tsx`, each `<Param key={id} …/>`), so one `Param` fiber
 * renders exactly one entry for its whole life and the hook count per fiber never moves.
 * The extraction stands on the violation, not on that failure: the keying is a fact about
 * two call sites today, and the day either drops its `key` the direct call is what turns a
 * reconciled fiber into the classic error.
 */
function HollowToggle({ ctx }: { ctx: ParamContext }) {
	const id = useId();
	return (
		<label className={LABEL_CLASS} htmlFor={id}>
			<Checkbox
				id={id}
				checked={ctx.tool.hollow !== null}
				onCheckedChange={(c) =>
					ctx.setTool({ hollow: c === true ? HOLLOW_DEFAULT_M : null })
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
					ctx.setTool({ mask: parseMask(e.target.value) });
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
				onSelect={(id) => ctx.setTool({ materialId: id })}
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
