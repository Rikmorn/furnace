import { useEffect, useRef, useState } from "react";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls } from "./common.tsx";

const LABELS = ["x", "y", "z", "w"];

/** Render an n-component numeric vector. `n` from the kind (vec2=2, vec3=3, vec4=4). */
export function makeVecField(n: number) {
  return function VecField({ values, onPreview, onCommit, onCancel, path }: FieldProps) {
    const vec0 = (values[0] as number[]) ?? new Array(n).fill(0);
    const [draft, setDraft] = useState<number[]>(vec0.slice(0, n));
    // Fix B: only re-seed when no input in the row is focused — prevents clobbering
    // a live decimal the user is typing (e.g. "1." parsed to 1 → re-seeds to [1,...]).
    const focusedRef = useRef(false);
    useEffect(() => {
      if (!focusedRef.current) setDraft(vec0.slice(0, n));
    }, [JSON.stringify(vec0)]);
    const mixedAt = (i: number) => isMixed(values.map((v) => (v as number[])?.[i]));
    const fanout = (next: number[]) => values.map(() => next);

    const setComp = (i: number, raw: string, commit: boolean) => {
      const num = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(num)) return;
      const next = draft.slice();
      next[i] = num;
      setDraft(next);
      (commit ? onCommit : onPreview)(fanout(next));
    };
    return (
      <FieldRow path={path}>
        {Array.from({ length: n }, (_, i) => (
          <input
            key={LABELS[i]}
            className={inputCls}
            inputMode="decimal"
            title={LABELS[i]}
            placeholder={mixedAt(i) ? "—" : undefined}
            value={mixedAt(i) && draft[i] === vec0[i] ? "" : String(draft[i])}
            onFocus={() => {
              focusedRef.current = true;
            }}
            onChange={(e) => setComp(i, e.target.value, false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Fix A: do NOT commit here — blur fires onBlur which is the sole committer.
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                onCancel();
                setDraft(vec0.slice(0, n));
              }
            }}
            onBlur={(e) => {
              // Fix B: clear focused flag before committing so the re-seed effect
              // can run on the next render if no other input in the row is focused.
              focusedRef.current = false;
              setComp(i, e.target.value, true);
            }}
          />
        ))}
      </FieldRow>
    );
  };
}
