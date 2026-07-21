import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select.tsx";
import { isMixed } from "../lib/mixed.ts";
import {
	refCommitValue,
	refOptions,
	refSelectValue,
} from "../lib/ref-options.ts";
import { useInspectorOptions } from "../options.ts";
import type { FieldProps } from "../types.ts";
import { denseTriggerCls, FieldRow, MIXED } from "./common.tsx";

export function ResourceRefField({
	schema,
	values,
	onCommit,
	path,
}: FieldProps) {
	const table = String(schema.furnace?.table ?? "");
	const { resourceIds } = useInspectorOptions();
	const ids = resourceIds(table);
	const mixed = isMixed(values);
	return (
		<FieldRow path={path}>
			<Select
				value={mixed ? undefined : refSelectValue(String(values[0] ?? ""))}
				onValueChange={(v) => onCommit(values.map(() => refCommitValue(v)))}
			>
				<SelectTrigger className={denseTriggerCls}>
					<SelectValue placeholder={MIXED} />
				</SelectTrigger>
				<SelectContent>
					{refOptions(ids).map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FieldRow>
	);
}
