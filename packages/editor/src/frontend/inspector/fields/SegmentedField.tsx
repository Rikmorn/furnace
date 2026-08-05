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
// The WIDGET is `components/ui/segmented.tsx` (D-24: one control library) — this file is
// the schema half and nothing else. What lives here is what only a field knows: which
// members exist, and that the option handed back has to be resolved to its member before
// it commits.

import { Segmented } from "../../components/ui/segmented.tsx";
import { humanizeLabel } from "../../lib/humanize.ts";
import { enumOptions, optionFor } from "../lib/enum-options.ts";
import type { FieldProps } from "../types.ts";
import { FieldGroupRow } from "./common.tsx";

export function SegmentedField({ schema, value, onCommit, path }: FieldProps) {
	const options = enumOptions(schema);
	const label = humanizeLabel(path.split(".").at(-1) ?? path);
	// `null` rather than "the first member" when the value names no member: a stale param
	// checks NOTHING, which is what every other field in this system does.
	const selected = optionFor(options, value);

	return (
		<FieldGroupRow path={path}>
			<Segmented
				label={label}
				value={selected?.value ?? null}
				options={options}
				onChange={(next) => {
					// Resolved back to the OPTION rather than parsed: the member travels beside
					// its label precisely so it never has to be reconstructed from a string.
					// Undefined is unreachable (the values are our own) and returns rather than
					// falling back — committing member 0 for a value nobody sent would turn a
					// mapping bug into a silent data change.
					const picked = options.find((o) => o.value === next);
					if (picked === undefined) return;
					onCommit(picked.member);
				}}
			/>
		</FieldGroupRow>
	);
}
