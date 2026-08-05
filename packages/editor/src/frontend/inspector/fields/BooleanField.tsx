import { Checkbox } from "../../components/ui/checkbox.tsx";
import type { FieldProps } from "../types.ts";
import { FieldRow } from "./common.tsx";

export function BooleanField({ value, onCommit, path }: FieldProps) {
	return (
		<FieldRow path={path}>
			{/* onCheckedChange is the commit path, mirroring the native `change`. Radix's
          CheckedState is tri-state, so the `=== true` narrowing is what turns it back
          into the boolean the schema declares. */}
			<Checkbox
				checked={Boolean(value)}
				onCheckedChange={(c) => onCommit(c === true)}
			/>
		</FieldRow>
	);
}
