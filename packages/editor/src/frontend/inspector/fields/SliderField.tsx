// D-25's bounded numeric: a range you drag, a label you scrub, and a text field you type
// an exact value into — three affordances over ONE value, which is the CAD/DCC vocabulary
// the charter asked for rather than three ways to disagree.
//
// EVERY GESTURE ROUTES THROUGH `snapToStep`. That is not tidiness: `@furnace/core`'s
// generators validate their params setup-loud from inside the preview worker, so a value
// off the schema's notch grid comes back as a thrown string one round trip later with the
// control still showing what the user did. The range gets `min`/`max`/`step` from the same
// function, so its own quantization and the scrub's cannot drift.
//
// THE SCRUB AND THE CANVAS. This palette floats over a WebGPU canvas that orbits on
// pointermove, and the two are DOM siblings — so a scrub that let go of the pointer would
// hand the rest of the drag to the viewport. `setPointerCapture` on the label is what
// prevents that: every subsequent pointer event for that id retargets to the label
// regardless of where the cursor is, so leaving the palette mid-scrub keeps scrubbing and
// the release lands here whatever is underneath. `pointercancel` gets its OWN handler and
// deliberately does NOT commit — a cancel is the gesture being taken away, not finished, and
// aliasing it to the release handler is how Task 5 nearly shipped a cancel that committed.

import { useRef } from "react";
import { humanizeLabel } from "../../lib/humanize.ts";
import { roundForDisplay } from "../lib/format.ts";
import { isMixed } from "../lib/mixed.ts";
import {
	type NumericSchema,
	numericSchema,
	snapToStep,
} from "../lib/numeric-schema.ts";
import { scrubValue } from "../lib/scrub.ts";
import type { FieldProps } from "../types.ts";
import { ExactNumberInput, FieldRow, UnitSuffix } from "./common.tsx";
import { NumberField } from "./NumberField.tsx";

/** Pixels of horizontal drag that traverse the WHOLE range. Sensitivity is derived from
 *  the span rather than fixed, so a [0,1] blend and a [4,32] depth both cross in one
 *  comfortable drag — a fixed units-per-pixel would make one of them unusable. */
const SCRUB_TRAVEL_PX = 200;

export function SliderField(props: FieldProps) {
	const bounds = numericSchema(props.schema);
	// Unreachable through the registry (`resolveKind` only answers "slider" when this
	// parses), but the component is exported and directly renderable, so it stays total.
	if (bounds === null) return <NumberField {...props} />;
	return <BoundedSlider {...props} bounds={bounds} />;
}

function BoundedSlider({
	schema,
	values,
	onPreview,
	onCommit,
	onCancel,
	path,
	bounds,
}: FieldProps & { bounds: NumericSchema }) {
	const mixed = isMixed(values);
	const label = humanizeLabel(path.split(".").at(-1) ?? path);
	const def = typeof schema.default === "number" ? schema.default : bounds.min;
	const current = mixed ? def : Number((values[0] as number) ?? def);

	// The last value PREVIEWED and not yet committed. A ref rather than a read of the
	// incoming prop, because the release has to commit what the drag produced: the prop
	// arrives back through the host, and a gesture that ended before the round trip (or a
	// consumer that refuses the draft) would otherwise commit the pre-drag value.
	const pending = useRef<number | null>(null);
	const fanout = (n: number) => values.map(() => n);
	const push = (raw: number, commit: boolean) => {
		const next = snapToStep(bounds, raw);
		pending.current = commit ? null : next;
		(commit ? onCommit : onPreview)(fanout(next));
	};

	// One commit per gesture, not one per pixel. Bound to release AND to keyup — a range
	// driven by the arrow keys fires `change` and never a `pointerup`, so a pointer-only
	// settle would preview the whole keyboard interaction and commit none of it.
	const settle = () => {
		const next = pending.current;
		if (next === null) return;
		pending.current = null;
		onCommit(fanout(next));
	};

	const scrub = useRef<{ startX: number; startVal: number } | null>(null);
	const scrubTo = (e: React.PointerEvent<HTMLSpanElement>, commit: boolean) => {
		const from = scrub.current;
		if (!from) return;
		push(
			scrubValue(
				from.startVal,
				e.clientX - from.startX,
				(bounds.max - bounds.min) / SCRUB_TRAVEL_PX,
				e.shiftKey,
			),
			commit,
		);
	};

	return (
		<FieldRow
			path={path}
			labelPointerProps={{
				onPointerDown: (e) => {
					scrub.current = { startX: e.clientX, startVal: current };
					e.currentTarget.setPointerCapture(e.pointerId);
				},
				onPointerMove: (e) => scrubTo(e, false),
				onPointerUp: (e) => {
					// Only when the drag actually moved the value. A CLICK on the label is a
					// press and a release with dx 0, and committing there costs a session
					// update, a worker preview round trip and an undo entry for nothing — the
					// same no-op-commit the numeric blur path routes through `commitIfChanged`
					// to avoid.
					if (pending.current !== null) scrubTo(e, true);
					scrub.current = null;
					e.currentTarget.releasePointerCapture(e.pointerId);
				},
				onPointerCancel: (e) => {
					// A cancel is NOT a commit: the gesture was taken away, so the last preview
					// is what the ghost shows and the committed value is whatever it was.
					scrub.current = null;
					e.currentTarget.releasePointerCapture(e.pointerId);
				},
			}}
		>
			<input
				type="range"
				min={bounds.min}
				max={bounds.max}
				step={bounds.step}
				value={roundForDisplay(current)}
				aria-label={label}
				className="h-4 w-20 shrink-0 accent-primary"
				onChange={(e) => push(Number(e.target.value), false)}
				onPointerUp={settle}
				onKeyUp={settle}
				onBlur={settle}
			/>
			{/* The exact input passes its number through RAW — no snap, no clamp — and that
			    asymmetry with the two gestures beside it is the point. A gesture is
			    quantized by construction, so snapping is the only way it can behave; a
			    TYPED value is a statement, and silently rewriting 2 into 3 (or 8.5 into 8)
			    would leave the user reading a number they did not type with nothing saying
			    why. Out of range is what the field-level refusal is FOR. */}
			<ExactNumberInput
				value={current}
				mixed={mixed}
				label={label}
				className="w-14"
				onPreview={(n) => onPreview(fanout(n))}
				onCommit={(n) => onCommit(fanout(n))}
				onCancel={onCancel}
			/>
			<UnitSuffix unit={schema.furnace?.unit} />
		</FieldRow>
	);
}
