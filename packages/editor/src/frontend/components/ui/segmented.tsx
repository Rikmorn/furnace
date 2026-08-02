// The house SEGMENTED CONTROL (D-24/D-25): one visible row of mutually exclusive choices,
// for an enum small enough that hiding all but one behind a dropdown click costs more than
// the width.
//
// It is here rather than beside either caller because there are TWO — the inspector's
// `SegmentedField` (schema-driven, mixed-state) and the View popover's shading row — and
// D-24's whole point is that one widget must not be two implementations. This file is the
// presentational core: a value, some options, a change handler. Everything about schemas,
// members, mixed selections and humanized labels stays in `SegmentedField`.
//
// NOT vendored shadcn (there is no shadcn segmented control) and not a Radix primitive
// either: `RadioGroup` renders a dot-and-box per member and would defeat the joined look
// this vocabulary exists for. What it takes from Radix is the CONVENTION, not the code.
//
// ARIA: a `radiogroup` of `radio`s rather than a `toolbar` of toggles, because this is a
// single choice from a mutually exclusive set — which is what a radio group MEANS, and what
// buys arrow-key navigation as an expectation rather than an invention. The group is ONE
// tab stop (roving tabindex, D-26): one stop per member for one choice is the pattern the
// tool rail already retired on this shell.

import { cn } from "../../lib/cn.ts";
import { ActionTip } from "../tips.tsx";

/** One member of a segmented control. */
export type SegmentedOption = {
	/** What {@link Segmented}'s `onChange` hands back. Unique within the option list. */
	value: string;
	/** What the user reads, and the member's accessible name. */
	label: string;
	/** The one sentence the label has no room for, as a real tooltip (D-25).
	 *
	 *  Optional because the two callers differ: the shading row's members are modes whose
	 *  names do not say what they cost, while an inspector enum's members are the schema's
	 *  own words and have nothing to add. A member without one renders no tooltip trigger at
	 *  all, which is also what keeps this component usable outside the shell's single
	 *  `TooltipProvider` — {@link ActionTip} throws without one. */
	hint?: string;
};

/** Which member the arrow keys move to from `index`, or `null` when the key is not a
 *  navigation one. Wraps, the ARIA radiogroup convention. */
function arrowTarget(key: string, index: number, count: number): number | null {
	if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
	if (key === "ArrowLeft" || key === "ArrowUp")
		return (index - 1 + count) % count;
	return null;
}

export function Segmented({
	label,
	value,
	options,
	onChange,
	className,
}: {
	/** The group's accessible name. Where the caller also shows a heading, this is that
	 *  heading VERBATIM — a divergence is a screen reader and a screen disagreeing about
	 *  what a thing is called. */
	label: string;
	/** The selected option's `value`, or `null` for "none of them" — which is what a mixed
	 *  multi-selection and a value matching no member both look like, and neither may render
	 *  as a checked member. */
	value: string | null;
	options: readonly SegmentedOption[];
	onChange: (value: string) => void;
	className?: string;
}) {
	const selectedIndex = options.findIndex((o) => o.value === value);
	// Which button Tab reaches. The selected one when there is one; otherwise the first, so
	// a mixed selection does not make the whole group unreachable from the keyboard.
	const tabIndex = selectedIndex === -1 ? 0 : selectedIndex;

	return (
		<div
			role="radiogroup"
			aria-label={label}
			className={cn(
				"flex min-w-0 overflow-hidden rounded border border-input",
				className,
			)}
		>
			{options.map((o, i) => {
				// The key rides the BUTTON, so it is there whether or not the tooltip wrapper
				// is: an element key on the only child of `ActionTip` is inert (Slot clones it
				// into the trigger), while a missing one on the unwrapped branch is a warning.
				const button = (
					// biome-ignore lint/a11y/useSemanticElements: `role="radio"` on a button IS the ARIA segmented-control pattern; a native <input type="radio"> brings its own dot and box-model and would defeat the joined look this whole vocabulary exists for
					<button
						key={o.value}
						type="button"
						role="radio"
						// Explicit, even though the text is right there: the caller's caption is a
						// heading, not an association, so each member states its own name rather
						// than inheriting one.
						aria-label={o.label}
						aria-checked={i === selectedIndex}
						tabIndex={i === tabIndex ? 0 : -1}
						className={cn(
							"min-w-0 truncate px-1.5 py-0.5 text-xs transition-colors duration-150 ease-out",
							"border-input border-r last:border-r-0",
							i === selectedIndex
								? "bg-primary text-primary-foreground"
								: "bg-input text-muted-foreground hover:bg-muted",
						)}
						onClick={() => onChange(o.value)}
						onKeyDown={(e) => {
							const next = arrowTarget(e.key, i, options.length);
							if (next === null) return;
							e.preventDefault();
							const target = options[next];
							if (target === undefined) return;
							onChange(target.value);
							// Focus follows selection, the radiogroup convention — otherwise the
							// roving tabindex moves out from under the focused button.
							const group = e.currentTarget.parentElement;
							const sibling = group?.children[next];
							if (sibling instanceof HTMLElement) sibling.focus();
						}}
					>
						{o.label}
					</button>
				);
				return o.hint === undefined ? (
					button
				) : (
					<ActionTip key={o.value} hint={o.hint}>
						{button}
					</ActionTip>
				);
			})}
		</div>
	);
}
