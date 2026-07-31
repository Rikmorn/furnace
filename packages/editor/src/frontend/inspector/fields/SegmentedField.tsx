// D-25's small-enum control: every member visible at once, one click to change.
//
// A three-member dropdown costs a click to find out what the three members ARE, and the
// params it replaces here (`pillars`, `orientation`, `hemisphere`, `rotation`) are exactly
// the ones a user browses rather than knows. The cardinality cap lives in `resolveKind`,
// not here — see that file for why the registry keeps its single lookup.
//
// The MEMBER, not the label, is what commits. See `lib/enum-options.ts` for the defect
// that rule closes; the short version is that a `{ enum: [0, 90] }` param used to
// round-trip `90` as `"90"` and be refused setup-loud by the generator.
//
// ARIA: a `radiogroup` of `radio`s rather than a `toolbar` of toggles, because this is a
// single choice from a mutually exclusive set — which is what a radio group MEANS, and
// what buys arrow-key navigation as an expectation rather than an invention. The group is
// ONE tab stop (roving tabindex, D-26): three stops for one choice is the pattern the tool
// rail already retired on this shell.

import { cn } from "../../lib/cn.ts";
import { humanizeLabel } from "../../lib/humanize.ts";
import {
	type EnumOption,
	enumOptions,
	optionFor,
} from "../lib/enum-options.ts";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldGroupRow, MIXED } from "./common.tsx";

/** Which member the arrow keys move to from `index`, or `null` when the key is not a
 *  navigation one. Wraps, the ARIA radiogroup convention. */
function arrowTarget(key: string, index: number, count: number): number | null {
	if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
	if (key === "ArrowLeft" || key === "ArrowUp")
		return (index - 1 + count) % count;
	return null;
}

export function SegmentedField({ schema, values, onCommit, path }: FieldProps) {
	const options = enumOptions(schema);
	const mixed = isMixed(values);
	const label = humanizeLabel(path.split(".").at(-1) ?? path);
	const selected = mixed ? undefined : optionFor(options, values[0]);
	// Which button Tab reaches. The selected one when there is one; otherwise the first,
	// so a mixed selection (or a param holding a value no member matches) does not make
	// the whole group unreachable from the keyboard.
	const tabIndex = selected ? options.indexOf(selected) : 0;

	const pick = (o: EnumOption) => onCommit(values.map(() => o.member));

	return (
		<FieldGroupRow path={path}>
			{mixed && (
				<span className="shrink-0 text-muted-foreground text-xs">{MIXED}</span>
			)}
			<div
				role="radiogroup"
				aria-label={label}
				className="flex min-w-0 overflow-hidden rounded border border-input"
			>
				{options.map((o, i) => (
					// biome-ignore lint/a11y/useSemanticElements: `role="radio"` on a button IS the ARIA segmented-control pattern; a native <input type="radio"> brings its own dot and box-model and would defeat the joined look this whole vocabulary exists for
					<button
						key={o.value}
						type="button"
						role="radio"
						// Explicit, even though the text is right there: the row's caption is a
						// heading, not an association (FieldGroupRow), so each member states its
						// own name rather than inheriting one.
						aria-label={o.label}
						aria-checked={selected === o}
						tabIndex={i === tabIndex ? 0 : -1}
						className={cn(
							"min-w-0 truncate px-1.5 py-0.5 text-xs transition-colors duration-150 ease-out",
							"border-input border-r last:border-r-0",
							selected === o
								? "bg-primary text-primary-foreground"
								: "bg-input text-muted-foreground hover:bg-muted",
						)}
						onClick={() => pick(o)}
						onKeyDown={(e) => {
							const next = arrowTarget(e.key, i, options.length);
							if (next === null) return;
							e.preventDefault();
							const target = options[next];
							if (target === undefined) return;
							pick(target);
							// Focus follows selection, the radiogroup convention — otherwise the
							// roving tabindex moves out from under the focused button.
							const group = e.currentTarget.parentElement;
							const button = group?.children[next];
							if (button instanceof HTMLElement) button.focus();
						}}
					>
						{o.label}
					</button>
				))}
			</div>
		</FieldGroupRow>
	);
}
