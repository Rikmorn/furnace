import {
	type PointerEventHandler,
	type ReactNode,
	useRef,
	useState,
} from "react";
import { Input } from "../../components/ui/input.tsx";
import { humanizeLabel } from "../../lib/humanize.ts";
import { commitIfChanged } from "../lib/commit-guard.ts";
import { roundForDisplay } from "../lib/format.ts";

interface LabelPointerProps {
	onPointerDown: PointerEventHandler<HTMLSpanElement>;
	onPointerMove: PointerEventHandler<HTMLSpanElement>;
	onPointerUp: PointerEventHandler<HTMLSpanElement>;
	onPointerCancel: PointerEventHandler<HTMLSpanElement>;
}

const ROW_CLASS = "flex items-center justify-between gap-2 py-0.5";

/** The row's caption, shared by both wrappers. */
function RowCaption({
	path,
	labelPointerProps,
}: {
	path: string;
	labelPointerProps?: LabelPointerProps;
}) {
	const labelSpanCls = [
		"shrink-0 text-xs text-muted-foreground",
		// Scrub affordance: an ew-resize cursor + a subtle dotted hover underline signal the
		// (already-wired) horizontal drag-to-scrub on numeric labels — otherwise invisible.
		labelPointerProps
			? "cursor-ew-resize select-none hover:underline hover:decoration-dotted hover:underline-offset-2"
			: "",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<span className={labelSpanCls} {...labelPointerProps}>
			{humanizeLabel(path.split(".").at(-1) ?? path)}
		</span>
	);
}

export function FieldRow({
	path,
	children,
	labelPointerProps,
}: {
	path: string;
	children: ReactNode;
	labelPointerProps?: LabelPointerProps;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the label wraps its control as children (shadcn Input/Checkbox or passed children); Biome cannot trace the native control across the component boundary — getByLabelText still resolves it
		<label className={ROW_CLASS}>
			<RowCaption path={path} labelPointerProps={labelPointerProps} />
			<span className="flex min-w-0 flex-1 justify-end gap-1">{children}</span>
		</label>
	);
}

/**
 * A field row whose control side is a GROUP rather than one input — a segmented control's
 * radiogroup, a stepper's −/input/+ triple.
 *
 * A plain `<div>`, and the difference is not cosmetic. TWO reasons, both real in a
 * browser:
 *
 * 1. `<label>` labels exactly ONE control, so wrapping three makes every one of them
 *    answer to the row's caption instead of its own — a screen reader reads "Pillars,
 *    Pillars, Pillars" for a segmented control and "Chambers, Chambers" for a stepper's
 *    two buttons.
 * 2. A `<label>` with no `for` labels its FIRST labelable descendant, so clicking the
 *    caption activates it: pressing "Chambers" steps the value down, and pressing
 *    "Pillars" selects member one.
 *
 * A third symptom is a HARNESS artifact and is called out so nobody chases it in a
 * browser: happy-dom dispatches the click TWICE for a button inside a label (one press,
 * two commits). WHATWG says a label's activation behavior for events targeted at
 * interactive content descendants "must be to do nothing", so a spec-compliant browser
 * does not double-fire — but it is what made the defect VISIBLE, via a call-count
 * assertion, and the two reasons above are why the fix is right regardless.
 *
 * Members of a group carry their own `aria-label`s; the caption here is a visible
 * heading, not an association.
 */
export function FieldGroupRow({
	path,
	children,
}: {
	path: string;
	children: ReactNode;
}) {
	return (
		<div className={ROW_CLASS}>
			<RowCaption path={path} />
			<span className="flex min-w-0 flex-1 items-center justify-end gap-1">
				{children}
			</span>
		</div>
	);
}

export const MIXED = "—";

/**
 * A visible per-axis label chip shown before a vector/quaternion component input
 * (x/y/z/w, or the euler-degree labels). Discoverable at a glance rather than hidden
 * in a `title` tooltip. Mono + muted so it reads as a data annotation, not a control.
 */
export function AxisChip({ children }: { children: ReactNode }) {
	return (
		<span
			aria-hidden
			className="shrink-0 select-none font-mono text-2xs leading-none text-muted-foreground"
		>
			{children}
		</span>
	);
}

