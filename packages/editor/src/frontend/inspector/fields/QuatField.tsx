import { useEffect, useRef, useState } from "react";
import { eulerDegToQuat, quatToEulerDeg } from "../lib/euler.ts";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { Input } from "../../components/ui/input.tsx";
import { FieldRow, denseInputCls } from "./common.tsx";

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

  // Emit a single euler component change: each target converts its own quat to euler,
  // sets component i, then converts back — preserving each target's other euler components.
  const emitComp = (i: number, raw: string, commit: boolean) => {
    if (raw.trim() === "" || !Number.isFinite(Number(raw))) return;
    const next = values.map((q) => {
      const e = quatToEulerDeg(
        (q as [number, number, number, number]) ?? [0, 0, 0, 1],
      ) as [number, number, number];
      e[i] = Number(raw);
      return eulerDegToQuat(e);
    });
    (commit ? onCommit : onPreview)(next);
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
        <Input
          key={label}
          className={denseInputCls}
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
