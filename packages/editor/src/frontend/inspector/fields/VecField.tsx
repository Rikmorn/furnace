import { useEffect, useRef, useState } from "react";
import { Input } from "../../components/ui/input.tsx";
import { commitIfChanged } from "../lib/commit-guard.ts";
import { roundForDisplay } from "../lib/format.ts";
import { isMixed } from "../lib/mixed.ts";
import { fanComponent } from "../lib/vec-fan.ts";
import type { FieldProps } from "../types.ts";
import { AxisChip, denseNumericInputCls, FieldRow } from "./common.tsx";

const LABELS = ["x", "y", "z", "w"];

/** Render an n-component numeric vector. `n` from the kind (vec2=2, vec3=3, vec4=4). */
export function makeVecField(n: number) {
	return function VecField({
		schema,
		values,
		onPreview,
		onCommit,
		onCancel,
		path,
	}: FieldProps) {
		const fallback = (
			Array.isArray(schema.default) ? schema.default : new Array(n).fill(0)
		) as number[];
		const vec0 = (values[0] as number[]) ?? fallback;
		const seed = vec0
			.slice(0, n)
			.map((v) => String(roundForDisplay(Number(v ?? 0))));
		// Raw per-component text: storing parsed numbers would round-trip "1." back to
		// "1", making decimals untypeable. Parse only when emitting preview/commit.
		const [text, setText] = useState<string[]>(seed);
		const focusedRef = useRef(false);
		const mixedAt = (i: number) =>
			isMixed(values.map((v) => (v as number[])?.[i]));
		// Per-component committed baseline for the blur dirty-check (NaN = that component is
		// mixed across the selection → always commit). Synced only while UNfocused so it holds
		// the pre-edit value, not the live-previewed draft (mirrors NumberField / the text seed).
		const committedAt = (): number[] =>
			Array.from({ length: n }, (_, i) =>
				mixedAt(i)
					? Number.NaN
					: roundForDisplay(Number((vec0[i] as number) ?? 0)),
			);
		const committedRef = useRef<number[]>(committedAt());
		// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed on an external vec change, keyed by the value-stringified vec0 — seed/committedAt are per-render derivations intentionally omitted (re-adding them would fire every render and clobber active typing)
		useEffect(() => {
			if (!focusedRef.current) {
				setText(seed);
				committedRef.current = committedAt();
			}
		}, [JSON.stringify(vec0)]);

		// Emit a single component change: preserves every target's own other components.
		const emitComp = (i: number, raw: string, commit: boolean) => {
			if (raw.trim() === "" || !Number.isFinite(Number(raw))) return;
			(commit ? onCommit : onPreview)(fanComponent(values, i, Number(raw), n));
		};
		const setComp = (i: number, raw: string, commit: boolean) => {
			const next = text.slice();
			next[i] = raw;
			setText(next);
			emitComp(i, raw, commit);
		};
		return (
			<FieldRow path={path}>
				{Array.from({ length: n }, (_, i) => (
					<span key={LABELS[i]} className="flex min-w-0 items-center gap-0.5">
						<AxisChip>{LABELS[i]}</AxisChip>
						<Input
							className={denseNumericInputCls}
							inputMode="decimal"
							title={LABELS[i]}
							placeholder={mixedAt(i) ? "—" : undefined}
							value={mixedAt(i) && text[i] === seed[i] ? "" : (text[i] ?? "")}
							onFocus={() => {
								focusedRef.current = true;
							}}
							onChange={(e) => setComp(i, e.target.value, false)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									(e.target as HTMLInputElement).blur();
								} else if (e.key === "Escape") {
									onCancel();
									setText(seed);
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
									// Dirty check: commit this component only if it changed vs its baseline.
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
	};
}
