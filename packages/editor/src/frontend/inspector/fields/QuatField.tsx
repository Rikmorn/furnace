import { useEffect, useRef, useState } from "react";
import { eulerDegToQuat, quatToEulerDeg } from "../lib/euler.ts";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls } from "./common.tsx";

const LABELS = ["x°", "y°", "z°"];

/** Rotation as Euler degrees; stored value stays a quaternion (single source of truth). */
export function QuatField({ values, onPreview, onCommit, onCancel, path }: FieldProps) {
  const q0 = (values[0] as [number, number, number, number]) ?? [0, 0, 0, 1];
  const euler0 = quatToEulerDeg(q0).map((v) => Math.round(v * 100) / 100) as [number, number, number];
  const [draft, setDraft] = useState<[number, number, number]>(euler0);
  // Fix B: only re-seed when no input in the row is focused — prevents clobbering
  // a live decimal the user is typing (e.g. "90." parsed to 90 → re-seeds to [90,...]).
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(euler0);
  }, [JSON.stringify(q0)]);
  const mixed = isMixed(values);
  const fanout = (e: [number, number, number]) => values.map(() => eulerDegToQuat(e));

  const setComp = (i: number, raw: string, commit: boolean) => {
    const num = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(num)) return;
    const next = draft.slice() as [number, number, number];
    next[i] = num;
    setDraft(next);
    (commit ? onCommit : onPreview)(fanout(next));
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
          value={mixed && draft[i] === euler0[i] ? "" : String(draft[i])}
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
              setDraft(euler0);
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
}
