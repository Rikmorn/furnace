import type { FieldProps } from "../types.ts";

/** Floor renderer for unrecognized kinds: read-only JSON. The inspector degrades, never blanks. */
export function DefaultField({ value, path }: FieldProps) {
	return (
		<div className="py-1">
			<span className="text-xs text-muted-foreground">{path}</span>
			<pre className="mt-0.5 overflow-auto rounded bg-muted p-1 font-mono text-xs text-muted-foreground">
				{JSON.stringify(value ?? null)}
			</pre>
		</div>
	);
}
