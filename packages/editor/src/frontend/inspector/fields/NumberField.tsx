import { useEffect, useRef, useState } from "react";
import { isMixed } from "../lib/mixed.ts";
import { scrubValue } from "../lib/scrub.ts";
import type { FieldProps } from "../types.ts";
import { Input } from "../../components/ui/input.tsx";
import { FieldRow, denseInputCls, MIXED } from "./common.tsx";

/** Pixels of horizontal drag per unit change (normal speed). */
const SCRUB_SENSITIVITY = 0.05;

/** Rounding factor: round scrubbed values to 3 decimal places. */
const SCRUB_ROUND = 1000;

export function NumberField({ schema, values, onPreview, onCommit, onCancel, path }: FieldProps) {
  const mixed = isMixed(values);
  const def = typeof schema.default === "number" ? schema.default : 0;
  const initial = mixed ? "" : String((values[0] as number) ?? def);
  const [text, setText] = useState(initial);
  const focusedRef = useRef(false);
  const scrub = useRef<{ startX: number; startVal: number } | null>(null);

  // Re-seed when committed values change externally (e.g. SSE / selection change),
  // but never clobber text the user is actively typing.
  useEffect(() => { if (!focusedRef.current) setText(initial); }, [initial]);

  const fanout = (n: number) => values.map(() => n);

  const onScrubDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    const base = Number(text);
    scrub.current = { startX: e.clientX, startVal: Number.isFinite(base) ? base : 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onScrubMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return;
    const raw = scrubValue(scrub.current.startVal, e.clientX - scrub.current.startX, SCRUB_SENSITIVITY, e.shiftKey);
    const rounded = Math.round(raw * SCRUB_ROUND) / SCRUB_ROUND;
    setText(String(rounded));
    onPreview(fanout(rounded));
  };

  const onScrubUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return;
    const raw = scrubValue(scrub.current.startVal, e.clientX - scrub.current.startX, SCRUB_SENSITIVITY, e.shiftKey);
    const r = Math.round(raw * SCRUB_ROUND) / SCRUB_ROUND;
    setText(String(r));
    onCommit(fanout(r));
    scrub.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <FieldRow path={path} labelPointerProps={{ onPointerDown: onScrubDown, onPointerMove: onScrubMove, onPointerUp: onScrubUp, onPointerCancel: onScrubUp }}>
      <Input
        className={denseInputCls}
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
