import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select.tsx";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { denseTriggerCls, FieldRow, MIXED } from "./common.tsx";

export function EnumField({ schema, values, onCommit, path }: FieldProps) {
	const options = (schema.enum ?? []).map(String);
	const mixed = isMixed(values);
	return (
		<FieldRow path={path}>
			{/* Mixed → undefined value so the "—" placeholder shows; otherwise the current
          value binds. onValueChange fires only for a real item pick, fanning it to
          every selected target. */}
			<Select
				value={mixed ? undefined : String(values[0] ?? "")}
				onValueChange={(v) => onCommit(values.map(() => v))}
			>
				<SelectTrigger className={denseTriggerCls}>
					<SelectValue placeholder={MIXED} />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o} value={o}>
							{o}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FieldRow>
	);
}
