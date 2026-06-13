import { useEffect, useRef, useState } from "react";
import { eulerDegToQuat, quatToEulerDeg } from "../lib/euler.ts";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls } from "./common.tsx";

const LABELS = ["x°", "y°", "z°"];

/** Rotation as Euler degrees; stored value stays a quaternion (single source of truth). */
export function QuatField({ schema, values, onPreview, onCommit, onCancel, path }: FieldProps) {
  const rawDefault = Array.isArray(schema.default) ? schema.default : [0, 0, 0, 1];
  const fallback = rawDefault as [number, number, number, number];
  const q0 = (values[0] as [number, number, number, number]) ?? fallback;
  const euler0 = quatToEulerDeg(q0).map((v) => Math.round(v * 100) / 100) as [number, number, number];
  const seed = euler0.map(String) as string[];
  // Raw per-component text: storing parsed numbers would round-trip "90." back to
  // "90", making decimals untypeable. Parse only when emitting preview/commit.
  const [text, setText] = useState<string[]>(seed);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(euler0.map(String));
  }, [JSON.stringify(q0)]);
  const mixed = isMixed(values);
  const fanout = (e: [number, number, number]) => values.map(() => eulerDegToQuat(e));

  // Emit only when all three components parse to finite numbers.
  const emit = (texts: string[], commit: boolean) => {
    if (texts.some((t) => t.trim() === "" || !Number.isFinite(Number(t)))) return;
    (commit ? onCommit : onPreview)(fanout(texts.map(Number) as [number, number, number]));
  };
  const setComp = (i: number, raw: string, commit: boolean) => {
    const next = text.slice();
    next[i] = raw;
    setText(next);
    emit(next, commit);
  };
  return (
    <FieldRow path={path}>
      {LABELS.map((label, i) => (
        <input
          key={label}
          className={inputCls}
          inputMode="decimal"
          title={label}
          placeholder={mixed ? "—" : undefined}
          value={mixed && text[i] === seed[i] ? "" : (text[i] ?? "")}
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
              setComp(i, raw, true);
            }
          }}
        />
      ))}
    </FieldRow>
  );
}
