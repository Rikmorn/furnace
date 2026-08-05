import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select.tsx";
import { enumOptions, memberAt, optionFor } from "../lib/enum-options.ts";
import type { FieldProps } from "../types.ts";
import { denseTriggerCls, FieldRow } from "./common.tsx";

/** What the trigger shows when the current value is not one of the schema's members —
 *  a stale param the schema has since dropped. An em-dash rather than a substituted
 *  neighbour: the placeholder is the honest reading. */
const NO_MEMBER = "—";

/**
 * The dropdown an enum falls back to above the segmented control's cardinality cap
 * (`resolveKind`). Its members travel as INDICES, not as their own stringified selves —
 * see `lib/enum-options.ts` for the defect that closes: this field used to commit the
 * Radix item's string value, so a `{ enum: [0, 90] }` param round-tripped `90` as `"90"`
 * and every core generator refused it setup-loud.
 */
export function EnumField({ schema, value, onCommit, path }: FieldProps) {
	const options = enumOptions(schema);
	const current = optionFor(options, value);
	return (
		<FieldRow path={path}>
			{/* A member the schema no longer lists resolves to undefined, so the "—"
          placeholder shows rather than a silently-substituted neighbour.
          onValueChange fires only for a real item pick, committing the MEMBER. */}
			<Select
				value={current?.value}
				onValueChange={(v) => {
					// The `undefined` bail is TYPE totality, not a runtime case: Radix only
					// emits values this component supplied, so the lookup always resolves.
					// Nothing should write a synthetic test for it — `memberAt`'s own
					// unknown-value case is the one that can actually fire.
					const member = memberAt(options, v);
					if (member === undefined) return;
					onCommit(member);
				}}
			>
				<SelectTrigger className={denseTriggerCls}>
					<SelectValue placeholder={NO_MEMBER} />
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
