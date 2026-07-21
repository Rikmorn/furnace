import { Checkbox } from "../../components/ui/checkbox.tsx";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow } from "./common.tsx";

export function BooleanField({ values, onCommit, path }: FieldProps) {
	const mixed = isMixed(values);
	const checked = !mixed && Boolean(values[0]);
	return (
		<FieldRow path={path}>
			{/* Radix Checkbox renders the mixed state via checked="indeterminate"
          (replacing the old imperative ref .indeterminate). onCheckedChange is the
          commit path, mirroring the native `change`: fan the new boolean to all
          targets (a click out of indeterminate yields `true`). */}
			<Checkbox
				checked={mixed ? "indeterminate" : checked}
				onCheckedChange={(c) => onCommit(values.map(() => c === true))}
			/>
		</FieldRow>
	);
}
