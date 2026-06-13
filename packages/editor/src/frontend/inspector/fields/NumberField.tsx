import { useEffect, useRef, useState } from "react";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls, MIXED } from "./common.tsx";

export function NumberField({ values, onPreview, onCommit, onCancel, path }: FieldProps) {
  const mixed = isMixed(values);
  const initial = mixed ? "" : String((values[0] as number) ?? 0);
  const [text, setText] = useState(initial);
  const focusedRef = useRef(false);
  // Re-seed when committed values change externally (e.g. SSE / selection change),
  // but never clobber text the user is actively typing.
  useEffect(() => { if (!focusedRef.current) setText(initial); }, [initial]);

  const fanout = (n: number) => values.map(() => n);
  return (
    <FieldRow path={path}>
      <input
        className={inputCls}
        inputMode="decimal"
        placeholder={mixed ? MIXED : undefined}
        value={text}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onPreview(fanout(n));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Do NOT call onCommit here — blur fires onBlur which is the sole committer.
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            onCancel();
            setText(initial);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          const n = Number(text);
          if (text.trim() !== "" && Number.isFinite(n)) onCommit(fanout(n));
          else setText(initial);
        }}
      />
    </FieldRow>
  );
}
