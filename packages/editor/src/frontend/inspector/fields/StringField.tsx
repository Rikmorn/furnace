import { useEffect, useState } from "react";
import { Input } from "../../components/ui/input.tsx";
import type { FieldProps } from "../types.ts";
import { denseInputCls, FieldRow } from "./common.tsx";

export function StringField({ value, onCommit, onCancel, path }: FieldProps) {
	const initial = String((value as string) ?? "");
	const [text, setText] = useState(initial);
	useEffect(() => setText(initial), [initial]);
	return (
		<FieldRow path={path}>
			<Input
				className={denseInputCls}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						// Do NOT call onCommit here — blur fires onBlur which is the sole committer.
						(e.target as HTMLInputElement).blur();
					} else if (e.key === "Escape") {
						onCancel();
						setText(initial);
					}
				}}
				onBlur={() => onCommit(text)}
			/>
		</FieldRow>
	);
}