// Dense-inspector overrides for the shadcn <Input>. The shadcn defaults (h-9,
// text-base/md:text-sm, px-3, bg-transparent, shadow-sm) are sized for standalone
// forms; a property inspector row needs the compact, filled, right-aligned look the
// old raw inputCls had. tailwind-merge resolves each conflicting utility last-wins,
// so we only list the deltas. The focus ring is intentionally NOT set here — <Input>
// already brings the unified focus-visible:ring-ring (--ring), replacing inputCls's
// old focus:ring so there is ONE focus-ring system.
export const denseInputCls =
	"h-auto min-w-0 bg-input px-1 py-0.5 text-right text-xs md:text-xs shadow-none";

// Numeric variant (NumberField / VecField / QuatField): Data-Is-Mono — numbers get the
// mono family + tabular-nums so digits align in a column and read as data, not prose.
// String/text inputs deliberately stay on denseInputCls (proportional).
export const denseNumericInputCls = `${denseInputCls} font-mono tabular-nums`;

// Same dense treatment for the shadcn <SelectTrigger> (defaults h-9/text-sm/px-3/
// bg-transparent/shadow-sm). Alignment stays trigger-default (value left, chevron
// right via the component's justify-between).
export const denseTriggerCls =
	"h-auto min-w-0 bg-input px-1 py-0.5 text-xs shadow-none";

/**
 * The unit suffix a numeric row prints after its value (D-25: units always). Decorative
 * — the number carries the meaning and a screen reader reads the unit as part of the
 * row's text, so an `aria-hidden` chip here would silence it. Nothing renders when the
 * schema declares no unit, because inventing one is worse than omitting it.
 */
export function UnitSuffix({ unit }: { unit: string | undefined }) {
	if (unit === undefined || unit === "") return null;
	return (
		<span className="shrink-0 select-none text-2xs text-muted-foreground">
			{unit}
		</span>
	);
}

/**
 * The exact-entry half of a bounded numeric row: a text input with a BUFFERED parse.
 *
 * Buffered because `Number("") === 0` and 0 is finite, so a field that parsed straight
 * through would commit a 0 the moment the user selected-all and started retyping — and on
 * a bounded param 0 is usually out of range, so the ghost would error rather than merely
 * look wrong. The buffer is the same discipline `NumberField` carries; this is a second
 * implementation rather than a shared one because the two differ in what they do at the
 * ends (that field is unbounded and scrubs from its own label; this one is a leaf of a
 * control whose slider owns the gesture).
 *
 * The commit baseline is captured while UNFOCUSED, so it survives the re-renders our own
 * live previews cause — comparing to the incoming prop mid-edit would compare against the
 * preview and never see a change.
 */
export function ExactNumberInput({
	value,
	mixed,
	label,
	onPreview,
	onCommit,
	onCancel,
	className,
}: {
	value: number;
	mixed: boolean;
	/** The row's human label; the accessible name is `<label> exact` so it is
	 *  distinguishable from the slider sharing the row. */
	label: string;
	onPreview: (n: number) => void;
	onCommit: (n: number) => void;
	onCancel: () => void;
	className?: string;
}) {
	const settled = mixed ? "" : String(roundForDisplay(value));
	const [text, setText] = useState(settled);
	const focused = useRef(false);
	const committed = useRef(mixed ? Number.NaN : roundForDisplay(value));

	// Re-seed from the outside only while the user is not typing. `settled` changes on
	// every preview we ourselves fired, which is exactly why this is guarded.
	if (!focused.current && text !== settled) {
		setText(settled);
		committed.current = mixed ? Number.NaN : roundForDisplay(value);
	}

	const revert = () => setText(settled);

	return (
		<Input
			className={`${denseNumericInputCls} ${className ?? ""}`}
			inputMode="decimal"
			aria-label={`${label} exact`}
			placeholder={mixed ? MIXED : undefined}
			value={text}
			onFocus={() => {
				focused.current = true;
			}}
			onChange={(e) => {
				setText(e.target.value);
				const n = Number(e.target.value);
				// A blank or half-typed entry is MID-EDIT, not a value.
				if (e.target.value.trim() !== "" && Number.isFinite(n)) onPreview(n);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					// Blur is the sole committer — calling onCommit here would double-fire.
					(e.target as HTMLInputElement).blur();
				} else if (e.key === "Escape") {
					onCancel();
					revert();
				}
			}}
			onBlur={() => {
				focused.current = false;
				const n = Number(text);
				if (text.trim() === "" || !Number.isFinite(n)) {
					revert();
					return;
				}
				commitIfChanged(committed.current, n, () => onCommit(n));
			}}
		/>
	);
}
