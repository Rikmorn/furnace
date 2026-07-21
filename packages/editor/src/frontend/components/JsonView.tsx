type JsonViewProps = { label: string; value: unknown; depth?: number };

export function JsonView({ label, value, depth = 0 }: JsonViewProps) {
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		return (
			<details open={depth < 2} className="ml-2">
				<summary className="cursor-pointer select-none text-muted-foreground">
					{label}{" "}
					<span className="text-muted-foreground/60">
						{Array.isArray(value) ? `[${entries.length}]` : ""}
					</span>
				</summary>
				{entries.map(([k, v]) => (
					<JsonView key={k} label={k} value={v} depth={depth + 1} />
				))}
			</details>
		);
	}
	return (
		<div className="ml-4 font-mono text-sm">
			<span className="text-muted-foreground">{label}:</span>{" "}
			<span className="text-syntax-value">{JSON.stringify(value)}</span>
		</div>
	);
}
