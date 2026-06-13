import { useEffect, useRef, useState } from "react";
import { isMixed } from "../lib/mixed.ts";
import { fanComponent } from "../lib/vec-fan.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls } from "./common.tsx";

const LABELS = ["x", "y", "z", "w"];

/** Render an n-component numeric vector. `n` from the kind (vec2=2, vec3=3, vec4=4). */
export function makeVecField(n: number) {
  return function VecField({ schema, values, onPreview, onCommit, onCancel, path }: FieldProps) {
    const fallback = (Array.isArray(schema.default) ? schema.default : new Array(n).fill(0)) as number[];
    const vec0 = (values[0] as number[]) ?? fallback;
    const seed = vec0.slice(0, n).map(String);
    // Raw per-component text: storing parsed numbers would round-trip "1." back to
    // "1", making decimals untypeable. Parse only when emitting preview/commit.
    const [text, setText] = useState<string[]>(seed);
    const focusedRef = useRef(false);
    useEffect(() => {
      if (!focusedRef.current) setText(vec0.slice(0, n).map(String));
    }, [JSON.stringify(vec0)]);
    const mixedAt = (i: number) => isMixed(values.map((v) => (v as number[])?.[i]));

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
          <input
            key={LABELS[i]}
            className={inputCls}
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
                setText(vec0.slice(0, n).map(String));
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
                setComp(i, raw, true);
              }
            }}
          />
        ))}
      </FieldRow>
    );
  };
}
