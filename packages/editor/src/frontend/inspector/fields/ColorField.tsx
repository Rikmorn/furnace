import { useEffect, useRef } from "react";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow } from "./common.tsx";

// RGBA channels are 0..1 in the engine color space. <input type=color> is sRGB
// hex 0..255; we map linearly here (no gamma) — engine-conventions §color says
// the working space is the authored space, so a direct 0..1↔0..255 map keeps the
// swatch consistent with how the value renders. Alpha is edited as a number.
const to255 = (c: number) => Math.max(0, Math.min(255, Math.round(c * 255)));
const hex = (rgba: number[]) =>
	`#${[0, 1, 2]
		.map((i) =>
			to255(rgba[i] ?? 0)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

const parseHex = (h: string, alpha: number): number[] => [
	parseInt(h.slice(1, 3), 16) / 255,
	parseInt(h.slice(3, 5), 16) / 255,
	parseInt(h.slice(5, 7), 16) / 255,
	alpha,
];

export function ColorField({ values, onPreview, onCommit, path }: FieldProps) {
	const mixed = isMixed(values);
	const rgba = (values[0] as number[]) ?? [0, 0, 0, 1];
	// Color is always broadcast: all targets get the same picked value (no per-target channel to preserve).
	const fanout = (next: number[]) => values.map(() => next);
	const inputRef = useRef<HTMLInputElement>(null);

	// Commit on the native `change` event (fires once when the OS color picker is
	// dismissed), NOT on blur. A native color input only blurs when focus moves to a
	// focusable element — in Safari, clicking the inspector panel does not blur it, so
	// a blur-commit only landed if you next clicked the (focusable) canvas. `change`
	// fires from the pick itself, so the value sticks wherever you click next, and it
	// only fires when the value actually changed (no no-op revision bumps). React's
	// onChange maps to the `input` event (continuous through the drag) and drives the
	// live preview; `change` is a distinct event React does not surface as a prop,
	// hence the ref listener. `commitRef` holds the latest commit closure so the
	// listener subscribes once.
	// biome-ignore lint/suspicious/noEmptyBlockStatements: placeholder; commitRef.current is assigned on the next line
	const commitRef = useRef<(h: string) => void>(() => {});
	commitRef.current = (h) => onCommit(fanout(parseHex(h, rgba[3] ?? 1)));
	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		const handler = () => commitRef.current(el.value);
		el.addEventListener("change", handler);
		return () => el.removeEventListener("change", handler);
	}, []);

	return (
		<FieldRow path={path}>
			<input
				ref={inputRef}
				type="color"
				value={mixed ? "#000000" : hex(rgba)}
				onChange={(e) =>
					onPreview(fanout(parseHex(e.target.value, rgba[3] ?? 1)))
				}
			/>
		</FieldRow>
	);
}
