import { Fragment } from "react";
import { formatParam } from "../../../lib/field-entity.ts";

/**
 * A frozen or baked record, as the entity row shows it.
 *
 * No form: `openEntity` refuses these, so every control here would report a refusal, and
 * a live-looking dead control is the failure D-7 exists to retire.
 */
export function ReadOnlyParams({
	reason,
	params,
}: {
	reason: string;
	params: Record<string, unknown>;
}) {
	return (
		<div className="px-3 py-2">
			<p className="pb-1 text-muted-foreground">{reason}</p>
			<dl className="grid grid-cols-[auto_1fr] gap-x-3">
				{Object.entries(params).map(([k, v]) => (
					<Fragment key={k}>
						<dt className="font-mono text-muted-foreground">{k}</dt>
						{/* The ROW's renderer, not `String`: one spelling of "how a committed
						    param reads", so the frozen card and the expanded entity row cannot
						    show the same record differently (`String` on an object param would
						    print "[object Object]" here and JSON there). */}
						<dd className="tabular-nums">{formatParam(v)}</dd>
					</Fragment>
				))}
			</dl>
		</div>
	);
}
