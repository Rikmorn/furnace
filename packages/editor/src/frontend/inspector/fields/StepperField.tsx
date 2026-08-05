// D-25's small-integer control: − [exact] + over a range a handful of notches wide.
//
// Why it is not just a short slider: `cave.chambers` spans 2..6, so a 120 px track gives
// each of its four intervals ~30 px and the difference between 3 and 4 chambers is a
// pointer twitch. The ± buttons make each notch a discrete act, which is what a count IS
// — and the exact input beside them keeps typing available, so the stepper never becomes
// the slow route to 8.
//
// Each button reads the COMMITTED value, never an internal draft. The host publishes a
// session synchronously (`updateStamp` → `notifyStamp`), so two presses in a row see 3 → 4
// → 5; a stepper that stepped its own remembered number would drift the moment anything
// else moved the value (an undo, a re-seed, an SSE change).

import { Button } from "../../components/ui/button.tsx";
import { humanizeLabel } from "../../lib/humanize.ts";
import {
	type NumericSchema,
	numericSchema,
	snapToStep,
} from "../lib/numeric-schema.ts";
import type { FieldProps } from "../types.ts";
import { ExactNumberInput, FieldGroupRow, UnitSuffix } from "./common.tsx";
import { NumberField } from "./NumberField.tsx";

/** 24 px square, matching the card's compact d-pad rather than its 32 px verb row: six of
 *  these in a params list read as chrome, not as six peers of the commit button. */
const STEP_BUTTON_CLASS = "h-6 w-6 shrink-0 p-0 font-mono text-sm leading-none";

export function StepperField(props: FieldProps) {
	const bounds = numericSchema(props.schema);
	// Unreachable through the registry (`resolveKind` only answers "stepper" when this
	// parses), but the component is exported and directly renderable, so it stays total.
	if (bounds === null) return <NumberField {...props} />;
	return <BoundedStepper {...props} bounds={bounds} />;
}

function BoundedStepper({
	schema,
	value,
	onPreview,
	onCommit,
	onCancel,
	path,
	bounds,
}: FieldProps & { bounds: NumericSchema }) {
	const label = humanizeLabel(path.split(".").at(-1) ?? path);
	const def = typeof schema.default === "number" ? schema.default : bounds.min;
	const current = Number((value as number) ?? def);

	const commit = (raw: number) => onCommit(snapToStep(bounds, raw));

	return (
		<FieldGroupRow path={path}>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				className={STEP_BUTTON_CLASS}
				// The name says what it does to WHICH field: a params list is a column of
				// identical ± pairs, and "decrease" alone names six controls.
				aria-label={`decrease ${label}`}
				disabled={current <= bounds.min}
				onClick={() => commit(current - bounds.step)}
			>
				−
			</Button>
			{/* RAW, unlike the ± beside it: a gesture is quantized by construction, but a
			    TYPED value is a statement, and rewriting 8.5 into 8 would leave the user
			    reading a number they did not type. Out of range is the field-level
			    refusal's job (SchemaForm), not this control's. */}
			<ExactNumberInput
				value={current}
				label={label}
				className="w-12"
				onPreview={onPreview}
				onCommit={onCommit}
				onCancel={onCancel}
			/>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				className={STEP_BUTTON_CLASS}
				aria-label={`increase ${label}`}
				disabled={current >= bounds.max}
				onClick={() => commit(current + bounds.step)}
			>
				+
			</Button>
			<UnitSuffix unit={schema.furnace?.unit} />
		</FieldGroupRow>
	);
}
