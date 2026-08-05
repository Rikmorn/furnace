import { useEffect, useRef, useState } from "react";
import { Input } from "../../components/ui/input.tsx";
import { commitIfChanged } from "../lib/commit-guard.ts";
import { eulerDegToQuat, quatToEulerDeg } from "../lib/euler.ts";
import type { FieldProps } from "../types.ts";
import { AxisChip, denseNumericInputCls, FieldRow } from "./common.tsx";

const LABELS = ["x°", "y°", "z°"];

/** Rotation as Euler degrees; stored value stays a quaternion (single source of truth). */
export function QuatField({
	schema,
	value,
	onPreview,
	onCommit,
	onCancel,
	path,
}: FieldProps) {
	const rawDefault = Array.isArray(schema.default)
		? schema.default
		: [0, 0, 0, 1];
	const fallback = rawDefault as [number, number, number, number];
	const q0 = (value as [number, number, number, number]) ?? fallback;
	const euler0 = quatToEulerDeg(q0).map((v) => Math.round(v * 100) / 100) as [
		number,
		number,
		number,
	];
	const seed = euler0.map(String) as string[];
	// Raw per-component text: storing parsed numbers would round-trip "90." back to
	// "90", making decimals untypeable. Parse only when emitting preview/commit.
	const [text, setText] = useState<string[]>(seed);
	const focusedRef = useRef(false);
	// Per-euler-component committed baseline for the blur dirty-check. Synced only while
	// UNfocused so it holds the pre-edit value, not the live-previewed draft (mirrors
	// NumberField / the text seed).
	const committedAt = (): number[] => euler0.map(Number);
	const committedRef = useRef<number[]>(committedAt());
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed on an external quat change, keyed by the value-stringified q0 — euler0/committedAt are per-render derivations intentionally omitted (re-adding them would fire every render and clobber active typing)
	useEffect(() => {
		if (!focusedRef.current) {
			setText(euler0.map(String));
			committedRef.current = committedAt();
		}
	}, [JSON.stringify(q0)]);

	// Emit a single euler component change: convert the quat to euler, set component i,
	// then convert back — preserving the other two euler components.
	const emitComp = (i: number, raw: string, commit: boolean) => {
		if (raw.trim() === "" || !Number.isFinite(Number(raw))) return;
		const e = quatToEulerDeg(
			(value as [number, number, number, number]) ?? [0, 0, 0, 1],
		) as [number, number, number];
		e[i] = Number(raw);
		(commit ? onCommit : onPreview)(eulerDegToQuat(e));
	};
	const setComp = (i: number, raw: string, commit: boolean) => {
		const next = text.slice();
		next[i] = raw;
		setText(next);
		emitComp(i, raw, commit);
	};
	return (
		<FieldRow path={path}>
			{LABELS.map((label, i) => (
				<span key={label} className="flex min-w-0 items-center gap-0.5">
					<AxisChip>{label}</AxisChip>
					<Input
						className={denseNumericInputCls}
						inputMode="decimal"
						title={label}
						value={text[i] ?? ""}
						onFocus={() => {
							focusedRef.current = true;
						}}
						onChange={(e) => setComp(i, e.target.value, false)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								(e.target as HTMLInputElement).blur();
							} else if (e.key === "Escape") {
								onCancel();
								setText(euler0.map(String));
							}
						}}
						onBlur={(e) => {
							focusedRef.current = false;
							const raw = e.target.value;
							// Invalid leftover on blur: revert just this component to committed.
							if (raw.trim() === "" || !Number.isFinite(Number(raw))) {
								const next = text.slice();
								next[i] = seed[i] ?? "";
								setText(next);
							} else {
								// Dirty check: commit this euler component only if it changed vs baseline.
								commitIfChanged(
									committedRef.current[i] ?? Number.NaN,
									Number(raw),
									() => setComp(i, raw, true),
								);
							}
						}}
					/>
				</span>
			))}
		</FieldRow>
	);
}
