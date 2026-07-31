import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select.tsx";
import { enumOptions, memberAt, optionFor } from "../lib/enum-options.ts";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { denseTriggerCls, FieldRow, MIXED } from "./common.tsx";

/**
 * The dropdown an enum falls back to above the segmented control's cardinality cap
 * (`resolveKind`). Its members travel as INDICES, not as their own stringified selves —
 * see `lib/enum-options.ts` for the defect that closes: this field used to commit the
 * Radix item's string value, so a `{ enum: [0, 90] }` param round-tripped `90` as `"90"`
 * and every core generator refused it setup-loud.
 */
export function EnumField({ schema, values, onCommit, path }: FieldProps) {
	const options = enumOptions(schema);
	const mixed = isMixed(values);
	const current = mixed ? undefined : optionFor(options, values[0]);
	return (
		<FieldRow path={path}>
			{/* Mixed → undefined value so the "—" placeholder shows; otherwise the current
          member's option binds. A member the schema no longer lists also resolves to
          undefined, which is the honest reading: the placeholder rather than a
          silently-substituted neighbour. onValueChange fires only for a real item pick,
          fanning the MEMBER to every selected target. */}
			<Select
				value={current?.value}
				onValueChange={(v) => {
					// The `undefined` bail is TYPE totality, not a runtime case: Radix only
					// emits values this component supplied, so the lookup always resolves.
					// Nothing should write a synthetic test for it — `memberAt`'s own
					// unknown-value case is the one that can actually fire.
					const member = memberAt(options, v);
					if (member === undefined) return;
					onCommit(values.map(() => member));
				}}
			>
				<SelectTrigger className={denseTriggerCls}>
					<SelectValue placeholder={MIXED} />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FieldRow>
	);
}
